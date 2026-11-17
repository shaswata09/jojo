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
 *
 * ## Two stores: the bytes, and what `list` needs
 *
 * `blobs` holds each file's bytes; `meta` holds `{ bytes, mtime }` under the
 * same key, written in the same transaction. `list` answers from `meta` alone.
 * Before it existed, `list` read every document in full to report two numbers —
 * forty 1 MB documents meant 40 MB read on every page load. Version 2 created
 * `meta` and filled it once from the existing blobs; `list` still backfills a
 * key it finds without one, so a gap costs one read, never a wrong answer.
 *
 * A key under `jojo/Trash` carries two more fields in `meta`: `trashedAt`, when
 * `trash` moved it there, and `from`, the exact path it was moved from. Both
 * exist for the Vault's retention (`vault-blobs.ts`, `TRASH_RETENTION_MS`). The
 * copy's own `mtime` is the time its BYTES were written, carried over by the
 * move, so it cannot say how long a copy has been in the trash; and its key
 * cannot always say where it came from — see `TrashEntry.from`.
 */

import { openDB, type IDBPDatabase } from 'idb'
import {
  fileFail,
  fileOk,
  isSwapFile,
  trashPath,
  type FileEntry,
  type FileFailure,
  type FileResult,
  type FileStore,
  type VaultIdentity,
} from '@jojo/service/storage/file-store'

const DB_NAME = 'jojo-files'
const STORE = 'blobs'
/** `{ bytes, mtime }` per key. See "Two stores" above. */
const META = 'meta'
const DB_VERSION = 2
const IDENTITY_PATH = 'jojo/folder.json'
const TRASH_DIR = 'jojo/Trash'

/**
 * How long an open waits on another tab before this store gives up and says so.
 *
 * The same five seconds `idb-driver` waits for the graph database, for the same
 * reasons: the usual blocker is the person's own other tab, which they close,
 * and the unusual one is a tab pinned months ago that nobody will close, which
 * must not leave the Vault waiting forever with nothing on screen. A build from
 * before version 2 has no `versionchange` handler, so its tab never lets go on
 * its own — measured: `list` and `open` were both still pending after three
 * seconds, and stayed pending until that tab closed.
 */
const BLOCKED_GRACE_MS = 5_000

/**
 * The context a blocked open carries on its `files/failed`.
 *
 * Context rather than a new failure code, because the port's codes are shared
 * with the phone and the folder adapters and none of them can be blocked like
 * this. The sentence the person reads ("close the other jojo tabs") is minted
 * above this layer, as the port says every user-facing sentence is.
 */
const BLOCKED_CONTEXT = { blocked: true } as const

/** Thrown into `attempt` when the grace period runs out. Never escapes this file. */
class BlockedOpen extends Error {
  override name = 'BlockedOpen'
}

/**
 * Where `trash` puts its nth copy of a path. Re-exported for `vault-blobs`,
 * whose Undo reads a copy back, so the app reaches the naming through this
 * adapter rather than importing the storage port directly.
 */
export { trashPath }

/** Whether a failure is a blocked open rather than a broken store. */
export const isBlockedFailure = (error: FileFailure): boolean => error.context?.['blocked'] === true

/** Held names, for the environments with no `navigator.locks`. See `withLock`. */
const localLocks = new Set<string>()

/** What a key holds. `mtime` is ours to mint: there is no filesystem to ask. */
type Record = { data: Uint8Array; mtime: number }
/**
 * What `list` and `stat` need, without the bytes — and, for a trashed key, when
 * it was trashed and from where. See "Two stores" above.
 */
type Meta = { bytes: number; mtime: number; trashedAt?: number; from?: string }

/**
 * One trashed copy, as `listTrash` reports it.
 *
 * `trashedAt` is always present: a copy trashed before the field existed is
 * stamped with the moment it is first listed — "trashed now" — so the oldest
 * copies on an upgraded device get a full retention window rather than none.
 *
 * `from` is the path `trash` moved it from, exactly. The key alone cannot say:
 * `trashPath` numbers a second copy of `CV.pdf` as `CV (2).pdf`, and a document
 * that was CALLED `CV (2).pdf` before it was ever trashed has the same key.
 * Absent on a copy trashed before the field existed — the caller parses the key,
 * as it always did.
 */
export type TrashEntry = FileEntry & { readonly trashedAt: number; readonly from?: string }

