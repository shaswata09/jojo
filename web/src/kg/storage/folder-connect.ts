/**
 * L0 — binding a folder to this browser, and remembering it.
 *
 * Split from `fs-file-store.ts` on purpose. That file is a pure translation of
 * the `FileStore` port onto a `FileSystemDirectoryHandle` and can be exercised
 * with any handle, which is what makes it conformance-testable at all. This file
 * is the part that cannot be: it needs a user gesture, a native dialog, and a
 * permission model, none of which a headless harness can drive.
 *
 * ## Where the handle lives
 *
 * Its own tiny IndexedDB database, not a new store inside the app's. Adding one
 * to `jojo-kg` means a version bump, a migration, and a driver that has to open
 * correctly on the way past it — for a single row that has nothing to do with
 * the graph. A separate database is independently openable, independently
 * clearable, and cannot wedge the store that holds the user's records.
 *
 * A `FileSystemDirectoryHandle` is structured-cloneable in Chromium, so it goes
 * in whole. It survives a reload; the PERMISSION on it does not necessarily,
 * which is why `restore` and `reconnect` are two functions rather than one.
 *
 * ## Why the caller passes `now`
 *
 * `check-platform.mjs` bans wall-clock reads in the adapter layer, and this is
 * that layer. `createdAt` on a new vault marker is minted by the caller, which
 * also makes the pairing path testable without freezing a clock.
 */

import { openDB } from 'idb'
import { createFsFileStore, folderSupported, type FsFileStore } from './fs-file-store'

const DB_NAME = 'jojo-folder'
const STORE = 'handle'
const KEY = 'root'

/** Where the vault marker lives inside the folder. Mirrors `fs-file-store.ts`. */
const IDENTITY_PATH = 'jojo/folder.json'

const enc = new TextEncoder()

type Permission = 'granted' | 'prompt' | 'denied'

/** What the app needs to know about the folder, for a banner or a settings row. */
export type FolderStatus =
  | { state: 'unsupported' }
  | { state: 'none' }
  /** A handle we hold but may not use until the user says so again. */
  | { state: 'needs-permission'; name: string }
  | { state: 'connected'; name: string; vaultId: string }
  /** Held a handle, and the folder it pointed at is no longer reachable. */
  | { state: 'gone'; name: string }

async function db() {
  return openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore(STORE)
    },
  })
}

async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await (await db()).get(STORE, KEY)) ?? null
  } catch {
    // Private browsing blocks IndexedDB entirely. A session with no remembered
    // folder is a normal session, not a broken one — the user can still pick
    // one, it just will not survive the tab.
    return null
  }
}

async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    await (await db()).put(STORE, handle, KEY)
  } catch {
    // Same reasoning. Failing to REMEMBER a folder must not fail connecting to
    // it — the user asked to save their files somewhere, and they will be saved
    // there for as long as this tab lives.
  }
}

async function dropHandle(): Promise<void> {
  try {
    await (await db()).delete(STORE, KEY)
  } catch {
    /* nothing to forget */
  }
}

/**
 * Permission without prompting. Safe to call on load.
 *
 * `queryPermission` never shows UI, which is exactly why the restore path can
 * use it and the connect path cannot: asking on load would put a permission
 * dialog in front of someone who has not clicked anything.
 */
async function query(handle: FileSystemDirectoryHandle): Promise<Permission> {
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?: (d: { mode: 'readwrite' }) => Promise<Permission>
  }
  if (typeof h.queryPermission !== 'function') return 'prompt'
  try {
    return await h.queryPermission({ mode: 'readwrite' })
  } catch {
    return 'prompt'
  }
}

/** Permission WITH a prompt. Must be called from a user gesture or it rejects. */
async function request(handle: FileSystemDirectoryHandle): Promise<Permission> {
  const h = handle as FileSystemDirectoryHandle & {
    requestPermission?: (d: { mode: 'readwrite' }) => Promise<Permission>
  }
  if (typeof h.requestPermission !== 'function') return 'denied'
  try {
    return await h.requestPermission({ mode: 'readwrite' })
  } catch {
    return 'denied'
  }
}

/**
 * Reads the folder's identity, writing one if the folder is new to jojo.
 *
 * The anti-silent-adoption check the port names. A folder deleted and recreated
 * at the same path re-binds with `granted` and no error, which is
 * indistinguishable from the user having deleted every attachment — only a
 * marker inside the folder tells the two apart. Returns the id either way, so
 * the caller can notice it changed.
 *
 * Exported for the conformance harness. Everything else in this file needs a
 * picker and a native dialog, which is untestable; this is the one piece of real
 * decision-making here, and its dangerous branch — re-minting an id over a
 * marker that exists but could not be read — is exactly the kind of thing that
 * looks obviously right and destroys a folder's identity in the field.
 */
