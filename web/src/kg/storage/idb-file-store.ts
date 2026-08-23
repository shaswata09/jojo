/**
 * L0 — a `FileStore` in IndexedDB. The one that works everywhere.
 *
 * The second implementation of `service/kg/storage/file-store.ts` — the other is
 * `memory-file-store`, which exists for tests — and the one that actually holds
 * a user's documents.
 *
 * IndexedDB because it is the only option present in every browser jojo runs in.
 * Measured on this machine: Chrome and Edge ship `showDirectoryPicker`, Brave
 * does NOT (it strips the pickers while keeping `FileSystemDirectoryHandle` and
 * OPFS, so feature-detecting the handle type reports a false yes), and Firefox
 * and Safari have never shipped it. An adapter over that API was written and
 * deleted for exactly that reason, and so was a local helper process the user
 * would have had to download and run; `docs/NO-SERVER.md` records both.
 *
 * ## Why this can be the whole feature
 *
 * Measured in Brave: a 2.00 GB quota, a 5 MB file written in 15 ms and read back
 * in under 1 ms, bytes identical. Tailored documents for a job search — a CV, a
 * cover letter and a research statement per application — are a few hundred
 * kilobytes each. The quota is three orders of magnitude clear of the use case.
 *
 * ## The one thing this cannot promise
 *
 * Durability against the browser. IndexedDB is evictable: under storage pressure
 * a browser may discard a site's data, and "Clear browsing data" always will.
 * `navigator.storage.persist()` asks for exemption and is granted on engagement
 * heuristics — measured `false` on a fresh profile with no history, which is
 * exactly the state a new user is in.
 *
 * So this layer stores bytes well and guarantees nothing about tomorrow. The
 * honest answer to that is not a warning banner, it is export: bytes that only
 * exist here are one browser setting away from gone, and the app has to make
 * getting them out easy. `persist()` is requested on first write because asking
 * costs nothing, and its answer is reported rather than assumed.
 *
 * ## Paths, in a database with no directories
 *
 * Keys are the port's folder-relative POSIX paths, verbatim — `Documents/CV.pdf`,
 * `jojo/folder.json`, `jojo/Trash/Documents/CV.pdf`. There are no directory
 * records: a directory exists exactly when something is keyed beneath it, which
 * is why `list` of a directory that was never created answers `ok([])` rather
 * than a failure, and why that costs no special case here. `memory-file-store`
 * is shaped the same way for the same reason, and the two pass the same suite.
 */

import { openDB, type IDBPDatabase } from 'idb'
import {
  fileFail,
  fileOk,
  isSwapFile,
  type FileEntry,
  type FileResult,
  type FileStore,
  type VaultIdentity,
} from '@jojo/service/storage/file-store'

const DB_NAME = 'jojo-files'
const STORE = 'blobs'
const IDENTITY_PATH = 'jojo/folder.json'
const TRASH_DIR = 'jojo/Trash'

/** Held names, for the environments with no `navigator.locks`. See `withLock`. */
const localLocks = new Set<string>()

/** What a key holds. `mtime` is ours to mint: there is no filesystem to ask. */
type Record = { data: Uint8Array; mtime: number }

export type IdbFileStoreOptions = {
  /**
   * Injected because `check-platform.mjs` bans wall-clock reads in this layer,
   * and because a test that asserts on mtime needs the values to be its own.
   */
  now: () => number
  /** Overridable so tests can point at a scratch database. */
  dbName?: string
}

export interface IdbFileStore extends FileStore {
  /** Opens the database. Safe to call more than once. */
  open(): Promise<FileResult<void>>
  /**
   * Deletes everything under `jojo/Trash`, reclaiming the space.
   *
   * Beyond the port on purpose, and the port is right to lack it. `trash` never
   * unlinks because for the two folder adapters the folder is the USER'S: jojo
   * put almost nothing in it, and a delete the user did not perform in their own
   * file manager should be recoverable there. None of that holds here. This
   * store is jojo's own, invisible in any file manager, and a trashed document
   * is unreachable by anything in the app — so "never unlinks" stops being a
   * safety net and becomes a quota leak the user cannot see or clear.
   *
   * Returns how many were reclaimed.
   */
  purgeTrash(): Promise<number>
  /** Whether the browser exempted this data from eviction. See the note above. */
  persisted(): Promise<boolean>
}

