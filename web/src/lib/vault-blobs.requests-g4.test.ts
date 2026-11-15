/**
 * Q099: a deleted document stops taking up space.
 *
 * Three links, and each is a place the bytes could be left behind:
 *
 *   1. deleting the record deletes its bytes (`useFileDelete` -> `blobs.remove`);
 *   2. `remove` takes the bytes out of `Documents/` — into `jojo/Trash`, so the
 *      Undo on screen can put them back;
 *   3. the next page load purges `jojo/Trash` before anything is listed.
 *
 * That `purgeTrash` really frees the bytes in IndexedDB is
 * `kg/storage/idb-file-store.test.ts` ("purgeTrash reclaims deleted
 * documents"); this file is the path that has to reach it. The store is faked
 * the same way `vault-blobs-store.test.ts` fakes it, over the memory adapter.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryFileStore } from '@jojo/service/storage/memory-file-store'
import type { MemoryFileStore } from '@jojo/service/storage/memory-file-store'
import { blobPath } from '@jojo/service/core/blob-path'
import fileDeleteSource from './use-file-delete.ts?raw'

const fake = vi.hoisted(() => ({
  store: null as unknown as MemoryFileStore,
  /** Every call the module made, in order, so "purge before list" is checkable. */
  calls: [] as string[],
}))

vi.mock('@/kg/storage/idb-file-store', async () => ({
  trashPath: (await import('@jojo/service/storage/file-store')).trashPath,
  isBlockedFailure: () => false,
  createIdbFileStore: () => ({
    open: async () => ({ ok: true, value: undefined }),
    purgeTrash: async () => {
      fake.calls.push('purgeTrash')
      return 0
    },
    persisted: async () => false,
    list: (dir: string) => {
      fake.calls.push(`list ${dir}`)
      return fake.store.list(dir)
    },
    stat: (path: string) => fake.store.stat(path),
    read: (path: string) => fake.store.read(path),
    write: (path: string, data: Uint8Array) => fake.store.write(path, data),
    trash: (path: string) => fake.store.trash(path),
  }),
}))

const bytes = (text: string) => new TextEncoder().encode(text)

async function load(files: Record<string, Uint8Array>) {
  fake.store = createMemoryFileStore({ files })
  return import('./vault-blobs')
}

beforeEach(() => {
  vi.resetModules()
  fake.calls = []
})

describe('a deleted document’s bytes (Q099)', () => {
  it('leave Documents the moment the document is deleted', async () => {
    const path = blobPath('f1', 'cv.pdf')
    const mod = await load({ [path]: bytes('%PDF-1.7 cv') })
    await mod.blobIndex.ready()

    expect(await mod.vaultBlobStore.remove('f1')).toBe(true)

    const documents = await fake.store.list('Documents')
    expect(documents.ok && documents.value.map((e) => e.path)).toEqual([])
    expect(await mod.vaultBlobStore.get('f1')).toBeNull()
  })

  it('are purged on the next page load, before the index is read', async () => {
    const mod = await load({ [blobPath('f2', 'cv.pdf')]: bytes('cv') })
    await mod.blobIndex.ready()

    expect(fake.calls.filter((c) => c === 'purgeTrash')).toHaveLength(1)
    const purge = fake.calls.indexOf('purgeTrash')
    const firstList = fake.calls.findIndex((c) => c.startsWith('list '))
    expect(firstList).toBeGreaterThan(purge)
  })

  it('go with the record: the delete hook removes them as well', () => {
    const code = fileDeleteSource.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    const removedRecord = code.indexOf('removeFile(file.id)')
    const removedBytes = code.indexOf('blobs.remove(file.id)')
    expect(removedRecord).toBeGreaterThan(-1)
    expect(removedBytes).toBeGreaterThan(removedRecord)
  })
})
