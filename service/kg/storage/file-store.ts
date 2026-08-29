/**
 * L0 — the FileStore interface every byte backend implements.
 *
 * The second port in this layer, and deliberately not part of `Driver`. The two
 * answer different questions and fail independently: `Driver` answers "is the
 * graph being saved?", and every one of `StorageBanner`'s arms is about that.
 * `FileStore` answers "are the documents reachable?" — a folder whose permission
 * lapsed loses no records at all. Folding bytes into `Driver` would have made a
 * lapsed folder look like a failing database, and made the graph's health depend
 * on a capability most sessions do not even have.
 *
 * Never throws. Every method returns a `FileResult` for the same reason `Driver`
 * does: a folder the user renamed in Finder is a row that says "not found", not
 * an unhandled rejection inside a promise nobody awaited. The File System Access
 * API throws for all of it — `NotFoundError`, `NotAllowedError`, `SecurityError`,
 * `QuotaExceededError` — so the adapter's whole job is turning those into codes.
 *
 * DOM-free by construction. `FileSystemDirectoryHandle` appears nowhere in this
 * file: paths are strings, bytes are `Uint8Array`, and the handle is the
 * adapter's private business. That is what lets a React Native adapter over
 * `expo-file-system`, or an Electron one over `node:fs`, satisfy the same port —
 * and it is why the reconcile and restore logic above this can be plain testable
 * code rather than something that needs a browser to run.
 */

import type { Instant } from './schema'

/**
 * The seven failures a byte store can hand back, and no others.
 *
 * `denied` and `gone` are separated because the remedies are opposite and the
 * app must not confuse them: `denied` is one click away from working, and `gone`
 * cannot be fixed without finding the folder. Scout measurement is what forces
 * the distinction to be load-bearing — `queryPermission()` returns `'granted'`
 * for a folder that has been renamed, moved, deleted OR unmounted, with
 * `isSameEntry(self)` still true, so nothing may infer liveness from permission
 * state. Only a real I/O call knows, and only these codes carry the answer.
 */
export type FileFailureCode =
  /** No folder connected. Not an error — the app runs fine without one. */
  | 'files/no-folder'
  /** Permission lapsed. Recoverable with one user gesture. */
  | 'files/denied'
  /** The folder itself is unreachable: renamed, moved, deleted, unmounted. */
  | 'files/gone'
  /** The folder is there; this path inside it is not. */
  | 'files/not-found'
  /** Disk full. */
  | 'files/quota'
  /** The platform has no folder support at all — Safari, Firefox. */
  | 'files/unsupported'
  /** Anything else the platform threw. Logged with its original name. */
  | 'files/failed'

export type FileFailure = {
  readonly code: FileFailureCode
  /** Logged, never shown. The user-facing sentence is minted above this layer. */
  readonly message: string
  readonly context?: Readonly<Record<string, unknown>>
}

export type FileResult<T> = { ok: true; value: T } | { ok: false; error: FileFailure }

export const fileOk = <T>(value: T): FileResult<T> => ({ ok: true, value })

export const fileFail = <T>(
  code: FileFailureCode,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): FileResult<T> =>
  context === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, context } }

/**
 * One entry as the folder reports it. Never a handle, never a Blob.
 *
 * `bytes` and `mtime` are the two facts a scan can afford. Hashing is not on
 * this type on purpose: measured at ~1.2 s of CPU for 200 MB, so a hash is
 * computed on write and on demand, never on a scan that runs at every window
 * focus.
 */
export type FileEntry = {
  /** Folder-relative, POSIX separators. 'Documents/CV_Rice_Oct.pdf'. */
  readonly path: string
  readonly bytes: number
  /** Epoch ms, as the platform reports it. A tripwire, never identity. */
  readonly mtime: number
}

/**
 * Written to `jojo/folder.json` at connect and read on every reconnect.
 *
 * This exists because of the sharpest measured failure in the whole feature:
 * delete the folder, create a new empty one at the same path, and the stored
 * handle binds to it with `granted` and no error whatsoever — indistinguishable
 * from the user having deleted every attachment. A UUID inside the folder is the
 * only thing that can tell those two apart, and it has to be read with real I/O
 * because permission state cannot.
 */
