/**
 * Review 3: two races in the documents store, each reproduced before its fix.
 *
 * races-1. `restoreBackup` commits the records first and the documents second.
 * The commit makes every restored file id "appear", and the records
 * subscription goes looking in the trash for each — a slow listing. The
 * generation check that should have made it give way to the restore was read
 * AFTER that listing, by which time the restore had already bumped it, so last
 * week's trashed copy was written over the bytes the backup had just restored.
 *
 * races-2. A first listing that failed — another tab holding the database, or
 * a store that opened and would not list — left an index that was ready and
 * empty, and a backup read that as "no documents": a file holding none, and a
 * toast promising every one.
 *
 * Over the service layer's memory store, with the latency IndexedDB has: the
 * outcome of races-1 depends on it, and passes with none.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryFileStore } from '@jojo/service/storage/memory-file-store'
import type { MemoryFileStore } from '@jojo/service/storage/memory-file-store'
import { blobPath } from '@jojo/service/core/blob-path'

const fake = vi.hoisted(() => ({
  store: null as unknown as MemoryFileStore,
  /** Latency of a trash listing (a getAllKeys plus a meta read per key). */
  trashDelay: 0,
  /** Latency of each write. */
  writeDelay: 0,
  /** When set, `list` answers this instead of asking the store. */
  listAnswer: null as unknown,
}))

vi.mock('@/lib/report-error', () => ({ reportError: () => {} }))
vi.mock('@/kg/storage/idb-file-store', async () => ({
  trashPath: (await import('@jojo/service/storage/file-store')).trashPath,
  isBlockedFailure: (error: { context?: Record<string, unknown> }) =>
    error.context?.blocked === true,
  createIdbFileStore: () => ({
    open: async () => ({ ok: true, value: undefined }),
    purgeTrash: async () => 0,
    persisted: async () => false,
    list: async (dir: string) => fake.listAnswer ?? fake.store.list(dir),
    listTrash: async (dir: string) => {
      await new Promise((resolve) => setTimeout(resolve, fake.trashDelay))
      const listed = await fake.store.list(dir)
      return listed.ok
        ? { ok: true, value: listed.value.map((entry) => ({ ...entry, trashedAt: entry.mtime })) }
        : listed
    },
    stat: (path: string) => fake.store.stat(path),
    read: (path: string) => fake.store.read(path),
    write: async (path: string, data: Uint8Array) => {
      await new Promise((resolve) => setTimeout(resolve, fake.writeDelay))
      return fake.store.write(path, data)
    },
    trash: (path: string) => fake.store.trash(path),
  }),
}))

const bytes = (text: string) => new TextEncoder().encode(text)
const text = (data: Uint8Array) => new TextDecoder().decode(data)

beforeEach(() => {
  vi.resetModules()
  fake.trashDelay = 0
  fake.writeDelay = 0
  fake.listAnswer = null
})

async function load(files: Record<string, Uint8Array> = {}, trash: readonly string[] = []) {
  fake.store = createMemoryFileStore({ files })
  // Trashed before the page loads, as an earlier session's delete was.
  for (const path of trash) await fake.store.trash(path)
  const mod = await import('./vault-blobs')
  mod.blobIndex.subscribe(() => {})
  await mod.blobIndex.ready()
  return mod
}

/** A record store holding `file` records with these ids, and a way to commit. */
function records(initial: readonly string[]) {
  let ids = [...initial]
  const listeners = new Set<() => void>()
  return {
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    getSnapshot: () => ({ ofType: () => ids.map((id) => ({ id })) }) as never,
    commit(next: readonly string[]) {
      ids = [...next]
      for (const fn of listeners) fn()
    },
  }
}

const others = Array.from({ length: 6 }, (_, i) => ({
  path: blobPath(`Y${i}`, 'letter.pdf'),
  data: bytes('y'),
}))