export type IdbFileStoreOptions = {
  /**
   * Injected because `check-platform.mjs` bans wall-clock reads in this layer,
   * and because a test that asserts on mtime needs the values to be its own.
   */
  now: () => number
  /** Overridable so tests can point at a scratch database. */
  dbName?: string
  /** Overridable so a test need not wait the full grace. See `BLOCKED_GRACE_MS`. */
  blockedGraceMs?: number
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
   *
   * `only`, when given, is asked about every trashed key and only those it
   * answers true for go. The Vault passes it so the sweep is decided by the
   * records rather than by the folder: a trashed document whose record an Undo
   * brought back is not unreachable, it is waiting to be put back — and
   * emptying the whole trash on every load deleted exactly those (review
   * 2026-11-17, health-1). Without it, everything under `jojo/Trash` goes, as
   * before.
   */
  purgeTrash(only?: (key: string) => boolean): Promise<number>
  /**
   * The copies directly under a folder of `jojo/Trash`, with when each was
   * trashed and the path it came from. See `TrashEntry`.
   *
   * Beyond the port for the same reason as `purgeTrash`: retention is this
   * store's question, because only here is the trash jojo's own. A copy with no
   * `trashedAt` — trashed by a build from before it was recorded — is stamped
   * with `now()` as it is listed, and the stamp is kept, so the window starts
   * once rather than on every load. Fails for a folder outside `jojo/Trash`.
   */
  listTrash(dir: string): Promise<FileResult<readonly TrashEntry[]>>
  /** Whether the browser exempted this data from eviction. See the note above. */
  persisted(): Promise<boolean>
}

