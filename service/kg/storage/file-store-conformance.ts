/**
 * The contract every `FileStore` must satisfy, as a suite any adapter can run.
 *
 * Exported as a plain array rather than written as tests, so any host can run
 * it. Both implementations run it in Vitest today — `memory-file-store` on a
 * Map, `web/src/kg/storage/idb-file-store` on `fake-indexeddb` — which means the
 * adapter that actually holds the user's documents is checked on every gate.
 *
 * That was not always the plan. This file was written when the second
 * implementation was going to be a File System Access adapter needing a real
 * browser, a real user-granted directory, and a CDP harness to drive it; the
 * shape survived the plan being abandoned (`docs/NO-SERVER.md`) and turned out
 * to be worth having anyway. A suite that is data rather than tests can be run
 * by a host nobody has thought of yet, which is exactly what happened.
 *
 * The rule these assertions exist to defend: **a `FileStore` method RETURNS a
 * failure, it never throws.** The audit found the write queue wedging silently
 * when a `Driver` broke that same rule — batch discarded, `draining` stuck true,
 * health frozen so no banner fired — and nothing anywhere asserted the contract.
 * This is that assertion, written before the second implementation exists rather
 * than after it breaks something.
 */

import type { FileResult, FileStore } from './file-store'

export type ConformanceHooks = {
  /** A fresh, connected store with `Documents/` empty. */
  create(): Promise<FileStore> | FileStore
  /** Called after each case. Delete anything the case wrote. */
  cleanup?(store: FileStore): Promise<void> | void
  /**
   * Put a file there behind the store's back — a user dropping one in via
   * Finder. The drift cases are unreachable without it.
   */
  place(store: FileStore, path: string, data: Uint8Array): Promise<void> | void
  /** Remove one behind the store's back. */
  remove(store: FileStore, path: string): Promise<void> | void
}

export type ConformanceCase = {
  readonly name: string
  run(store: FileStore, hooks: ConformanceHooks): Promise<void>
}

/** Minimal assertion helpers, so the suite does not depend on a test runner. */
const fail = (msg: string): never => {
  throw new Error(msg)
}
const eq = <T>(actual: T, expected: T, what: string): void => {
  if (actual !== expected) fail(`${what}: expected ${String(expected)}, got ${String(actual)}`)
}
const ok = <T>(r: FileResult<T>, what: string): T =>
  r.ok ? r.value : fail(`${what}: expected ok, got ${r.error.code} (${r.error.message})`)
const failed = <T>(r: FileResult<T>, code: string, what: string): void => {
  if (r.ok) fail(`${what}: expected ${code}, got ok`)
  else eq(r.error.code, code, what)
}

const enc = new TextEncoder()
const dec = new TextDecoder()
const bytes = (s: string) => enc.encode(s)

