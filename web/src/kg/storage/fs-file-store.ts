/**
 * L0 — a `FileStore` over the File System Access API. The adapter that actually
 * holds the user's documents.
 *
 * `memory-file-store.ts` is the reference implementation and the thing this is
 * checked against: both run `file-store-conformance.ts`, which exists precisely
 * because these two "cannot run in the same place". That suite runs here from a
 * CDP harness (`scripts/fs-conformance.html`) rather than from Vitest, because
 * every method below needs a real `FileSystemDirectoryHandle` and jsdom has no
 * such thing.
 *
 * The harness gets its handle from OPFS — `navigator.storage.getDirectory()`
 * returns the same `FileSystemDirectoryHandle` interface with no picker and no
 * user gesture. That is what makes this adapter testable at all: the app hands
 * it a directory the user granted, a test hands it an origin-private one, and
 * nothing below can tell the difference.
 *
 * ## What this does not do
 *
 * It does not pick a folder, and it does not persist one. Binding is `adopt`,
 * and it takes a handle somebody else obtained. `showDirectoryPicker` needs a
 * user gesture and belongs to a click handler; persisting the handle is
 * IndexedDB's job. Keeping both out means this file is a pure translation of one
 * interface into another and can be exercised without either.
 */

import {
  fileFail,
  fileOk,
  isSwapFile,
  type FileEntry,
  type FileResult,
  type FileStore,
  type VaultIdentity,
} from '@jojo/service/storage/file-store'

/** Where the identity file lives, relative to the folder root. */
const IDENTITY_PATH = 'jojo/folder.json'

/** Everything `trash` moves is re-rooted here, keeping its relative path. */
const TRASH_DIR = 'jojo/Trash'

export type FsFileStoreOptions = {
  /**
   * The granted directory, or null for a session without one — which is most of
   * them. A null root is not an error state: `connected()` answers false and
   * every method returns `files/no-folder`, exactly as the memory store does
   * when constructed `disconnected`.
   */
  root?: FileSystemDirectoryHandle | null
}

export interface FsFileStore extends FileStore {
  /** Binds a directory the caller obtained and the user granted. */
  adopt(root: FileSystemDirectoryHandle): void
}

/**
 * Whether this browser can do any of it.
 *
 * Named and exported because the answer drives a user-facing sentence and a
 * disabled button, and `files/unsupported` is documented on the port as
 * "Safari, Firefox" — neither ships `showDirectoryPicker`. A caller that asks
 * before offering the control gets to say so instead of failing on the click.
 */
export const folderSupported = (): boolean =>
  typeof globalThis !== 'undefined' && 'showDirectoryPicker' in globalThis

/**
 * Maps a DOMException onto the port's vocabulary.
 *
 * By `name`, never by message: messages are localised and Chrome has changed
 * them. The two that matter most are indistinguishable by anything else —
 * `NotAllowedError` is a lapsed grant and recoverable with one gesture, while
 * `NotFoundError` on the ROOT is a folder that moved and recoverable only by
 * picking again. Collapsing them into `files/failed` would put both behind the
 * same dead-end message.
 */
function codeOf(e: unknown): 'denied' | 'not-found' | 'quota' | 'failed' {
  const name = e instanceof Error ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError') return 'not-found'
  if (name === 'QuotaExceededError') return 'quota'
  return 'failed'
}

const messageOf = (e: unknown): string =>
  e instanceof Error ? `${e.name}: ${e.message}` : String(e)

/** POSIX split that tolerates the leading/trailing slashes callers produce. */
const segmentsOf = (path: string): string[] => path.split('/').filter((s) => s.length > 0)

