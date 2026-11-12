/**
 * The bytes behind a vault record, kept somewhere they survive a reload.
 *
 * `FilesTool` already read the dropped `File` and already previewed it — from
 * `useState<Record<string, File>>({})`, which is memory. So the documents a
 * person tailored for an application were there until the tab closed and gone
 * afterwards, while the record listing them stayed. This replaces that map with
 * `idb-file-store`, and nothing else about the flow changes.
 *
 * ## Why this needs no change to the service layer
 *
 * The obvious design records the byte location on the node — `FileProps.path`
 * exists for exactly that, and its comment says "its PRESENCE is the 'has bytes'
 * flag". It would also mean changing `vault.file.add`, which is shared with the
 * phone, to accept and write a new prop.
 *
 * Putting the record's id INSIDE the path instead makes the mapping derivable:
 * `Documents/<id>__<name>` is listed by a single non-recursive `list`, and the
 * id splits back off the front. The graph is untouched, the tool is untouched,
 * and a later move to `FileProps.path` is a migration rather than a rewrite.
 *
 * ## What this does not promise
 *
 * IndexedDB is evictable — see the header of `idb-file-store`. `persist()` is
 * requested on the first write and is granted on engagement heuristics, so a new
 * user is exactly the case where it is refused. Bytes that exist only here are
 * one "Clear browsing data" from gone, which is why `download` exists and is not
 * an afterthought.
 */

import { useMemo, useSyncExternalStore } from 'react'
import { createIdbFileStore, type IdbFileStore } from '@/kg/storage/idb-file-store'
import { mimeOfFile } from '@jojo/service/core/files'
import { revokeLater } from '@/lib/save-file'
/*
 * The path format lives in `core/blob-path.ts` and is re-exported here, so the
 * callers in this file and its test keep their imports. It stopped being a
 * storage layout when `buildBackup` began writing these paths into the backup
 * file: a phone receiving one over the local network parses them too, and a
 * format with two implementations is a format with two spellings.
 */
import { BLOB_DIR as DIR, blobPath, idOfPath, nameOfPath } from '@jojo/service/core/blob-path'

export { blobPath, idOfPath, nameOfPath }

/**
 * Record id -> stored path, from one listing of the documents folder.
 *
 * Pure and exported so it can be tested without a browser, and so the two
 * places that build the index — the mount refresh and a lookup that missed —
 * cannot disagree about what counts as one of jojo's documents.
 */
export function indexFrom(entries: readonly { readonly path: string }[]): Map<string, string> {
  const next = new Map<string, string>()
  for (const entry of entries) {
    const id = idOfPath(entry.path)
    if (id !== null) next.set(id, entry.path)
  }
  return next
}

export type VaultBlobs = {
  /** Ids whose bytes are stored. Synchronous, because the list renders it. */
  has: (id: string) => boolean
  /** Whether the index has finished loading — `has` is empty until it has. */
  ready: boolean
  /**
   * Bumped whenever the set of stored documents changes.
   *
   * `has` is deliberately a stable function that reads the page's one index, so nothing that
   * depends on it re-renders when a document arrives. That is right for a list
   * of five hundred rows and wrong for a decision that has to be re-taken when
   * the answer changes — whether a CV that was just dropped can be offered for
   * reading. Put this in the dependency array beside `has`.
   */
  revision: number
  put: (id: string, file: File) => Promise<boolean>
  get: (id: string) => Promise<File | null>
  remove: (id: string) => Promise<void>
  /**
   * Puts back what `remove` took. Returns false if it could not — a caller that
   * promised the document would come back needs to know when it did not.
   */
  restore: (id: string) => Promise<boolean>
  /** Hands the file to the browser's downloader. */
  download: (id: string) => Promise<boolean>
  /** Every stored document, newest first. For "download everything". */
  all: () => Promise<{ id: string; name: string }[]>
  /**
   * Swaps every stored document for the given set, and reports how many landed.
   *
   * A replace, not a merge, and used only by a restore. Merging would leave the
   * previous store's documents behind, belonging to records the restore has just
   * deleted — invisible in the app and counted against a quota nothing can
   * account for.
   */
  replaceAll: (documents: readonly { path: string; data: Uint8Array }[]) => Promise<number>
  /**
   * Whether the browser has exempted this data from eviction.
   *
   * Surfaced because the answer decides whether the app should be warning the
   * user at all — `persist()` is granted on engagement heuristics and is
   * routinely refused for a new profile, which is precisely the person with the
   * least idea their documents are at risk.
   */
  persisted: () => Promise<boolean>
}

/** Module-level so every mount shares one database handle. */
let shared: IdbFileStore | null = null