export const CONFORMANCE_CASES: readonly ConformanceCase[] = [
  {
    name: 'write then read returns the same bytes',
    async run(store) {
      const w = ok(await store.write('Documents/a.txt', bytes('hello')), 'write')
      eq(w.path, 'Documents/a.txt', 'written path')
      eq(w.bytes, 5, 'written size')
      eq(dec.decode(ok(await store.read('Documents/a.txt'), 'read')), 'hello', 'round trip')
    },
  },
  {
    name: 'write creates parent directories',
    async run(store) {
      ok(await store.write('Documents/nested/deep/a.txt', bytes('x')), 'nested write')
      eq(ok(await store.exists('Documents/nested/deep/a.txt'), 'exists'), true, 'nested exists')
    },
  },
  {
    name: 'write over an existing path replaces it',
    async run(store) {
      ok(await store.write('Documents/a.txt', bytes('first')), 'first')
      ok(await store.write('Documents/a.txt', bytes('second')), 'second')
      eq(dec.decode(ok(await store.read('Documents/a.txt'), 'read')), 'second', 'replaced')
    },
  },
  {
    // The single most important case in the suite. Every layer above assumes it.
    name: 'a missing file RETURNS files/not-found and does not throw',
    async run(store) {
      failed(await store.read('Documents/nope.txt'), 'files/not-found', 'read')
      failed(await store.stat('Documents/nope.txt'), 'files/not-found', 'stat')
      failed(await store.url('Documents/nope.txt'), 'files/not-found', 'url')
      eq(
        ok(await store.exists('Documents/nope.txt'), 'exists'),
        false,
        'exists is false, not an error',
      )
    },
  },
  {
    name: 'stat reports the real byte count',
    async run(store) {
      ok(await store.write('Documents/a.txt', bytes('12345678')), 'write')
      eq(ok(await store.stat('Documents/a.txt'), 'stat').bytes, 8, 'bytes')
    },
  },
  {
    name: 'list is non-recursive',
    async run(store) {
      ok(await store.write('Documents/a.txt', bytes('a')), 'a')
      ok(await store.write('Documents/sub/b.txt', bytes('b')), 'b')
      const listed = ok(await store.list('Documents'), 'list').map((e) => e.path)
      eq(listed.length, 1, 'entry count')
      eq(listed[0], 'Documents/a.txt', 'the one entry')
    },
  },
  {
    // Chrome orphans `<name>.crswap` on a hard kill and never reaps it. It is a
    // half-written copy of a real document, so rebuilding one into a record
    // would hand the user a corrupt file that looks like theirs.
    name: 'list hides Chrome write-swap leftovers',
    async run(store, hooks) {
      ok(await store.write('Documents/a.txt', bytes('a')), 'a')
      await hooks.place(store, 'Documents/a.txt.crswap', bytes('half'))
      const listed = ok(await store.list('Documents'), 'list').map((e) => e.path)
      eq(listed.includes('Documents/a.txt.crswap'), false, 'swap hidden')
      eq(listed.includes('Documents/a.txt'), true, 'real file still listed')
    },
  },
  {
    name: 'list of an empty directory is empty, not an error',
    async run(store) {
      eq(ok(await store.list('Documents'), 'list').length, 0, 'empty')
    },
  },
  {
    name: 'a file removed behind our back reads as not-found',
    async run(store, hooks) {
      ok(await store.write('Documents/a.txt', bytes('a')), 'write')
      await hooks.remove(store, 'Documents/a.txt')
      failed(await store.read('Documents/a.txt'), 'files/not-found', 'read after external delete')
      eq(ok(await store.exists('Documents/a.txt'), 'exists'), false, 'exists')
    },
  },
  {
    name: 'trash moves the file rather than unlinking it',
    async run(store) {
      ok(await store.write('Documents/a.txt', bytes('keep me')), 'write')
      ok(await store.trash('Documents/a.txt'), 'trash')
      eq(ok(await store.exists('Documents/a.txt'), 'gone from Documents'), false, 'moved out')
      eq(ok(await store.exists('jojo/Trash/Documents/a.txt'), 'in Trash'), true, 'recoverable')
      eq(
        dec.decode(ok(await store.read('jojo/Trash/Documents/a.txt'), 'read')),
        'keep me',
        'intact',
      )
    },
  },
  {
    /**
     * Keyed by basename, `trash` destroyed data: two documents called `CV.pdf`
     * in different directories collapsed onto one Trash entry and the second
     * silently overwrote the first — in the method whose whole promise is that
     * nothing is ever unrecoverable.
     */
    name: 'trashing two files with the same name keeps both',
    async run(store) {
      ok(await store.write('Documents/CV.pdf', bytes('the current one')), 'a')
      ok(await store.write('Documents/old/CV.pdf', bytes('the older one')), 'b')
      ok(await store.trash('Documents/CV.pdf'), 'trash a')
      ok(await store.trash('Documents/old/CV.pdf'), 'trash b')
      eq(
        dec.decode(ok(await store.read('jojo/Trash/Documents/CV.pdf'), 'read a')),
        'the current one',
        'first survives',
      )
      eq(
        dec.decode(ok(await store.read('jojo/Trash/Documents/old/CV.pdf'), 'read b')),
        'the older one',
        'second survives',
      )
    },
  },
  {
    /**
     * A real filesystem takes the bytes. Aliasing the caller's array let a
     * caller reusing its buffer rewrite a file already written, and a fake more
     * forgiving than the real adapter hides the bugs it exists to catch.
     */
    name: 'write copies the bytes rather than aliasing the caller',
    async run(store) {
      const data = bytes('original')
      ok(await store.write('Documents/a.txt', data), 'write')
      data[0] = 88
      eq(dec.decode(ok(await store.read('Documents/a.txt'), 'read')), 'original', 'unchanged')
    },
  },
  {
    name: 'read hands back a copy, so a caller cannot mutate the folder',
    async run(store) {
      ok(await store.write('Documents/a.txt', bytes('original')), 'write')
      const first = ok(await store.read('Documents/a.txt'), 'read')
      first[0] = 88
      eq(dec.decode(ok(await store.read('Documents/a.txt'), 're-read')), 'original', 'unchanged')
    },
  },
  {
    name: 'trashing something that is not there returns, and does not throw',
    async run(store) {
      failed(await store.trash('Documents/nope.txt'), 'files/not-found', 'trash')
    },
  },
  {
    name: 'identity returns the vault marker',
    async run(store) {
      const id = ok(await store.identity(), 'identity')
      eq(typeof id.vaultId, 'string', 'vaultId is a string')
      eq(id.vaultId.length > 0, true, 'vaultId is not empty')
    },
  },
  {
    name: 'withLock runs the body and returns its value',
    async run(store) {
      const r = await store.withLock('t', async () => 42)
      eq(ok(r, 'withLock'), 42, 'body value')
    },
  },
  {
    /**
     * The first version of this case asserted `eq(threw || true, true)`, which
     * is `eq(true, true)` — it could not fail, and it was sitting in the suite
     * whose entire purpose is stopping that. Its comment excused the gap by
     * calling the behaviour "the adapter's business"; it is not. The port's
     * first line is "never throws", and a body rejection escaping `withLock`
     * lands as an unhandled rejection in whatever await is upstream.
     */
    name: 'a throwing body becomes a returned failure, never a throw',
    async run(store) {
      let threw: string | null = null
      let result: FileResult<unknown> | null = null
      try {
        result = await store.withLock('t', async () => {
          throw new Error('boom')
        })
      } catch (e) {
        threw = e instanceof Error ? e.message : String(e)
      }
      eq(threw, null, 'withLock must not throw')
      if (result === null || result.ok) fail('withLock: expected a returned failure')
      else eq(result.error.code, 'files/failed', 'failure code')

      // And the lock is free afterwards, or the next write deadlocks forever.
      eq(ok(await store.withLock('t', async () => 'free'), 'reacquire'), 'free', 'lock released')
    },
  },
  {
    name: 'url returns something the viewer can point at',
    async run(store) {
      ok(await store.write('Documents/a.pdf', bytes('%PDF-1.4')), 'write')
      eq(ok(await store.url('Documents/a.pdf'), 'url').length > 0, true, 'non-empty url')
    },
  },
  {
    name: 'connected() is true for a connected store',
    async run(store) {
      eq(store.connected(), true, 'connected')
    },
  },
  {
    name: 'after forget(), every method returns files/no-folder',
    async run(store) {
      ok(await store.write('Documents/a.txt', bytes('a')), 'write')
      await store.forget()
      eq(store.connected(), false, 'disconnected')
      failed(await store.read('Documents/a.txt'), 'files/no-folder', 'read')
      failed(await store.list('Documents'), 'files/no-folder', 'list')
      failed(await store.write('Documents/b.txt', bytes('b')), 'files/no-folder', 'write')
      failed(await store.stat('Documents/a.txt'), 'files/no-folder', 'stat')
      failed(await store.exists('Documents/a.txt'), 'files/no-folder', 'exists')
      failed(await store.trash('Documents/a.txt'), 'files/no-folder', 'trash')
      failed(await store.url('Documents/a.txt'), 'files/no-folder', 'url')
      failed(await store.identity(), 'files/no-folder', 'identity')
    },
  },
  {
    name: 'zero-byte files round trip',
    async run(store) {
      ok(await store.write('Documents/empty.txt', new Uint8Array(0)), 'write')
      eq(ok(await store.stat('Documents/empty.txt'), 'stat').bytes, 0, 'zero bytes')
      eq(ok(await store.read('Documents/empty.txt'), 'read').byteLength, 0, 'reads back empty')
    },
  },
  {
    name: 'binary bytes survive unchanged',
    async run(store) {
      const data = new Uint8Array([0, 1, 2, 253, 254, 255])
      ok(await store.write('Documents/b.bin', data), 'write')
      const back = ok(await store.read('Documents/b.bin'), 'read')
      eq(back.byteLength, 6, 'length')
      eq([...back].join(','), '0,1,2,253,254,255', 'bytes')
    },
  },
  {
    name: 'names with spaces and non-ASCII round trip',
    async run(store) {
      // The readable-folder premise depends on this working, so it is a contract
      // requirement rather than a nicety.
      const path = 'Documents/CV Rice Oct 2026 — Résumé.pdf'
      ok(await store.write(path, bytes('x')), 'write')
      eq(ok(await store.exists(path), 'exists'), true, 'exists')
      eq(ok(await store.list('Documents'), 'list')[0]?.path, path, 'listed under the same name')
    },
  },
]