export function createFsFileStore(options: FsFileStoreOptions = {}): FsFileStore {
  let root: FileSystemDirectoryHandle | null = options.root ?? null

  /**
   * Walks to the directory holding `path`, optionally creating it.
   *
   * Returns the parent and the basename rather than the file, because `write`
   * needs `getFileHandle(name, { create: true })` on the parent and `read` needs
   * the same call without it — and doing the walk twice is how the two drift.
   */
  async function locate(
    path: string,
    create: boolean,
  ): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
    if (root === null) throw new Error('no folder')
    const parts = segmentsOf(path)
    const name = parts.pop()
    if (name === undefined) throw new DOMException('empty path', 'NotFoundError')
    let dir = root
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create })
    return { dir, name }
  }

  /**
   * The one place a thrown DOMException becomes a returned failure.
   *
   * Every method funnels through here for the same reason the memory store
   * funnels through `guard`: the two answers that are not about the work — no
   * folder, and the platform throwing — must be given identically everywhere, or
   * a caller has to remember which methods can throw. The port's first line is
   * that a method never throws, and this is what makes that true rather than
   * intended.
   */
  async function attempt<T>(
    what: string,
    path: string | undefined,
    fn: () => Promise<FileResult<T>>,
  ): Promise<FileResult<T>> {
    if (root === null) return fileFail<T>('files/no-folder', 'no folder is connected')
    try {
      return await fn()
    } catch (e) {
      const kind = codeOf(e)
      // A `NotFoundError` while resolving the ROOT is the folder itself being
      // gone — moved, renamed, unmounted — which is a different repair from a
      // missing file inside a folder that is still there. Distinguished by
      // asking the root whether it still answers.
      if (kind === 'not-found' && !(await rootAlive())) {
        return fileFail<T>('files/gone', `${what}: folder is unreachable`, { path })
      }
      return fileFail<T>(`files/${kind}`, `${what}: ${messageOf(e)}`, { path })
    }
  }

  /** Cheapest question that distinguishes "file missing" from "folder missing". */
  async function rootAlive(): Promise<boolean> {
    if (root === null) return false
    try {
      // Iterating is the only universally available liveness probe: `queryPermission`
      // is behind a prefix on some builds and says nothing about reachability.
      for await (const _ of root.keys()) break
      return true
    } catch {
      return false
    }
  }

  const entryOf = async (path: string, handle: FileSystemFileHandle): Promise<FileEntry> => {
    const file = await handle.getFile()
    return { path, bytes: file.size, mtime: file.lastModified }
  }

  return {
    connected: () => root !== null,

    adopt: (next) => void (root = next),

    identity: async () =>
      attempt<VaultIdentity>('identity', IDENTITY_PATH, async () => {
        const { dir, name } = await locate(IDENTITY_PATH, false)
        const file = await (await dir.getFileHandle(name)).getFile()
        const parsed: unknown = JSON.parse(await file.text())
        // Validated, not cast. This file is in a folder the user owns and can
        // edit, so it is untrusted input in the same sense a pasted URL is —
        // and the whole point of reading it is to refuse a folder that is not
        // ours. A cast here would adopt anything with a `.json` extension.
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          typeof (parsed as VaultIdentity).vaultId !== 'string'
        ) {
          return fileFail<VaultIdentity>('files/failed', 'folder.json is not an identity', {
            path: IDENTITY_PATH,
          })
        }
        return fileOk(parsed as VaultIdentity)
      }),

    list: async (dir) =>
      attempt<readonly FileEntry[]>('list', dir, async () => {
        let handle = root as FileSystemDirectoryHandle
        try {
          for (const part of segmentsOf(dir)) handle = await handle.getDirectoryHandle(part)
        } catch (e) {
          // A directory that does not exist lists as empty, not as an error.
          //
          // The contract's wording is "an empty directory is empty, not an
          // error", and on the memory store those are one case: it has no
          // directories at all, so nothing distinguishes never-created from
          // created-and-empty. A real filesystem does distinguish, and this
          // adapter reported `files/not-found` for the first `list('Documents')`
          // of every freshly connected folder — before anything had been written
          // to it, which is exactly when a caller asks.
          //
          // Only for a missing directory, and only while the root still answers:
          // rethrowing otherwise keeps a folder that was moved or unmounted
          // reported as `files/gone` rather than quietly reading as empty, which
          // would be a folder full of documents rendering as none.
          if (codeOf(e) === 'not-found' && (await rootAlive())) return fileOk([])
          throw e
        }

        const prefix = dir === '' ? '' : `${dir}/`
        const out: FileEntry[] = []
        for await (const [name, child] of handle.entries()) {
          // Non-recursive: a nested directory is not an entry of this one.
          if (child.kind !== 'file') continue
          // Chrome never reaps a `.crswap` orphaned by a hard kill and it shows
          // up in `entries()`. Filtered here rather than at each call site so a
          // caller cannot forget and rebuild a half-written file into a record.
          if (isSwapFile(name)) continue
          out.push(await entryOf(`${prefix}${name}`, child as FileSystemFileHandle))
        }
        return fileOk(out)
      }),

    stat: async (path) =>
      attempt<FileEntry>('stat', path, async () => {
        const { dir, name } = await locate(path, false)
        return fileOk(await entryOf(path, await dir.getFileHandle(name)))
      }),

    read: async (path) =>
      attempt<Uint8Array>('read', path, async () => {
        const { dir, name } = await locate(path, false)
        const file = await (await dir.getFileHandle(name)).getFile()
        return fileOk(new Uint8Array(await file.arrayBuffer()))
      }),

    write: async (path, data) =>
      attempt<FileEntry>('write', path, async () => {
        const { dir, name } = await locate(path, true)
        const handle = await dir.getFileHandle(name, { create: true })
        const writable = await handle.createWritable()
        try {
          // Copied, matching the port's "write copies rather than aliasing".
          //
          // Belt and braces on THIS adapter specifically: the conformance case
          // for it cannot fail here, because it mutates the caller's array after
          // `write()` has resolved and the platform has already consumed the
          // chunk by then — measured by removing this `.slice()` and watching
          // all 23 cases still pass. It stays because the contract is written
          // against the port, not against one implementation's timing: an
          // adapter that later streams, or stops awaiting to completion, would
          // reintroduce the aliasing with nothing to catch it.
          await writable.write(data.slice())
        } finally {
          // In a `finally` so a failed write still closes the writable. An open
          // writable leaves its `.crswap` sibling behind, and Chrome never reaps
          // one.
          await writable.close()
        }
        return fileOk(await entryOf(path, handle))
      }),

    exists: async (path) =>
      attempt<boolean>('exists', path, async () => {
        try {
          const { dir, name } = await locate(path, false)
          await dir.getFileHandle(name)
          return fileOk(true)
        } catch (e) {
          // Absence is an answer here, not a failure — but only absence.
          // Swallowing everything would report a lapsed permission as `false`,
          // and a caller that trusts it would then overwrite a file it could not
          // read.
          if (codeOf(e) === 'not-found') return fileOk(false)
          throw e
        }
      }),

    trash: async (path) =>
      attempt<void>('trash', path, async () => {
        const src = await locate(path, false)
        const handle = await src.dir.getFileHandle(src.name)
        const data = new Uint8Array(await (await handle.getFile()).arrayBuffer())

        // The FULL relative path, not the basename. Keying Trash by basename
        // made this method destroy data: two documents called `CV.pdf` in
        // different directories collapsed onto one name and the second silently
        // overwrote the first — in the one method whose whole promise is that
        // nothing is unrecoverable.
        const dest = await locate(`${TRASH_DIR}/${path}`, true)
        const target = await dest.dir.getFileHandle(dest.name, { create: true })
        const writable = await target.createWritable()
        try {
          await writable.write(data)
        } finally {
          await writable.close()
        }

        // Removed only once the copy is closed and therefore durable. Unlinking
        // first would turn a quota failure into data loss.
        await src.dir.removeEntry(src.name)
        return fileOk(undefined)
      }),

    url: async (path) =>
      attempt<string>('url', path, async () => {
        const { dir, name } = await locate(path, false)
        const file = await (await dir.getFileHandle(name)).getFile()
        // `blob:` rather than a data URI: the viewer points an iframe at this and
        // a PDF of any size would otherwise be base64 in a URL bar. The caller
        // revokes it — this port has no lifecycle hook to do it here.
        return fileOk(URL.createObjectURL(file))
      }),

    withLock: async <T>(name: string, fn: () => Promise<T>): Promise<FileResult<T>> => {
      if (root === null) return fileFail<T>('files/no-folder', 'no folder is connected')
      // Measured: the File System Access API offers no mutual exclusion of its
      // own. Two tabs opening writables on one file produces `graph.json.1.crswap`,
      // every write reports success, and last-close silently wins.
      if (typeof navigator === 'undefined' || navigator.locks === undefined) {
        return fileFail<T>('files/unsupported', 'navigator.locks is unavailable', { lock: name })
      }
      try {
        return await navigator.locks.request(
          `jojo-folder:${name}`,
          // `ifAvailable` so reentrancy fails loudly instead of deadlocking.
          // `navigator.locks` would block forever on a re-entrant request, and a
          // mirror write that awaited itself would take the whole feature down
          // with no error anywhere — the silent-wedge shape the audit found
          // twice in the write queue. The memory store refuses the same case.
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
        // branches on `result.ok`, so a throw here lands in whatever `await`
        // happens to be upstream; inside the debounced mirror chain that is an
        // unhandled rejection nobody sees and a mirror that silently stops.
        return fileFail<T>('files/failed', messageOf(e), { lock: name })
      }
    },

    forget: async () => {
      // Only the binding. Emphatically not the folder's contents — `forget` is
      // the user disconnecting, and their documents are theirs.
      root = null
    },
  }
}
