/**
 * `memory-file-store` against the shared contract, plus the seams only it has.
 *
 * The conformance cases are the same ones `idb-file-store` runs — the adapter
 * that actually holds the user's documents. Running them against a Map as well
 * is not redundant: this implementation is the readable one, so a case that
 * fails here names the contract clause, while the same failure against a real
 * database could as easily be the database.
 *
 * The contract was pinned before either real implementation existed, which is
 * the reverse of how the `Driver` port got its suite — that one was written only
 * after an audit found the gap.
 */

import { describe, expect, it } from 'vitest'
import { CONFORMANCE_CASES, type ConformanceHooks } from './file-store-conformance'
import { bytesOf, createMemoryFileStore, type MemoryFileStore } from './memory-file-store'

const hooks: ConformanceHooks = {
  create: () => createMemoryFileStore(),
  place: (store, path, data) => void (store as MemoryFileStore).place(path, data),
  remove: (store, path) => void (store as MemoryFileStore).remove(path),
}

describe('memory-file-store — FileStore conformance', () => {
  // One `it` per case, so a failure names the contract clause it broke rather
  // than reporting "conformance failed" and leaving you to read the output.
  for (const c of CONFORMANCE_CASES) {
    it(c.name, async () => {
      await c.run(await hooks.create(), hooks)
    })
  }
})

describe('memory-file-store — the seams a test needs', () => {
  it('starts disconnected when asked, which is most sessions', async () => {
    const store = createMemoryFileStore({ disconnected: true })
    expect(store.connected()).toBe(false)
    const r = await store.read('Documents/a.txt')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('files/no-folder')
  })

  it('serves an injected fault instead of doing the work', async () => {
    const store = createMemoryFileStore({
      fault: (call) => (call === 'write' ? { code: 'files/quota', message: 'disk full' } : null),
    })
    const w = await store.write('Documents/a.txt', bytesOf('a'))
    expect(w.ok).toBe(false)
    if (!w.ok) expect(w.error.code).toBe('files/quota')
    // Only the faulted call fails — reads still work, which is what a real full
    // disk does and what the degraded UI has to render.
    expect((await store.list('Documents')).ok).toBe(true)
  })

  it('can fault one path and not another', async () => {
    const store = createMemoryFileStore({
      files: { 'Documents/a.txt': bytesOf('a'), 'Documents/b.txt': bytesOf('b') },
      fault: (call, path) =>
        call === 'read' && path === 'Documents/a.txt'
          ? { code: 'files/denied', message: 'permission lapsed' }
          : null,
    })
    expect((await store.read('Documents/a.txt')).ok).toBe(false)
    expect((await store.read('Documents/b.txt')).ok).toBe(true)
  })

  /**
   * Reentrancy is a deadlock, not a queue. `navigator.locks` would block
   * forever, so a mirror write that somehow awaited itself would take the
   * feature down with no error anywhere — the silent-wedge shape the audit
   * found twice in the write queue.
   */
  it('refuses to take a lock it already holds, rather than hanging', async () => {
    const store = createMemoryFileStore()
    const inner = await store.withLock('m', async () => store.withLock('m', async () => 'nested'))
    expect(inner.ok).toBe(true)
    if (inner.ok) {
      expect(inner.value.ok).toBe(false)
      if (!inner.value.ok) expect(inner.value.error.code).toBe('files/failed')
    }
    expect(store.held()).toEqual([])
  })

  /**
   * Was written asserting `.rejects.toThrow('boom')` — that is, asserting the
   * bug. `withLock` was the one method that let a rejection escape, against a
   * port whose first line is "never throws", and this test had pinned that
   * behaviour in place rather than catching it.
   */
  it('turns a throwing body into a returned failure and still frees the lock', async () => {
    const store = createMemoryFileStore()
    const r = await store.withLock('m', async () => {
      throw new Error('boom')
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('files/failed')
      expect(r.error.message).toBe('boom')
    }
    expect(store.held()).toEqual([])
  })

  it('shows a file placed behind its back', async () => {
    const store = createMemoryFileStore()
    store.place('Documents/dropped.pdf', bytesOf('%PDF'))
    const listed = await store.list('Documents')
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.value.map((e) => e.path)).toEqual(['Documents/dropped.pdf'])
  })

  it('gives each write a later mtime, so drift is detectable', async () => {
    const store = createMemoryFileStore()
    const first = await store.write('Documents/a.txt', bytesOf('one'))
    const second = await store.write('Documents/a.txt', bytesOf('two'))
    expect(first.ok && second.ok).toBe(true)
    if (first.ok && second.ok) expect(second.value.mtime).toBeGreaterThan(first.value.mtime)
  })
})