const messageOf = (e: unknown): string =>
  e instanceof Error ? `${e.name}: ${e.message}` : String(e)

/**
 * Maps a thrown IndexedDB error onto the port's vocabulary.
 *
 * `QuotaExceededError` is the one that matters and the one a filesystem adapter
 * would call `files/quota` too, so a caller handling a full disk already handles
 * a full origin. Everything else is `files/failed`: IndexedDB has no concept of
 * a permission that lapsed or a folder that moved.
 */
const codeOf = (e: unknown): 'quota' | 'failed' =>
  e instanceof Error && e.name === 'QuotaExceededError' ? 'quota' : 'failed'

export function createIdbFileStore(options: IdbFileStoreOptions): IdbFileStore {
  const dbName = options.dbName ?? DB_NAME
  let db: IDBPDatabase | null = null
  let connected = false
  let askedToPersist = false
  /**
   * Set by `forget`, and deliberately not undone by reopening.
   *
   * Without it every method after `forget` quietly reopened the database and
   * answered `files/not-found` — a caller told "no such file" concludes the
   * document was deleted, when the truth is that nothing is connected at all.
   * The contract says every method answers `files/no-folder` after `forget`, and
   * the two readings send a caller to different repairs.
   */
  let forgotten = false

  async function ensure(): Promise<IDBPDatabase> {
    if (db) return db
    db = await openDB(dbName, 1, {
      upgrade(fresh) {
        fresh.createObjectStore(STORE)
      },
    })
    connected = true
    return db
  }

  /**
   * Every method funnels through here, so the two answers that are not about the
   * work are given identically everywhere — the same shape `memory-file-store`
   * uses `guard` for, and for the same reason: a caller must never have to
   * remember which methods can throw. The port's first line is that a method
   * never throws.
   */
  async function attempt<T>(
    what: string,
    path: string | undefined,
    fn: (handle: IDBPDatabase) => Promise<FileResult<T>>,
  ): Promise<FileResult<T>> {
    if (forgotten) return fileFail<T>('files/no-folder', 'no folder is connected')
    try {
      return await fn(await ensure())
    } catch (e) {
      // A blocked IndexedDB — private browsing, a managed browser — is the one
      // case where this adapter genuinely has no folder rather than a failed
      // operation, and `files/no-folder` is the answer the app already renders.
      if (!connected) return fileFail<T>('files/no-folder', `${what}: ${messageOf(e)}`)
      return fileFail<T>(`files/${codeOf(e)}`, `${what}: ${messageOf(e)}`, { path })
    }
  }

  const entryOf = (path: string, rec: Record): FileEntry => ({
    path,
    bytes: rec.data.byteLength,
    mtime: rec.mtime,
  })

  /**
   * Asks the browser not to evict, once, on the first write.
   *
   * On write rather than at construction: `persist()` is judged on engagement,
   * and a user who has just saved their first document is a better case than a
   * page that has only been opened. Never awaited by the caller — the answer
   * changes nothing about whether the write succeeds.
   */
  function requestPersistence(): void {
    if (askedToPersist) return
    askedToPersist = true
    void navigator.storage?.persist?.().catch(() => false)
  }

  return {
    // Synchronous, because every render asks. False only until `open()` has
    // resolved, or permanently if IndexedDB is blocked outright.
    connected: () => connected,

    open: async () =>
      attempt<void>('open', undefined, async () => fileOk(undefined)),

    persisted: async () => {
      try {
        return (await navigator.storage?.persisted?.()) ?? false
      } catch {
        return false
      }
    },

    identity: async () =>
      attempt<VaultIdentity>('identity', IDENTITY_PATH, async (handle) => {
        const rec = (await handle.get(STORE, IDENTITY_PATH)) as Record | undefined
        if (rec === undefined) {
          return fileFail<VaultIdentity>('files/not-found', 'no vault marker', {
            path: IDENTITY_PATH,
          })
        }
        const parsed: unknown = JSON.parse(new TextDecoder().decode(rec.data))
        // Validated rather than cast, exactly as the other two adapters do: the
        // marker is what distinguishes our data from somebody else's, so reading
        // it is the one place a cast would defeat the purpose.
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          typeof (parsed as VaultIdentity).vaultId !== 'string'
        ) {
          return fileFail<VaultIdentity>('files/failed', 'marker is not an identity', {
            path: IDENTITY_PATH,
          })
        }
        return fileOk(parsed as VaultIdentity)
      }),

    list: async (dir) =>
      attempt<readonly FileEntry[]>('list', dir, async (handle) => {
        const prefix = dir === '' ? '' : `${dir.replace(/\/$/, '')}/`
        const out: FileEntry[] = []
        for (const key of (await handle.getAllKeys(STORE)) as string[]) {
          if (!key.startsWith(prefix)) continue
          // Non-recursive: anything with a separator left after the prefix lives
          // in a directory below this one.
          if (key.slice(prefix.length).includes('/')) continue
          // Nothing here writes a `.crswap`, but a folder mirrored from the File
          // System Access adapter can carry one, and a caller must not have to
          // remember which store it is talking to.
          if (isSwapFile(key)) continue
          const rec = (await handle.get(STORE, key)) as Record | undefined
          if (rec) out.push(entryOf(key, rec))
        }
        return fileOk(out)
      }),

    stat: async (path) =>
      attempt<FileEntry>('stat', path, async (handle) => {
        const rec = (await handle.get(STORE, path)) as Record | undefined
        return rec === undefined
          ? fileFail<FileEntry>('files/not-found', 'no such file', { path })
          : fileOk(entryOf(path, rec))
      }),

    read: async (path) =>
      attempt<Uint8Array>('read', path, async (handle) => {
        const rec = (await handle.get(STORE, path)) as Record | undefined
        if (rec === undefined) {
          return fileFail<Uint8Array>('files/not-found', 'no such file', { path })
        }
        // Copied on the way out, and measurably redundant here: IndexedDB
        // structured-clones on both `put` and `get`, so mutating a caller's
        // buffer after a write leaves the stored bytes untouched — verified, and
        // the reason the two aliasing cases in the suite cannot fail for this
        // adapter. Kept because the contract is written against the PORT, not
        // against one engine's cloning behaviour.
        return fileOk(rec.data.slice())
      }),

    write: async (path, data) =>
      attempt<FileEntry>('write', path, async (handle) => {
        requestPersistence()
        // Copied for the same reason as `read`, and just as unobservably: the
        // structured clone has already happened by the time `put` resolves.
        const rec: Record = { data: data.slice(), mtime: options.now() }
        await handle.put(STORE, rec, path)
        return fileOk(entryOf(path, rec))
      }),

    exists: async (path) =>
      attempt<boolean>('exists', path, async (handle) => {
        const key = await handle.getKey(STORE, path)
        return fileOk(key !== undefined)
      }),

    trash: async (path) =>
      attempt<void>('trash', path, async (handle) => {
        const rec = (await handle.get(STORE, path)) as Record | undefined
        if (rec === undefined) {
          return fileFail<void>('files/not-found', 'no such file', { path })
        }
        // Moved, never deleted, and keyed by the FULL relative path. Keying by
        // basename destroyed data in an earlier version of the other adapter:
        // two documents called CV.pdf in different directories collapsed onto one
        // name and the second silently overwrote the first — in the one method
        // whose whole promise is that nothing is unrecoverable.
        //
        // One transaction, so a failure between the two cannot lose the file.
        const tx = handle.transaction(STORE, 'readwrite')
        await tx.store.put(rec, `${TRASH_DIR}/${path}`)
        await tx.store.delete(path)
        await tx.done
        return fileOk(undefined)
      }),

    url: async (path) =>
      attempt<string>('url', path, async (handle) => {
        const rec = (await handle.get(STORE, path)) as Record | undefined
        if (rec === undefined) {
          return fileFail<string>('files/not-found', 'no such file', { path })
        }
        // A blob: URL the viewer can point an iframe at. The caller revokes it —
        // this port has no lifecycle hook to do it here, and holding one open
        // pins the bytes in memory for as long as the document lives.
        const copy = rec.data.slice()
        return fileOk(URL.createObjectURL(new Blob([copy as unknown as BlobPart])))
      }),

    withLock: async <T>(name: string, fn: () => Promise<T>): Promise<FileResult<T>> => {
      if (forgotten) return fileFail<T>('files/no-folder', 'no folder is connected')
      // `navigator.locks` is the right answer where it exists, because only it
      // excludes across TABS. Where it does not — a worker without it, a test
      // runner, an older engine — falling back to an in-process lock is strictly
      // better than refusing: same-tab exclusion is most of the value, and
      // returning `files/unsupported` would make every caller branch on the
      // environment instead of on the result.
      if (typeof navigator === 'undefined' || navigator.locks === undefined) {
        if (localLocks.has(name)) {
          return fileFail<T>('files/failed', 'lock is already held', { lock: name })
        }
        localLocks.add(name)
        try {
          return fileOk(await fn())
        } catch (e) {
          return fileFail<T>('files/failed', messageOf(e), { lock: name })
        } finally {
          localLocks.delete(name)
        }
      }
      try {
        return await navigator.locks.request(
          `jojo-files:${name}`,
          // Reentrancy is a deadlock, not a queue: a re-entrant request against
          // `navigator.locks` blocks forever, and a write that awaited itself
          // would take the feature down with no error anywhere.
          { ifAvailable: true },
          async (lock) => {
            if (lock === null) {
              return fileFail<T>('files/failed', 'lock is already held', { lock: name })
            }
            return fileOk(await fn())
          },
        )
      } catch (e) {
        // Caught, not propagated — including whatever `fn` threw. Every consumer
        // branches on `result.ok`, so a throw lands in whatever `await` happens
        // to be upstream and becomes an unhandled rejection nobody sees.
        return fileFail<T>('files/failed', messageOf(e), { lock: name })
      }
    },

    purgeTrash: async () => {
      if (forgotten) return 0
      try {
        const handle = await ensure()
        const keys = (await handle.getAllKeys(STORE)) as string[]
        const doomed = keys.filter((k) => k.startsWith(`${TRASH_DIR}/`))
        // One transaction: a purge that half-completes leaves keys that the next
        // sweep will find anyway, but doing it atomically means the count
        // returned is the count actually freed.
        const tx = handle.transaction(STORE, 'readwrite')
        for (const key of doomed) await tx.store.delete(key)
        await tx.done
        return doomed.length
      } catch {
        // A purge is housekeeping. Failing it must never surface to the user or
        // stop anything else — the space is still there to reclaim next time.
        return 0
      }
    },

    /**
     * Drops everything.
     *
     * Unlike the other two adapters, `forget` here IS destructive, and the
     * difference is not a bug: for those the folder is the user's and survives
     * disconnecting, whereas this store IS the storage. Nothing else holds the
     * bytes. A caller offering this to a person has to say so in those words.
     */
    forget: async () => {
      try {
        const handle = await ensure()
        await handle.clear(STORE)
      } catch {
        // Already unreachable; there is nothing left to forget.
      }
      connected = false
      forgotten = true
    },
  }
}