export type VaultIdentity = {
  readonly vaultId: string
  readonly createdAt: Instant
  readonly appVersion: string
}

export interface FileStore {
  /**
   * Whether a folder is currently bound. Synchronous because every render asks.
   *
   * Says nothing about whether it is *reachable* — see the note on
   * `FileFailureCode`. A `true` here with `files/gone` from the next `list()` is
   * the normal shape of a folder the user moved, not a contradiction.
   *
   * The synchronous signature is the one thing on this port that costs a
   * non-browser adapter real work, so it is worth naming before someone writes
   * one. On the web it is free: the File System Access API hands back a live
   * `FileSystemDirectoryHandle` object, and holding one IS the binding. Android's
   * Storage Access Framework hands back a persisted tree URI whose grant the OS
   * may revoke between launches, and whose validity is only knowable by an async
   * call — so an RN adapter has to answer from shadow state resolved at startup,
   * and can return a stale `true` until the first real I/O corrects it. That is
   * inside the contract rather than a violation of it: BINDING is what this
   * answers, and every method below already carries `files/denied` and
   * `files/gone` for the moment the binding turns out to be worth nothing. What
   * an adapter must not do is make this async or make it block; a render asks it,
   * and the answer it needs is "is there a folder configured", not "is the disk
   * still there".
   */
  connected(): boolean

  /** Reads `jojo/folder.json`. The anti-silent-adoption check. */
  identity(): Promise<FileResult<VaultIdentity>>

  /** Non-recursive. Filters Chrome's `.crswap` write-swap files — see below. */
  list(dir: string): Promise<FileResult<readonly FileEntry[]>>

  stat(path: string): Promise<FileResult<FileEntry>>

  read(path: string): Promise<FileResult<Uint8Array>>

  /** Creates parents as needed. Returns the entry as written. */
  write(path: string, data: Uint8Array): Promise<FileResult<FileEntry>>

  exists(path: string): Promise<FileResult<boolean>>

  /**
   * Moves to `jojo/Trash/`. **Never unlinks.**
   *
   * The folder is the user's, and jojo did not put most of what is in it there.
   * A delete that the user did not perform in their own file manager should be
   * recoverable in their own file manager.
   */
  trash(path: string): Promise<FileResult<void>>

  /** A URL the viewer can point an iframe at. `blob:` on web, `file://` on RN. */
  url(path: string): Promise<FileResult<string>>

  /**
   * Cross-tab mutual exclusion by name.
   *
   * On the port rather than at the call site because the web implementation is
   * `navigator.locks`, and `navigator` is banned in every layer that would want
   * to call it — `check-platform.mjs` lists it under `dom`, and `core`, `repo`,
   * `tools` and `react` are all in that ban list. Measured: the File System
   * Access API offers no protection of its own. Two tabs opening writables on
   * one file produces `graph.json.1.crswap`, every write reports success, and
   * last-close silently wins.
   */
  withLock<T>(name: string, fn: () => Promise<T>): Promise<FileResult<T>>

  /** Drops the binding and forgets the persisted handle. */
  forget(): Promise<void>
}

/**
 * Chrome's `createWritable()` writes to a sibling `<name>.crswap` and renames it
 * over the target on `close()`. That is why the mirror can never be read torn —
 * but a swap orphaned by a hard kill is **never reaped**: not on relaunch, not
 * by a later successful write to the same name. Measured, and it shows up in
 * `entries()`, so every listing filters it and connect sweeps it.
 */
export const SWAP_SUFFIX = '.crswap'

export const isSwapFile = (name: string): boolean => name.endsWith(SWAP_SUFFIX)

/*
 * The folder layout constants that used to sit here — DOCUMENTS_DIR, JOJO_DIR,
 * TRASH_DIR, IDENTITY_PATH, MIRROR_PATH, MIRROR_PREVIOUS_PATH — were written
 * ahead of the code that needs them and had zero consumers. They arrive with
 * the wave that reads them.
 *
 * Note when they do: `core/blob-path.ts` already declares the same
 * `'Documents'` as `BLOB_DIR`, and it has to. The guards forbid `core` from
 * importing `storage` and `storage` from importing `core`, so the one string
 * genuinely cannot be shared between the module that builds paths and the
 * module that writes them. Keep them spelled identically and keep this note
 * next to both.
 */
