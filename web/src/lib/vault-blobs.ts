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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createIdbFileStore, type IdbFileStore } from '@/kg/storage/idb-file-store'
import { mimeOfFile } from '@jojo/service/core/files'
/*
 * The path format lives in `core/blob-path.ts` and is re-exported here, so the
 * callers in this file and its test keep their imports. It stopped being a
 * storage layout when `buildBackup` began writing these paths into the backup
 * file: a phone receiving one over the local network parses them too, and a
 * format with two implementations is a format with two spellings.
 */
import {
  BLOB_DIR as DIR,
  blobPath,
  idOfPath,
  nameOfPath,
} from '@jojo/service/core/blob-path'

export { blobPath, idOfPath, nameOfPath }

export type VaultBlobs = {
  /** Ids whose bytes are stored. Synchronous, because the list renders it. */
  has: (id: string) => boolean
  /** Whether the index has finished loading — `has` is empty until it has. */
  ready: boolean
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
 * Each mount adds and removes its own listener.
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
 * Every live `useVaultBlobs()` in THIS page.
 *
 * The channel above covers other tabs and cannot cover this one: a
 * `BroadcastChannel` never delivers to the object that posted, and there is one
 * shared object here, so a write announced from this page reached no hook in it.
 *
 * That was invisible for as long as every writer was also the reader — a file
 * dropped on `FilesTool` is `put` by `FilesTool`'s own instance, which updates
 * its own index directly and needs no message. Captures broke the assumption:
 * `useFileCapture` holds a SECOND instance, so it wrote the bytes, updated its
 * own index, announced into a void, and `FilesTool` went on believing the record
 * had none — the viewer then said "no saved copy on this device" about a file
 * that had just been written a few lines earlier.
 *
 * A plain set of callbacks rather than a second channel object, because the
 * question is "who else in this page holds an index", and that is not something
 * a message bus should have to answer.
 */
const local = new Set<() => void>()

function announce(): void {
  // A bare ping. What changed does not matter — the receiver re-lists, which is
  // one `getAllKeys` and always right, where a diff could drift.
  //
  // Both audiences, in this order: the hooks in this page directly, and the
  // other tabs through the channel. The announcing hook is in the set too and
  // re-lists needlessly, which is one `getAllKeys` — cheaper than the bookkeeping
  // to exclude it, and it keeps "announce means everyone re-reads" true with no
  // exceptions to remember.
  for (const listener of [...local]) listener()
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

export function useVaultBlobs(): VaultBlobs {
  const [index, setIndex] = useState<Map<string, string>>(new Map())
  const [ready, setReady] = useState(false)
  // Kept in a ref as well so the callbacks below do not need it as a dependency
  // and stay stable — the file list re-renders on every keystroke in its search
  // box, and a new `has` identity each time would re-render every row.
  const latest = useRef(index)
  latest.current = index

  const refresh = useCallback(async () => {
    const listed = await store().list(DIR)
    if (!listed.ok) {
      // A store that will not open is a store with nothing in it. The caller
      // renders "not on this device", which is true.
      setIndex(new Map())
      setReady(true)
      return
    }
    const next = new Map<string, string>()
    for (const entry of listed.value) {
      const id = idOfPath(entry.path)
      if (id !== null) next.set(id, entry.path)
    }
    setIndex(next)
    setReady(true)
  }, [])

  useEffect(() => {
    let alive = true
    // `purgeOnce`, not `purgeTrash`: reclaiming a previous session's deletions
    // is a page-load job, and this effect runs on every mount. See its comment.
    void purgeOnce().then(() => {
      if (alive) void refresh()
    })
    const onChange = () => {
      if (alive) void refresh()
    }
    // Two subscriptions, because there are two audiences and the channel can
    // only serve one of them. `local` is every other hook in this page; the
    // channel is every other tab.
    local.add(onChange)
    bus()?.addEventListener('message', onChange)

    return () => {
      alive = false
      local.delete(onChange)
      bus()?.removeEventListener('message', onChange)
    }
  }, [refresh])

  const put = useCallback(async (id: string, file: File) => {
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
    setIndex((prev) => new Map(prev).set(id, path))
    announce()
    return true
  }, [])

  const get = useCallback(async (id: string) => {
    const path = latest.current.get(id)
    if (path === undefined) return null
    const read = await store().read(path)
    if (!read.ok) return null
    const name = nameOfPath(path)
    // Returned as a `File` rather than a Blob so the viewer keeps working
    // unchanged: it already takes a File and reads `.name` and `.type` off it.
    return new File([read.value as unknown as BlobPart], name, { type: mimeOfFile(name) })
  }, [])

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
   * Bounded by the session and by what a person actually deletes in one. The
   * trash copy stays as well — it costs nothing until the next sweep, and it is
   * what makes the delete survivable if this tab dies outright.
   */
  const trashed = useRef(new Map<string, { path: string; data: Uint8Array }>())

  const remove = useCallback(async (id: string) => {
    const path = latest.current.get(id)
    if (path === undefined) return
    // Read BEFORE trashing, so Undo has the bytes in hand whatever happens to
    // the folder afterwards.
    const held = await store().read(path)
    // Trashed rather than deleted — `trash` moves it under `jojo/Trash` keeping
    // its full relative path, so a record removed by a misclick has not taken
    // the document with it even if this tab is closed.
    const moved = await store().trash(path)
    if (!moved.ok) return
    if (held.ok) trashed.current.set(id, { path, data: held.value })
    setIndex((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    announce()
  }, [])

  const restore = useCallback(async (id: string) => {
    const held = trashed.current.get(id)
    if (held === undefined) return false
    // Written from the bytes captured at `remove`, never re-read from the trash.
    // A rename would be simpler and the port has none — `FileStore` can read,
    // write and trash, and Undo has to be expressible in those or it is not
    // expressible on every adapter.
    const rewritten = await store().write(held.path, held.data)
    if (!rewritten.ok) return false
    trashed.current.delete(id)
    setIndex((prev) => new Map(prev).set(id, held.path))
    announce()
    return true
  }, [])

  const download = useCallback(
    async (id: string) => {
      const file = await get(id)
      if (file === null) return false
      const href = URL.createObjectURL(file)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = file.name
      anchor.click()
      // Revoked on the next frame, not immediately: a synchronous revoke races
      // the download the click just started, and the file arrives empty.
      setTimeout(() => URL.revokeObjectURL(href), 0)
      return true
    },
    [get],
  )

  const all = useCallback(
    async () =>
      [...latest.current.entries()].map(([id, path]) => ({ id, name: nameOfPath(path) })),
    [],
  )

  const has = useCallback((id: string) => latest.current.has(id), [])

  const persisted = useCallback(() => store().persisted(), [])

  const replaceAll = useCallback(
    async (documents: readonly { path: string; data: Uint8Array }[]) => {
      // Trashed, not deleted: `FileStore` never unlinks, and a restore is
      // exactly the moment a person might discover they picked the wrong file.
      // What they replaced is still under `jojo/Trash`.
      for (const [, path] of latest.current) await store().trash(path)

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
    },
    [],
  )

  return useMemo(
    () => ({ has, ready, put, get, remove, restore, download, all, persisted, replaceAll }),
    [has, ready, put, get, remove, restore, download, all, persisted, replaceAll],
  )
}
