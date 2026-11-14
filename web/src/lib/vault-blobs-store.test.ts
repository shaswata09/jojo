/**
 * The page's one document index, driven without a tree.
 *
 * Two findings are held here. Every `useVaultBlobs()` used to keep its own
 * index and list the whole store on mount and on every announcement; now one
 * index is hydrated once per page. And an Undo pressed while a delete was still
 * running found nothing to put back, after which the delete finished and the
 * document was trashed for good.
 *
 * The IndexedDB store is replaced by the service layer's memory store, which
 * implements the same port; the test counts the listings it is asked for.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryFileStore } from '@jojo/service/storage/memory-file-store'
import type { MemoryFileStore } from '@jojo/service/storage/memory-file-store'
import { blobPath } from '@jojo/service/core/blob-path'

const fake = vi.hoisted(() => ({
  store: null as unknown as MemoryFileStore,
  lists: 0,
  /** When set, `trash` waits for this before doing anything. */
  gate: null as Promise<void> | null,
  /** When set, the page-load trash sweep waits for this — hydration held open. */
  purgeGate: null as Promise<void> | null,
}))

vi.mock('@/kg/storage/idb-file-store', () => ({
  createIdbFileStore: () => ({
    open: async () => ({ ok: true, value: undefined }),
    purgeTrash: async () => {
      if (fake.purgeGate) await fake.purgeGate
      return 0
    },
    persisted: async () => false,
    list: (dir: string) => {
      fake.lists += 1
      return fake.store.list(dir)
    },
    read: (path: string) => fake.store.read(path),
    write: (path: string, data: Uint8Array) => fake.store.write(path, data),
    trash: async (path: string) => {
      if (fake.gate) await fake.gate
      return fake.store.trash(path)
    },
  }),
}))

const bytes = (text: string) => new TextEncoder().encode(text)

beforeEach(() => {
  vi.resetModules()
  fake.lists = 0
  fake.gate = null
  fake.purgeGate = null
  vi.useRealTimers()
})

/** Holds the first listing open until the returned function is called. */
function holdHydration(): () => void {
  let open: () => void = () => {}
  fake.purgeGate = new Promise<void>((resolve) => {
    open = resolve
  })
  return open
}

async function load(files: Record<string, Uint8Array> = {}) {
  fake.store = createMemoryFileStore({ files })
  const mod = await import('./vault-blobs')
  return mod
}

describe('the page’s document index', () => {
  it('is listed once for the page, however many readers subscribe', async () => {
    const { blobIndex } = await load({ [blobPath('f1', 'cv.pdf')]: bytes('cv') })
    const stops = Array.from({ length: 18 }, () => blobIndex.subscribe(() => {}))
    await blobIndex.ready()
    expect(fake.lists).toBe(1)
    expect(blobIndex.getSnapshot().ready).toBe(true)
    expect(blobIndex.getSnapshot().index.has('f1')).toBe(true)
    for (const stop of stops) stop()
  })

  it('tells every reader about a write made through any of them', async () => {
    const { blobIndex } = await load()
    const a = vi.fn()
    const b = vi.fn()
    blobIndex.subscribe(a)
    blobIndex.subscribe(b)
    await blobIndex.ready()
    const mod = await import('./vault-blobs')
    const before = blobIndex.getSnapshot().revision
    await putVia(mod, 'f2', 'letter.pdf')
    expect(blobIndex.getSnapshot().index.has('f2')).toBe(true)
    expect(blobIndex.getSnapshot().revision).toBeGreaterThan(before)
    expect(a).toHaveBeenCalled()
    expect(b).toHaveBeenCalled()
    // And no re-listing for a change this page made itself.
    expect(fake.lists).toBe(1)
  })
})

describe('Undo of a document delete', () => {
  it('puts the bytes back even when pressed before the delete finished', async () => {
    const mod = await load()
    await mod.blobIndex.ready()
    await putVia(mod, 'f3', 'statement.pdf')

    let open: () => void = () => {}
    fake.gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const removing = mod.vaultBlobStore.remove('f3')
    // Undo, while `trash` is still waiting.
    const restoring = mod.vaultBlobStore.restore('f3')
    open()
    await removing
    expect(await restoring).toBe(true)
    expect(mod.blobIndex.getSnapshot().index.has('f3')).toBe(true)
    const back = await mod.vaultBlobStore.get('f3')
    expect(back === null ? null : await back.text()).toBe('statement.pdf bytes')
  })
})

describe('before the index has hydrated', () => {
  it('a delete still trashes the bytes, says so, and its Undo puts them back', async () => {
    const open = holdHydration()
    const mod = await load({ [blobPath('f1', 'cv.pdf')]: bytes('cv') })
    mod.blobIndex.subscribe(() => {})
    // What the delete hook used to read first: false, before hydration.
    expect(mod.vaultBlobStore.has('f1')).toBe(false)
    const removal = mod.vaultBlobStore.remove('f1')
    open()
    expect(await removal).toBe(true)
    expect(mod.vaultBlobStore.has('f1')).toBe(false)
    expect(await mod.vaultBlobStore.restore('f1')).toBe(true)
    const back = await mod.vaultBlobStore.get('f1')
    expect(back === null ? null : await back.text()).toBe('cv')
  })

  it('a put does not report the index ready while it is missing the rest', async () => {
    const open = holdHydration()
    const mod = await load({ [blobPath('cv1', 'cv.pdf')]: bytes('cv') })
    mod.blobIndex.subscribe(() => {})
    await putVia(mod, 'cap1', 'page.html')
    expect(mod.blobIndex.getSnapshot().ready).toBe(false)
    open()
    await mod.blobIndex.ready()
    expect(mod.blobIndex.getSnapshot().ready).toBe(true)
    expect(mod.vaultBlobStore.has('cv1')).toBe(true)
    expect(mod.vaultBlobStore.has('cap1')).toBe(true)
  })
})

describe('the bytes held for Undo', () => {
  it('are let go once the Undo window has passed', async () => {
    const mod = await load({ [blobPath('f4', 'cv.pdf')]: bytes('cv') })
    await mod.blobIndex.ready()
    vi.useFakeTimers()
    expect(await mod.vaultBlobStore.remove('f4')).toBe(true)
    vi.advanceTimersByTime(mod.TRASH_HOLD_MS - 1)
    vi.advanceTimersByTime(1)
    expect(await mod.vaultBlobStore.restore('f4')).toBe(false)
  })

  it('are still there inside the window', async () => {
    const mod = await load({ [blobPath('f5', 'cv.pdf')]: bytes('cv') })
    await mod.blobIndex.ready()
    vi.useFakeTimers()
    expect(await mod.vaultBlobStore.remove('f5')).toBe(true)
    vi.advanceTimersByTime(mod.TRASH_HOLD_MS - 1)
    expect(await mod.vaultBlobStore.restore('f5')).toBe(true)
  })

  it('are let go by a restore that replaces every document', async () => {
    const mod = await load({ [blobPath('f6', 'cv.pdf')]: bytes('cv') })
    await mod.blobIndex.ready()
    expect(await mod.vaultBlobStore.remove('f6')).toBe(true)
    await mod.vaultBlobStore.replaceAll([])
    expect(await mod.vaultBlobStore.restore('f6')).toBe(false)
  })
})

async function putVia(mod: typeof import('./vault-blobs'), id: string, name: string) {
  const ok = await mod.vaultBlobStore.put(id, new File([`${name} bytes`], name))
  expect(ok).toBe(true)
}