/**
 * Tells the other tabs that the documents changed.
 *
 * The index below is React state, so it is per TAB: without this, adding a
 * document in one tab left every other tab rendering "not on this device" for a
 * file that is plainly there, until it happened to be reloaded. Multi-tab is
 * explicitly in scope for this app — `KG-ARCHITECTURE` §6 keeps it in and rules
 * cross-DEVICE out — and the graph store already solves the same problem with
 * `kg/storage/channel.ts`.
 *
 * Its own channel rather than that one: `Channel` is typed to the driver's
 * `StoreEvent`, and widening a service-layer type so the web app can send a
 * different kind of message is a worse trade than fifteen lines here.
 *
 * Guarded exactly as `createStoreChannel` is. `BroadcastChannel` is absent in
 * React Native and in older Safari, and constructing one throws in a sandboxed
 * frame with an opaque origin — in both cases the app still works, it is just
 * alone, which is what it was before this existed.
 */
const CHANNEL = 'jojo-files:changed'

/**
 * ONE channel for the whole page, used to both post and listen.
 *
 * The rule is narrower than it first looks: a `BroadcastChannel` does not
 * deliver a message to the OBJECT that posted it — but it does deliver to every
 * other object on the same name, including ones in the same tab. Measured. So a
 * post-and-close helper, which is what stood here, made the posting tab receive
 * its own message and re-list for a change it had just applied itself.
 *
 * Not a loop — a refresh does not announce — but a wasted read on every write,
 * and a comment claiming an echo was impossible when it was happening.
 *
 * Never closed: it lives as long as the page, like the store handle beside it.
 * One listener, added by `blobIndex` the first time anything subscribes.
 */
let channel: BroadcastChannel | null | undefined

function bus(): BroadcastChannel | null {
  if (channel !== undefined) return channel
  if (typeof BroadcastChannel === 'undefined') {
    // Absent in React Native and older Safari. The app works, it is just alone.
    channel = null
    return channel
  }
  try {
    channel = new BroadcastChannel(CHANNEL)
  } catch {
    // Constructing one throws in a sandboxed frame with an opaque origin.
    channel = null
  }
  return channel
}

/**
 * Tells the other tabs. This page needs no message: it has one index.
 *
 * There used to be a `local` set of callbacks here as well, because every
 * `useVaultBlobs()` held its own index and a write made through one instance
 * reached no other — a capture's bytes were invisible to `FilesTool` in the
 * same page. With the index hoisted into `blobIndex` below, a write updates the
 * one index every hook reads, so the in-page half of this is gone rather than
 * patched.
 */
function announce(): void {
  bus()?.postMessage(1)
}

/**
 * The trash sweep, run once for the whole page rather than once per mount.
 *
 * It used to sit in the hook's mount effect, which is not the same thing at all:
 * there are four `useVaultBlobs()` call sites, THREE of them mount together on
 * Settings, and `FilesTool` is unmounted and remounted by a plain ternary every
 * time the vault's tool tabs change. So a sweep fired on almost any navigation.
 *
 * That made the comment justifying it false — "by the time this runs, everything
 * under `jojo/Trash` is unreachable" describes once-per-load semantics the code
 * did not have — and the consequence was data loss: delete a document, switch
 * tool, press the Undo still on screen, and the record came back with its bytes
 * gone for good.
 */
let purged: Promise<void> | null = null

function purgeOnce(): Promise<void> {
  purged ??= store()
    .open()
    .then(() => store().purgeTrash())
    .then(() => undefined)
    .catch(() => undefined)
  return purged
}

function store(): IdbFileStore {
  shared ??= createIdbFileStore({
    // The store bans wall-clock reads in its own layer, so the clock is injected
    // from here — this file is app code and may read one.
    now: () => Date.now(),
  })
  return shared
}

/* --------------------------------------------------------------------------
 * The one index, for the whole page.
 *
 * It used to be React state inside the hook, so each of the ~18 call sites held
 * its own copy: every mount listed the whole store, every announcement made
 * every instance list it again, and `has()` answered false on any instance
 * whose own list had not resolved yet — a freshly mounted panel said "not on
 * this device" about a document another panel on the same screen was showing.
 * Now there is one index, hydrated once, and every hook reads it through
 * `useSyncExternalStore`.
 * ------------------------------------------------------------------------ */

type IndexSnapshot = {
  readonly index: ReadonlyMap<string, string>
  /** False until the first listing has landed. */
  readonly ready: boolean
  /** Bumped on every change to the index. See `VaultBlobs.revision`. */
  readonly revision: number
}

