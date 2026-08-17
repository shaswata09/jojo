/**
 * L0 — an in-RAM `FileStore`. The reference implementation.
 *
 * Its job is the conformance suite. The File System Access adapter can only be
 * exercised in a real browser with a real user-granted directory handle, so
 * every layer above the port — reconcile, restore, the mirror — would otherwise
 * be untestable in Vitest, and D20 already forbids mounting the components that
 * consume them. This is what keeps that layer honest.
 *
 * It also ships. `memory-driver.ts` runs the whole app when IndexedDB is blocked
 * in private browsing; this is the equivalent for a session with no folder, so a
 * caller never has to branch on whether a store exists — `connected()` is false
 * and every method returns `files/no-folder`, which is a normal answer.
 *
 * Shaped after `memory-driver.ts` deliberately, including `fault`: the failure
 * paths that matter most here — a lapsed permission mid-write, a full disk, a
 * folder that vanished — cannot be provoked from an in-RAM Map, and "we will
 * find out when a user hits it" is not an answer for the code holding their CV.
 */

import {
  fileFail,
  fileOk,
  isSwapFile,
  type FileEntry,
  type FileFailure,
  type FileResult,
  type FileStore,
  type VaultIdentity,
} from './file-store'

/** Every call a test can fault. Named for the port method that makes it. */
export type FileCall =
  'identity' | 'list' | 'stat' | 'read' | 'write' | 'exists' | 'trash' | 'url' | 'withLock'

export type MemoryFileStoreOptions = {
  /** Files the folder already holds. Keys are folder-relative POSIX paths. */
  files?: Readonly<Record<string, Uint8Array>>
  identity?: VaultIdentity
  /** Start disconnected — the no-folder session, which is most of them. */
  disconnected?: boolean
  /** Test-only. Returns a failure to serve instead of doing the work. */
  fault?: (call: FileCall, path?: string) => FileFailure | null
}

/** The port, plus the seams only a test uses. */
export interface MemoryFileStore extends FileStore {
  /** What is actually in the folder, including anything jojo did not write. */
  snapshot(): Record<string, Uint8Array>
  /** Puts a file there behind jojo's back — a user dropping one in via Finder. */
  place(path: string, data: Uint8Array): void
  /** Removes one behind jojo's back — the drift case the whole feature fears. */
  remove(path: string): void
  /** Locks currently held, to assert mutual exclusion without a second tab. */
  held(): readonly string[]
}

const enc = new TextEncoder()