export async function ensureIdentity(store: FsFileStore, now: string, appVersion: string) {
  const existing = await store.identity()
  if (existing.ok) return existing

  // Only absence justifies minting a new one. A folder whose marker is there but
  // unreadable — a permission that lapsed mid-call, a disk that gave up — must
  // not be overwritten with a fresh identity, because that is the one action
  // that would make a real folder look new.
  if (existing.error.code !== 'files/not-found') return existing

  const identity = { vaultId: crypto.randomUUID(), createdAt: now, appVersion }
  const written = await store.write(IDENTITY_PATH, enc.encode(JSON.stringify(identity, null, 2)))
  return written.ok ? { ok: true as const, value: identity } : written
}

export type ConnectOptions = {
  /** ISO instant for a new vault marker. See the note on `now` above. */
  now: string
  appVersion: string
}

/**
 * The picker. Must be called from a click.
 *
 * Returns `null` when the user dismisses the dialog, which is not an error and
 * must not surface as one — cancelling is the most common thing a person does
 * with a file dialog.
 */
export async function chooseFolder(
  store: FsFileStore,
  options: ConnectOptions,
): Promise<FolderStatus | null> {
  if (!folderSupported()) return { state: 'unsupported' }

  const picker = (
    globalThis as unknown as {
      showDirectoryPicker: (o: {
        mode: 'readwrite'
        id?: string
        startIn?: string
      }) => Promise<FileSystemDirectoryHandle>
    }
  ).showDirectoryPicker

  let handle: FileSystemDirectoryHandle
  try {
    // `id` makes Chrome reopen where this app was last time rather than where
    // any other picker was; `startIn` only applies the first time.
    handle = await picker({ mode: 'readwrite', id: 'jojo-vault', startIn: 'documents' })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return null
    return { state: 'none' }
  }

  if ((await query(handle)) !== 'granted' && (await request(handle)) !== 'granted') {
    return { state: 'needs-permission', name: handle.name }
  }

  store.adopt(handle)
  const identity = await ensureIdentity(store, options.now, options.appVersion)
  if (!identity.ok) {
    await store.forget()
    return identity.error.code === 'files/gone' ? { state: 'gone', name: handle.name } : { state: 'none' }
  }

  await saveHandle(handle)
  return { state: 'connected', name: handle.name, vaultId: identity.value.vaultId }
}

/**
 * Rebinds the remembered folder on load, without prompting.
 *
 * Never asks. A folder whose grant lapsed comes back as `needs-permission` and
 * the user reconnects with one click, which is the whole reason that state is
 * distinct from `none`.
 */
export async function restoreFolder(store: FsFileStore): Promise<FolderStatus> {
  if (!folderSupported()) return { state: 'unsupported' }
  const handle = await loadHandle()
  if (handle === null) return { state: 'none' }
  if ((await query(handle)) !== 'granted') return { state: 'needs-permission', name: handle.name }

  store.adopt(handle)
  const identity = await store.identity()
  if (identity.ok) return { state: 'connected', name: handle.name, vaultId: identity.value.vaultId }

  // Bound but unreadable. `forget` the binding rather than leaving a store that
  // answers `connected() === true` and fails every call — the port allows a
  // stale true, but there is no reason to serve one when the answer is known.
  await store.forget()
  return identity.error.code === 'files/not-found'
    ? { state: 'none' }
    : { state: 'gone', name: handle.name }
}

/** Re-asks for a lapsed grant. Must be called from a click. */
export async function reconnectFolder(
  store: FsFileStore,
  options: ConnectOptions,
): Promise<FolderStatus> {
  if (!folderSupported()) return { state: 'unsupported' }
  const handle = await loadHandle()
  if (handle === null) return { state: 'none' }
  if ((await request(handle)) !== 'granted') return { state: 'needs-permission', name: handle.name }

  store.adopt(handle)
  const identity = await ensureIdentity(store, options.now, options.appVersion)
  if (!identity.ok) {
    await store.forget()
    return { state: 'gone', name: handle.name }
  }
  return { state: 'connected', name: handle.name, vaultId: identity.value.vaultId }
}

/** Drops the binding and forgets the handle. Leaves the folder's contents alone. */
export async function disconnectFolder(store: FsFileStore): Promise<FolderStatus> {
  await store.forget()
  await dropHandle()
  return { state: 'none' }
}

/** The app's single store instance. Unbound until `restoreFolder` says otherwise. */
export const fileStore: FsFileStore = createFsFileStore()