let current: IndexSnapshot = { index: new Map(), ready: false, revision: 0 }
const subscribers = new Set<() => void>()
/**
 * Bumped by every local change. A listing that was in flight while one
 * happened describes the store from before it, so it is re-taken rather than
 * allowed to overwrite the newer index.
 */
let changes = 0

function setIndex(next: ReadonlyMap<string, string>): void {
  changes += 1
  current = { index: next, ready: true, revision: current.revision + 1 }
  for (const notify of [...subscribers]) notify()
}

function edit(change: (index: Map<string, string>) => void): void {
  const next = new Map(current.index)
  change(next)
  setIndex(next)
}

async function relist(): Promise<void> {
  for (;;) {
    const before = changes
    const listed = await store().list(DIR)
    if (changes !== before) continue
    // A store that will not open is a store with nothing in it. The caller
    // renders "not on this device", which is true.
    setIndex(listed.ok ? indexFrom(listed.value) : new Map())
    return
  }
}

let hydrated: Promise<void> | null = null

/**
 * The first listing, once per page. `purgeOnce` first, for the reason its own
 * comment gives — reclaiming a previous session's deletions is a page-load job.
 */
function hydrate(): Promise<void> {
  hydrated ??= purgeOnce().then(relist)
  return hydrated
}

let listening = false

/**
 * What every component reads: the index, as an external store.
 *
 * Exported so the store can be driven without a tree — the house rule is no
 * component mounts in tests, and the behaviour that matters (one hydration,
 * Undo during an in-flight delete) lives here, not in the hook.
 */
export const blobIndex = {
  subscribe(notify: () => void): () => void {
    subscribers.add(notify)
    void hydrate()
    if (!listening) {
      listening = true
      // Another tab changed the documents. Never removed: the channel lives as
      // long as the page, and so does the one index it keeps current.
      bus()?.addEventListener('message', () => {
        void relist()
      })
    }
    return () => {
      subscribers.delete(notify)
    }
  },
  getSnapshot: (): IndexSnapshot => current,
  /** Resolves once the first listing has landed. */
  ready: hydrate,
}

/**
 * What this session trashed — the path AND the bytes — so Undo can put it back.
 *
 * The bytes are held rather than re-read from `jojo/Trash`, and that is the
 * difference between an Undo that works and one that usually works. The trash
 * copy is not a reliable source: this page sweeps it once per load, and so
 * does every OTHER tab when it loads, which can happen at any moment while an
 * Undo toast is on screen here. Depending on it made deletion recoverable most
 * of the time, which is the worst kind of recoverable.
 *
 * Module-level now, like the index: a delete made through one hook instance
 * and undone through another's toast must find the same bytes.
 */
const trashed = new Map<string, { path: string; data: Uint8Array }>()

/**
 * Removals still running, by id.
 *
 * `remove` reads, then trashes, then records the bytes — three awaits. An Undo
 * pressed inside that window used to find nothing in `trashed`, return false,
 * and the remove then finished: the document trashed, purged on the next load,
 * gone. `restore` now waits for the removal it is undoing.
 */
const removing = new Map<string, Promise<void>>()

async function put(id: string, file: File): Promise<boolean> {
  // `arrayBuffer()` rejects when the file moved, was deleted, or the OS
  // withdrew the handle between the drop and the read — a real and ordinary
  // thing on a laptop. Unguarded it became an unhandled rejection: the caller
  // does `void put(...).then(...)`, so the `.then` never ran, no failure toast
  // appeared, and the success toast had already fired. The row was filed with
  // no bytes and nothing said so.
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return false
  }
  const path = blobPath(id, file.name)
  const written = await store().write(path, bytes)
  if (!written.ok) return false
  edit((index) => index.set(id, path))
  announce()
  return true
}

async function get(id: string): Promise<File | null> {
  /*
   * The index first, and the folder itself when the index has no answer.
   *
   * The index is filled after the trash sweep, so for the first moments of a
   * page it is empty — and a caller that asked then was told "no copy of that
   * document is stored in this browser" about a document that plainly was.
   * The fit panel on an application is exactly such a caller: it opens the
   * saved posting in its own mount effect, was told there was nothing to read,
   * and by design never asked again. Reported 2026-09-12.
   *
   * A miss costs one `getAllKeys`, which is what the index itself costs, and
   * it also covers a document another tab wrote whose announcement has not
   * arrived yet. What it cannot do is invent a document: a second miss is a
   * real one.
   */
  let path = current.index.get(id)
  if (path === undefined) {
    const before = changes
    const listed = await store().list(DIR)
    if (!listed.ok) return null
    const fresh = indexFrom(listed.value)
    path = fresh.get(id)
    if (path === undefined) return null
    // Only when nothing changed locally meanwhile; a newer index is not
    // replaced by an older listing.
    if (changes === before) setIndex(fresh)
  }
  const read = await store().read(path)
  if (!read.ok) return null
  const name = nameOfPath(path)
  // Returned as a `File` rather than a Blob so the viewer keeps working
  // unchanged: it already takes a File and reads `.name` and `.type` off it.
  return new File([read.value as unknown as BlobPart], name, { type: mimeOfFile(name) })
}