export function createMemoryFileStore(options: MemoryFileStoreOptions = {}): MemoryFileStore {
  const files = new Map<string, { data: Uint8Array; mtime: number }>()
  // Monotonic and synthetic rather than a clock read: `check-platform.mjs` bans
  // wall-clock reads in `storage`, and a test that asserts on mtime drift needs
  // the values to be predictable anyway.
  let tick = 1_000
  const nextTick = () => (tick += 1)

  for (const [path, data] of Object.entries(options.files ?? {})) {
    files.set(path, { data, mtime: nextTick() })
  }

  let connected = options.disconnected !== true
  const locks = new Set<string>()
  const identity: VaultIdentity = options.identity ?? {
    vaultId: 'vault-memory',
    createdAt: '2026-01-01T00:00:00.000Z',
    appVersion: 'test',
  }

  const fault = (call: FileCall, path?: string): FileFailure | null =>
    options.fault?.(call, path) ?? null

  /**
   * Every method funnels through here so the two answers that are not about the
   * work — no folder, and an injected fault — are given identically everywhere.
   * The adapter has the same shape for the same reason: a caller must never have
   * to remember which methods check connectedness.
   */
  function guard<T>(call: FileCall, path?: string): FileResult<T> | null {
    if (!connected) return fileFail<T>('files/no-folder', 'no folder is connected')
    const f = fault(call, path)
    return f === null ? null : { ok: false, error: f }
  }

  const entryOf = (path: string, rec: { data: Uint8Array; mtime: number }): FileEntry => ({
    path,
    bytes: rec.data.byteLength,
    mtime: rec.mtime,
  })

  return {
    connected: () => connected,

    identity: async () => guard<VaultIdentity>('identity') ?? fileOk(identity),

    list: async (dir) => {
      const bad = guard<readonly FileEntry[]>('list', dir)
      if (bad) return bad
      const prefix = dir === '' ? '' : `${dir}/`
      const out: FileEntry[] = []
      for (const [path, rec] of files) {
        if (!path.startsWith(prefix)) continue
        // Non-recursive: a nested path is not an entry of this directory.
        if (path.slice(prefix.length).includes('/')) continue
        // Chrome never reaps a `.crswap` orphaned by a hard kill and it shows up
        // in `entries()`. Filtering here rather than at each call site means a
        // caller cannot forget and rebuild a half-written file into a record.
        if (isSwapFile(path)) continue
        out.push(entryOf(path, rec))
      }
      return fileOk(out)
    },

    stat: async (path) => {
      const bad = guard<FileEntry>('stat', path)
      if (bad) return bad
      const rec = files.get(path)
      return rec === undefined
        ? fileFail<FileEntry>('files/not-found', 'no such file', { path })
        : fileOk(entryOf(path, rec))
    },

    read: async (path) => {
      const bad = guard<Uint8Array>('read', path)
      if (bad) return bad
      const rec = files.get(path)
      return rec === undefined
        ? fileFail<Uint8Array>('files/not-found', 'no such file', { path })
        : // Copied on the way out too, for the same reason: `read` on a real
          // adapter yields a fresh buffer, and handing back the stored one lets
          // a caller mutate the folder by accident.
          fileOk(rec.data.slice())
    },

    write: async (path, data) => {
      const bad = guard<FileEntry>('write', path)
      if (bad) return bad
      // Copied, not aliased. A real filesystem takes the bytes; this held the
      // caller's array, so a caller reusing its buffer — which is the normal
      // thing to do with a reader — silently rewrote a file already "on disk".
      // A fake that is more forgiving than the real adapter hides exactly the
      // bugs it exists to catch.
      const rec = { data: data.slice(), mtime: nextTick() }
      files.set(path, rec)
      return fileOk(entryOf(path, rec))
    },

    exists: async (path) => guard<boolean>('exists', path) ?? fileOk(files.has(path)),

    trash: async (path) => {
      const bad = guard<void>('trash', path)
      if (bad) return bad
      const rec = files.get(path)
      if (rec === undefined) return fileFail<void>('files/not-found', 'no such file', { path })
      files.delete(path)
      // Moved, never unlinked. The folder is the user's, and a delete they did
      // not perform in their own file manager should be recoverable there.
      //
      // The FULL relative path, not the basename. Keying Trash by basename made
      // `trash` destroy data: two documents called `CV.pdf` in different
      // directories collapsed onto `jojo/Trash/CV.pdf` and the second silently
      // overwrote the first — in the one method whose entire documented promise
      // is that nothing is ever unrecoverable.
      files.set(`jojo/Trash/${path}`, rec)
      return fileOk(undefined)
    },

    url: async (path) => {
      const bad = guard<string>('url', path)
      if (bad) return bad
      return files.has(path)
        ? fileOk(`memory:${path}`)
        : fileFail<string>('files/not-found', 'no such file', { path })
    },

    withLock: async <T>(name: string, fn: () => Promise<T>): Promise<FileResult<T>> => {
      const bad = guard<T>('withLock', name)
      if (bad) return bad
      // Reentrancy is a deadlock, not a queue: `navigator.locks` would block
      // forever, and a mirror write that awaited itself would take the whole
      // feature down silently. Failing loudly here is what surfaces it in a test
      // rather than in a user's session.
      if (locks.has(name)) {
        return fileFail<T>('files/failed', 'lock is already held', { lock: name })
      }
      locks.add(name)
      try {
        return fileOk(await fn())
      } catch (e) {
        // Caught, not propagated. The port's first line is "never throws", and
        // this was the one method that did — the body's rejection travelled
        // straight through `finally` to the caller. Every consumer of a
        // `FileStore` is written to branch on `result.ok`, so a throw here lands
        // in whatever `await` happens to be upstream: inside the debounced
        // mirror chain that is an unhandled rejection nobody sees and a mirror
        // that silently stops, which is the exact silent-wedge shape the audit
        // found twice in the write queue.
        return fileFail<T>('files/failed', e instanceof Error ? e.message : String(e), {
          lock: name,
        })
      } finally {
        locks.delete(name)
      }
    },

    forget: async () => {
      connected = false
      files.clear()
    },

    snapshot: () => Object.fromEntries([...files].map(([p, r]) => [p, r.data])),
    place: (path, data) => void files.set(path, { data: data.slice(), mtime: nextTick() }),
    remove: (path) => void files.delete(path),
    held: () => [...locks],
  }
}

/** Convenience for fixtures — `bytesOf('hello')`. */
export const bytesOf = (text: string): Uint8Array => enc.encode(text)
