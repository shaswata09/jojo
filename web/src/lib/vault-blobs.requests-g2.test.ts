/**
 * Q244: the How you fit card said "no copy of that document is stored in this
 * browser" about a posting that plainly was — so the fit panel could not read
 * it, and nothing uploaded fed the analysis.
 *
 * One of the causes was here: the page's document index is filled after the
 * trash sweep, and a lookup made before that answered from the empty index. The
 * fit panel asks exactly then, in its own mount effect, and by design never asks
 * again. A lookup that misses the index now asks the folder itself.
 *
 * The other causes are held elsewhere: `service/kg/core/twin.test.ts` ("believes
 * the caller about bytes over the record, because the web writes no flag" — the
 * offer to read an upload never fired on web), `file-input.test.ts` (the
 * profile's picker filed nothing) and `read-here.test.ts` (a saved posting is
 * read in the tab).
 *
 * The IndexedDB store is replaced by the service layer's memory store, as in
 * `vault-blobs-store.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryFileStore } from '@jojo/service/storage/memory-file-store'
import type { MemoryFileStore } from '@jojo/service/storage/memory-file-store'
import { blobPath } from '@jojo/service/core/blob-path'

const fake = vi.hoisted(() => ({
  store: null as unknown as MemoryFileStore,
  /** When set, the page-load trash sweep waits for this — hydration held open. */
  purgeGate: null as Promise<void> | null,
}))

vi.mock('@/kg/storage/idb-file-store', async () => ({
  trashPath: (await import('@jojo/service/storage/file-store')).trashPath,
  isBlockedFailure: (error: { context?: Record<string, unknown> }) => error.context?.blocked === true,
  createIdbFileStore: () => ({
    open: async () => ({ ok: true, value: undefined }),
    purgeTrash: async () => {
      if (fake.purgeGate) await fake.purgeGate
      return 0
    },
    persisted: async () => false,
    list: (dir: string) => fake.store.list(dir),
    stat: (path: string) => fake.store.stat(path),
    read: (path: string) => fake.store.read(path),
    write: (path: string, data: Uint8Array) => fake.store.write(path, data),
    trash: (path: string) => fake.store.trash(path),
  }),
}))

const bytes = (text: string) => new TextEncoder().encode(text)

beforeEach(() => {
  vi.resetModules()
  fake.purgeGate = null
})

describe('Q244 — a stored document is found before the page index is ready', () => {
  it('hands back the bytes of a document asked for while the index is still empty', async () => {
    let open: () => void = () => {}
    fake.purgeGate = new Promise<void>((resolve) => {
      open = resolve
    })
    fake.store = createMemoryFileStore({
      files: { [blobPath('posting1', 'posting.html')]: bytes('<h1>Faculty</h1>') },
    })
    const mod = await import('./vault-blobs')
    mod.blobIndex.subscribe(() => {})
    // The index has not hydrated: it does not know the document yet.
    expect(mod.vaultBlobStore.has('posting1')).toBe(false)

    const file = await mod.vaultBlobStore.get('posting1')
    expect(file === null ? null : await file.text()).toBe('<h1>Faculty</h1>')
    expect(file?.name).toBe('posting.html')
    open()
  })

  it('still says no for a document that is not stored at all', async () => {
    fake.store = createMemoryFileStore({ files: {} })
    const mod = await import('./vault-blobs')
    expect(await mod.vaultBlobStore.get('missing')).toBeNull()
  })
})