function remove(id: string): Promise<void> {
  // Recorded BEFORE the first await, so an Undo pressed while this runs finds
  // it and waits instead of reporting there was nothing to put back.
  const running = removeNow(id).finally(() => {
    if (removing.get(id) === running) removing.delete(id)
  })
  removing.set(id, running)
  return running
}

async function removeNow(id: string): Promise<void> {
  // The index is per page now, but it may still be hydrating on a delete made
  // in the first moments after load.
  if (!current.ready) await hydrate()
  const path = current.index.get(id)
  if (path === undefined) return
  // Read BEFORE trashing, so Undo has the bytes in hand whatever happens to
  // the folder afterwards.
  const held = await store().read(path)
  // Trashed rather than deleted — `trash` moves it under `jojo/Trash` keeping
  // its full relative path, so a record removed by a misclick has not taken
  // the document with it even if this tab is closed.
  const moved = await store().trash(path)
  if (!moved.ok) return
  if (held.ok) trashed.set(id, { path, data: held.value })
  edit((index) => index.delete(id))
  announce()
}

async function restore(id: string): Promise<boolean> {
  await removing.get(id)
  const held = trashed.get(id)
  if (held === undefined) return false
  // Written from the bytes captured at `remove`, never re-read from the trash.
  // A rename would be simpler and the port has none — `FileStore` can read,
  // write and trash, and Undo has to be expressible in those or it is not
  // expressible on every adapter.
  const rewritten = await store().write(held.path, held.data)
  if (!rewritten.ok) return false
  trashed.delete(id)
  edit((index) => index.set(id, held.path))
  announce()
  return true
}

async function download(id: string): Promise<boolean> {
  const file = await get(id)
  if (file === null) return false
  const href = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = file.name
  anchor.click()
  // Revoked later, not immediately: an early revoke races the download the
  // click just started, and the file arrives empty. See `revokeLater`.
  revokeLater(href)
  return true
}

async function all(): Promise<{ id: string; name: string }[]> {
  return [...current.index.entries()].map(([id, path]) => ({ id, name: nameOfPath(path) }))
}

async function replaceAll(
  documents: readonly { path: string; data: Uint8Array }[],
): Promise<number> {
  // Trashed, not deleted: `FileStore` never unlinks, and a restore is
  // exactly the moment a person might discover they picked the wrong file.
  // What they replaced is still under `jojo/Trash`.
  for (const [, path] of current.index) await store().trash(path)

  const next = new Map<string, string>()
  let landed = 0
  for (const doc of documents) {
    const id = idOfPath(doc.path)
    // Skipped, not written. A path this cannot parse belongs to no record,
    // so storing it would spend the user's quota on bytes nothing in the app
    // can ever reach or delete.
    //
    // It used to be written anyway AND counted as restored, so a restore
    // could report "5 documents are back" while two of them were invisible.
    // A count a person checks their work against has to mean what it says.
    if (id === null) continue
    const written = await store().write(doc.path, doc.data)
    if (!written.ok) continue
    next.set(id, doc.path)
    landed += 1
  }
  setIndex(next)
  announce()
  return landed
}

/** Stable across renders: reads the one index, so a row never re-renders for it. */
const has = (id: string): boolean => current.index.has(id)
const persisted = (): Promise<boolean> => store().persisted()

/**
 * The operations, outside React — what the hook hands out, and what a test
 * drives. Every member is a module function, so each is stable for the page.
 */
export const vaultBlobStore = {
  has,
  put,
  get,
  remove,
  restore,
  download,
  all,
  persisted,
  replaceAll,
}

/**
 * The page's documents, for a component.
 *
 * Same API as before; every instance now reads the one index. `has` stays a
 * stable function — the file list re-renders on every keystroke in its search
 * box, and a new `has` identity each time would re-render every row — and the
 * returned object changes identity exactly when the set of documents does.
 */
export function useVaultBlobs(): VaultBlobs {
  const snapshot = useSyncExternalStore(
    blobIndex.subscribe,
    blobIndex.getSnapshot,
    blobIndex.getSnapshot,
  )
  return useMemo(
    () => ({ ...vaultBlobStore, ready: snapshot.ready, revision: snapshot.revision }),
    [snapshot],
  )
}