describe('a backup restore over a document whose older copy is in the trash (races-1)', () => {
  it('ends with the backup’s bytes, not the trash copy’s, when the delete was an earlier session’s', async () => {
    const path = blobPath('X', 'cv.pdf')
    const mod = await load({ [path]: bytes('OLD version, deleted last week') }, [path])
    fake.trashDelay = 3
    fake.writeDelay = 2
    const repo = records([])
    mod.bindRecords(repo, false)

    // restoreBackup: the records first, then — without waiting — the documents.
    repo.commit(['X', ...others.map((_, i) => `Y${i}`)])
    const landed = await mod.vaultBlobStore.replaceAll([
      { path, data: bytes('NEW version from the backup') },
      ...others,
    ])
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(landed).toBe(7)
    const read = await fake.store.read(path)
    expect(read.ok && text(read.value)).toBe('NEW version from the backup')
    expect(mod.blobIndex.getSnapshot().index.get('X')).toBe(path)
  })

  it('ends with the backup’s bytes when this session deleted the document past its hold', async () => {
    // Past `TRASH_HOLD_MS`, the Undo reads the trash copy back (`fromTrash`),
    // which takes long enough for the restore's own write to land first.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const path = blobPath('X', 'cv.pdf')
      const mod = await load({ [path]: bytes('OLD version, deleted a while ago') })
      const repo = records(['X'])
      mod.bindRecords(repo, false)
      expect(await mod.vaultBlobStore.remove('X')).toBe(true)
      repo.commit([])
      await vi.advanceTimersByTimeAsync(mod.TRASH_HOLD_MS + 1)
      fake.writeDelay = 2

      repo.commit(['X', ...others.map((_, i) => `Y${i}`)])
      const replaced = mod.vaultBlobStore.replaceAll([
        { path, data: bytes('NEW version from the backup') },
        ...others,
      ])
      await vi.advanceTimersByTimeAsync(100)
      expect(await replaced).toBe(7)

      const read = await fake.store.read(path)
      expect(read.ok && text(read.value)).toBe('NEW version from the backup')
    } finally {
      vi.useRealTimers()
    }
  })

  it('still puts a trashed copy back for a revert that no restore follows', async () => {
    // The companion: the guard must not stop the ordinary ⌘Z of a delete.
    const path = blobPath('X', 'cv.pdf')
    const mod = await load({ [path]: bytes('the CV') }, [path])
    fake.trashDelay = 3
    const repo = records([])
    mod.bindRecords(repo, false)
    repo.commit(['X'])
    await new Promise((resolve) => setTimeout(resolve, 30))
    const read = await fake.store.read(path)
    expect(read.ok && text(read.value)).toBe('the CV')
  })
})

describe('a document listing that failed (races-2)', () => {
  it.each([
    [
      'another tab holds the database',
      {
        ok: false,
        error: { code: 'files/failed', message: 'list: blocked', context: { blocked: true } },
      },
    ],
    [
      'the store would not list',
      { ok: false, error: { code: 'files/failed', message: 'list: broke' } },
    ],
  ])('%s: is not passed off as an empty store, and a backup refuses', async (_case, answer) => {
    fake.listAnswer = answer
    const mod = await load({ [blobPath('f1', 'cv.pdf')]: bytes('cv') })
    const { streamDocuments, DOCUMENTS_UNAVAILABLE } = await import('./backup')
    const snapshot = mod.blobIndex.getSnapshot()
    expect(snapshot.ready).toBe(true)
    expect(snapshot.failed).toBe(true)

    const sink = vi.fn(async () => undefined)
    await expect(
      streamDocuments(
        {
          ready: snapshot.ready,
          failed: snapshot.failed,
          all: mod.vaultBlobStore.all,
          get: mod.vaultBlobStore.get,
        },
        sink,
      ),
    ).rejects.toThrow(DOCUMENTS_UNAVAILABLE)
    expect(sink).not.toHaveBeenCalled()
  })

  it('clears once a listing answers', async () => {
    fake.listAnswer = { ok: false, error: { code: 'files/failed', message: 'list: broke' } }
    const mod = await load({ [blobPath('f1', 'cv.pdf')]: bytes('cv') })
    expect(mod.blobIndex.getSnapshot().failed).toBe(true)
    fake.listAnswer = null
    // A lookup that misses lists the folder itself, and that listing answered.
    expect(await mod.vaultBlobStore.get('f1')).not.toBeNull()
    expect(mod.blobIndex.getSnapshot()).toMatchObject({ failed: false, blocked: false })
    expect(mod.vaultBlobStore.has('f1')).toBe(true)
  })
})