const metaOf = (rec: Record): Meta => ({ bytes: rec.data.byteLength, mtime: rec.mtime })

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
  /*
   * The open, memoised as a promise rather than the handle: two first calls
   * arriving together used to open two connections, and the first was left
   * open and unreferenced — which then blocked the next version upgrade.
   */
  let opening: Promise<IDBPDatabase> | null = null
  /**
   * Rejects once the open in `opening` has been blocked for the whole grace.
   *
   * Raced beside `opening` rather than replacing it. The open itself is left
   * pending, so it completes the moment the other tab lets go and the next call
   * simply finds the database open — no second request queued behind the first,
   * and no connection opened late that nobody holds (which would block the NEXT
   * upgrade the way this one was blocked). Until then every call fails at once
   * with `files/failed` instead of each one waiting out its own grace.
   */
  let stalled: Promise<never> | null = null
  const grace = options.blockedGraceMs ?? BLOCKED_GRACE_MS
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

  function ensure(): Promise<IDBPDatabase> {
    // `opening` first: once the open has landed it wins the race even though
    // `stalled` rejected long ago, because a race between two settled promises
    // goes to the one listed first.
    if (opening) return stalled ? Promise.race([opening, stalled]) : opening
    let giveUp: (error: Error) => void = () => {}
    const stall = new Promise<never>((_resolve, reject) => {
      giveUp = reject
    })
    // Only ever observed through the race above; never an unhandled rejection.
    stall.catch(() => {})
    let timer: ReturnType<typeof setTimeout> | null = null
    const pending = openDB(dbName, DB_VERSION, {
      async upgrade(fresh, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) fresh.createObjectStore(STORE)
        if (oldVersion < 2) {
          const meta = fresh.createObjectStore(META)
          // The one time every blob is read: to write what `list` needs.
          let cursor = await tx.objectStore(STORE).openCursor()
          while (cursor) {
            const rec = cursor.value as Record
            await meta.put(metaOf(rec), cursor.key)
            cursor = await cursor.continue()
          }
        }
      },
      /*
       * An older connection in another tab is in the way of this upgrade — a
       * tab still running a build from before version 2, which has no
       * `versionchange` handler and so never lets go by itself. Waited on for
       * the grace, then reported; see `stalled`.
       */
      blocked() {
        timer ??= setTimeout(() => {
          giveUp(new BlockedOpen('another tab holds an older version of the database open'))
        }, grace)
      },
      /*
       * Another tab wants a newer version. Holding this connection open would
       * stall that tab's open until this one closed, so let go; the next call
       * here reopens — and meets the newer version, which is the right failure.
       */
      blocking() {
        void pending.then((handle) => {
          handle.close()
        })
        if (opening === pending) opening = null
      },
      // The browser closed it (storage cleared, a crash). Reopen next time.
      terminated() {
        if (opening === pending) opening = null
      },
    }).then(
      (handle) => {
        if (timer !== null) clearTimeout(timer)
        if (opening === pending) stalled = null
        connected = true
        return handle
      },
      (error: unknown) => {
        if (timer !== null) clearTimeout(timer)
        // Not memoised: a failed open (blocked IndexedDB, a version error) is
        // tried again by the next call rather than answered from a dead promise.
        if (opening === pending) {
          opening = null
          stalled = null
        }
        throw error
      },
    )
    opening = pending
    stalled = stall
    return Promise.race([pending, stall])
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
      // Not a missing folder and not a broken store: the database is there and
      // another tab is holding it. Said apart from both, because the remedy —
      // close the other jojo tabs — is the only one that works.
      if (e instanceof BlockedOpen) {
        return fileFail<T>('files/failed', `${what}: ${e.message}`, { ...BLOCKED_CONTEXT, path })
      }
      // A blocked IndexedDB — private browsing, a managed browser — is the one
      // case where this adapter genuinely has no folder rather than a failed
      // operation, and `files/no-folder` is the answer the app already renders.
      if (!connected) return fileFail<T>('files/no-folder', `${what}: ${messageOf(e)}`)
      return fileFail<T>(`files/${codeOf(e)}`, `${what}: ${messageOf(e)}`, { path })
    }
  }

  const entryOf = (path: string, rec: Record | Meta): FileEntry => ({
    path,
    bytes: 'data' in rec ? rec.data.byteLength : rec.bytes,
    mtime: rec.mtime,
  })

  /** The metadata for a key, backfilled from the blob if it has none. */
  async function metaFor(handle: IDBPDatabase, key: string): Promise<Meta | undefined> {
    const meta = (await handle.get(META, key)) as Meta | undefined
    if (meta !== undefined) return meta
    const rec = (await handle.get(STORE, key)) as Record | undefined
    if (rec === undefined) return undefined
    const made = metaOf(rec)
    await handle.put(META, made, key)
    return made
  }

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

    open: async () => attempt<void>('open', undefined, async () => fileOk(undefined)),

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
          // From `meta`, not the blob: see "Two stores" at the top.
          const meta = await metaFor(handle, key)
          if (meta) out.push(entryOf(key, meta))
        }
        return fileOk(out)
      }),

    stat: async (path) =>
      attempt<FileEntry>('stat', path, async (handle) => {
        const meta = await metaFor(handle, path)
        return meta === undefined
          ? fileFail<FileEntry>('files/not-found', 'no such file', { path })
          : fileOk(entryOf(path, meta))
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
        // Both or neither, so `list` never reports a size the bytes do not have.
        const tx = handle.transaction([STORE, META], 'readwrite')
        await tx.objectStore(STORE).put(rec, path)
        await tx.objectStore(META).put(metaOf(rec), path)
        await tx.done
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
        //
        // Probed inside that transaction, so the free name it finds is still
        // free when the put lands — an earlier copy trashed from the same path
        // is never overwritten. See `trashPath`.
        const tx = handle.transaction([STORE, META], 'readwrite')
        const blobs = tx.objectStore(STORE)
        const meta = tx.objectStore(META)
        let n = 1
        while ((await blobs.getKey(trashPath(path, n))) !== undefined) n += 1
        await blobs.put(rec, trashPath(path, n))
        // When and from where, for the Vault's retention and its restore. See
        // `TrashEntry`.
        const stamped: Meta = { ...metaOf(rec), trashedAt: options.now(), from: path }
        await meta.put(stamped, trashPath(path, n))
        await blobs.delete(path)
        await meta.delete(path)
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

    listTrash: async (dir) =>
      attempt<readonly TrashEntry[]>('listTrash', dir, async (handle) => {
        const prefix = `${dir.replace(/\/$/, '')}/`
        if (!prefix.startsWith(`${TRASH_DIR}/`)) {
          return fileFail<readonly TrashEntry[]>('files/failed', 'not a trash folder', {
            path: dir,
          })
        }
        const out: TrashEntry[] = []
        for (const key of (await handle.getAllKeys(STORE)) as string[]) {
          if (!key.startsWith(prefix) || key.slice(prefix.length).includes('/')) continue
          const meta = await metaFor(handle, key)
          if (meta === undefined) continue
          let trashedAt = meta.trashedAt
          if (trashedAt === undefined) {
            // Trashed before this was recorded: counted from now, and kept, so
            // the next load does not start the window again.
            trashedAt = options.now()
            await handle.put(META, { ...meta, trashedAt }, key)
          }
          out.push({
            ...entryOf(key, meta),
            trashedAt,
            ...(meta.from === undefined ? {} : { from: meta.from }),
          })
        }
        return fileOk(out)
      }),

    purgeTrash: async (only) => {
      if (forgotten) return 0
      try {
        const handle = await ensure()
        const keys = (await handle.getAllKeys(STORE)) as string[]
        const doomed = keys.filter(
          (k) => k.startsWith(`${TRASH_DIR}/`) && (only === undefined || only(k)),
        )
        // One transaction: a purge that half-completes leaves keys that the next
        // sweep will find anyway, but doing it atomically means the count
        // returned is the count actually freed.
        const tx = handle.transaction([STORE, META], 'readwrite')
        for (const key of doomed) {
          await tx.objectStore(STORE).delete(key)
          await tx.objectStore(META).delete(key)
        }
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
        const tx = handle.transaction([STORE, META], 'readwrite')
        await tx.objectStore(STORE).clear()
        await tx.objectStore(META).clear()
        await tx.done
      } catch {
        // Already unreachable; there is nothing left to forget.
      }
      connected = false
      forgotten = true
    },
  }
}
