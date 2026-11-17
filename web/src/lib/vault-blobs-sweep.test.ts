/**
 * health-1 (review 2026-11-17): the trash is decided by the records.
 *
 * Only the toast's Undo used to put a deleted document's bytes back. ⌘Z, both
 * audit logs' Undo and the assistant's step Undo revert the same journal entry
 * and left the bytes in `jojo/Trash`, which the next load emptied wholesale —
 * the record back, its document gone. And the reverse: ⌘Z of an upload, or the
 * assistant's `vault.file.delete`, left bytes no record named, for good.
 *
 * The decisions are pure (`planSweep`, `purgesTrashed`) and tested first; then
 * the module, over the service layer's memory store, for the paths that join
 * them — a revert from anywhere, a load, a boot that never hydrated.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryFileStore } from '@jojo/service/storage/memory-file-store'
import type { MemoryFileStore } from '@jojo/service/storage/memory-file-store'
import { blobPath } from '@jojo/service/core/blob-path'
import { trashPath } from '@jojo/service/storage/file-store'

const fake = vi.hoisted(() => ({
  store: null as unknown as MemoryFileStore,
  purges: 0,
  /**
   * What the IndexedDB adapter keeps in `meta` for a trashed key: when it was
   * trashed and the exact path it came from. A key missing here is a copy
   * trashed by a build from before either was recorded.
   */
  trashMeta: new Map<string, { trashedAt: number; from?: string }>(),
}))

vi.mock('@/kg/storage/idb-file-store', async () => ({
  trashPath: (await import('@jojo/service/storage/file-store')).trashPath,
  isBlockedFailure: () => false,
  createIdbFileStore: () => ({
    // As the adapter: stamps the copy with when and from where.
    trash: async (path: string) => {
      const { trashPath: at } = await import('@jojo/service/storage/file-store')
      let n = 1
      while ((await fake.store.stat(at(path, n))).ok) n += 1
      const moved = await fake.store.trash(path)
      if (moved.ok) fake.trashMeta.set(at(path, n), { trashedAt: Date.now(), from: path })
      return moved
    },
    // As the adapter: a copy with no stamp is stamped "trashed now", and kept.
    listTrash: async (dir: string) => {
      const listed = await fake.store.list(dir)
      if (!listed.ok) return listed
      return {
        ok: true,
        value: listed.value.map((entry) => {
          let meta = fake.trashMeta.get(entry.path)
          if (meta === undefined) {
            meta = { trashedAt: Date.now() }
            fake.trashMeta.set(entry.path, meta)
          }
          return { ...entry, ...meta }
        }),
      }
    },
    open: async () => ({ ok: true, value: undefined }),
    // What the IndexedDB adapter does, over the memory store: every trashed key
    // the predicate agrees to, gone.
    purgeTrash: async (only?: (key: string) => boolean) => {
      fake.purges += 1
      const doomed = Object.keys(fake.store.snapshot()).filter(
        (key) => key.startsWith('jojo/Trash/') && (only === undefined || only(key)),
      )
      for (const key of doomed) fake.store.remove(key)
      return doomed.length
    },
    persisted: async () => false,
    list: (dir: string) => fake.store.list(dir),
    stat: (path: string) => fake.store.stat(path),
    read: (path: string) => fake.store.read(path),
    write: (path: string, data: Uint8Array) => fake.store.write(path, data),
  }),
}))

const bytes = (text: string) => new TextEncoder().encode(text)
const trashed = (id: string, name: string) => trashPath(blobPath(id, name), 1)

beforeEach(() => {
  vi.resetModules()
  fake.purges = 0
  fake.trashMeta.clear()
})

async function load(files: Record<string, Uint8Array> = {}) {
  fake.store = createMemoryFileStore({ files })
  return import('./vault-blobs')
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
    /** A commit that leaves exactly these records live — a delete, a revert. */
    commit(next: readonly string[]) {
      ids = [...next]
      for (const fn of listeners) fn()
    },
  }
}

const facts = (
  over: Partial<import('./vault-blobs').SweepFacts> = {},
): import('./vault-blobs').SweepFacts => ({
  hydrated: true,
  isLive: () => false,
  hasDocument: () => false,
  heldBySession: () => false,
  ...over,
})

describe('the sweep, decided by the records (health-1)', () => {
  it('puts back a trashed document whose record a revert brought back', async () => {
    const { planSweep } = await load()
    const plan = planSweep({
      facts: facts({ isLive: (id) => id === 'f1' }),
      documents: [],
      trash: [{ path: trashed('f1', 'cv.pdf'), mtime: 1 }],
      now: 10,
    })
    expect(plan.restore).toEqual([
      { id: 'f1', from: trashed('f1', 'cv.pdf'), to: blobPath('f1', 'cv.pdf') },
    ])
    expect(plan.purge).toEqual([])
  })

  it('purges a trashed document whose record is gone', async () => {
    const { planSweep, TRASH_RETENTION_MS } = await load()
    // Once it has been in the trash for the retention window.
    const plan = planSweep({
      facts: facts(),
      documents: [],
      trash: [{ path: trashed('f1', 'cv.pdf'), mtime: 1, trashedAt: 10 }],
      now: 10 + TRASH_RETENTION_MS,
    })
    expect(plan.purge).toEqual([trashed('f1', 'cv.pdf')])
    expect(plan.restore).toEqual([])
  })

  it('touches nothing before the record store has hydrated', async () => {
    const { planSweep, purgesTrashed } = await load()
    const notYet = facts({ hydrated: false })
    const plan = planSweep({
      facts: notYet,
      documents: [{ path: blobPath('orphan', 'cv.pdf'), mtime: 0 }],
      trash: [{ path: trashed('gone', 'cv.pdf'), mtime: 0 }],
      now: Number.MAX_SAFE_INTEGER,
    })
    expect(plan).toEqual({ restore: [], purge: [], reclaim: [] })
    expect(purgesTrashed(trashed('gone', 'cv.pdf'), notYet)).toBe(false)
  })

  it('reclaims a live document no record names, once it is past the grace', async () => {
    const { planSweep, ORPHAN_GRACE_MS } = await load()
    const input = {
      facts: facts({ isLive: (id: string) => id === 'kept' }),
      documents: [
        { path: blobPath('orphan', 'cv.pdf'), mtime: 0 },
        { path: blobPath('kept', 'letter.pdf'), mtime: 0 },
        { path: 'Documents/not-ours.pdf', mtime: 0 },
      ],
      trash: [],
    }
    expect(planSweep({ ...input, now: ORPHAN_GRACE_MS }).reclaim).toEqual([
      blobPath('orphan', 'cv.pdf'),
    ])
    // Inside the grace a record may still be in another tab's write queue.
    expect(planSweep({ ...input, now: ORPHAN_GRACE_MS - 1 }).reclaim).toEqual([])
  })

  it('never purges the copy this page may still be asked to put back', async () => {
    const { purgesTrashed } = await load()
    expect(purgesTrashed(trashed('f1', 'cv.pdf'), facts({ heldBySession: () => true }))).toBe(false)
  })

  it('purges a leftover copy once its record already has its document', async () => {
    const { purgesTrashed } = await load()
    const live = facts({ isLive: () => true, hasDocument: () => true })
    expect(purgesTrashed(trashed('f1', 'cv.pdf'), live)).toBe(true)
    expect(purgesTrashed(trashed('f1', 'cv.pdf'), facts({ isLive: () => true }))).toBe(false)
  })

  it('reads a numbered trash copy back to the path it was trashed from', async () => {
    const { untrashed, planSweep } = await load()
    const path = blobPath('f1', 'cv.final.pdf')
    expect(untrashed(trashPath(path, 1))).toEqual({ path, n: 1 })
    expect(untrashed(trashPath(path, 3))).toEqual({ path, n: 3 })
    expect(untrashed('Documents/f1__cv.pdf')).toBeNull()
    // Of two copies, the newer comes back.
    const plan = planSweep({
      facts: facts({ isLive: () => true }),
      documents: [],
      trash: [
        { path: trashPath(path, 1), mtime: 5 },
        { path: trashPath(path, 2), mtime: 5 },
      ],
      now: 10,
    })
    expect(plan.restore).toEqual([{ id: 'f1', from: trashPath(path, 2), to: path }])
  })
})

describe('a document delete undone by something other than the toast (health-1)', () => {
  it('gets its bytes back from a revert committed anywhere', async () => {
    const mod = await load({ [blobPath('f1', 'cv.pdf')]: bytes('cv') })
    const repo = records(['f1'])
    mod.bindRecords(repo, false)
    await mod.blobIndex.ready()

    // The delete, as `useFileDelete` makes it: record, then bytes.
    repo.commit([])
    expect(await mod.vaultBlobStore.remove('f1')).toBe(true)
    expect(mod.vaultBlobStore.has('f1')).toBe(false)

    // ⌘Z — the journal reverts; nothing calls `blobs.restore`.
    repo.commit(['f1'])
    await vi.waitFor(() => expect(mod.vaultBlobStore.has('f1')).toBe(true))
    const back = await mod.vaultBlobStore.get('f1')
    expect(back === null ? null : await back.text()).toBe('cv')
  })

  it('answers the toast true when the revert already brought the bytes back', async () => {
    const mod = await load({ [blobPath('f2', 'cv.pdf')]: bytes('cv') })
    const repo = records(['f2'])
    mod.bindRecords(repo, false)
    await mod.blobIndex.ready()
    repo.commit([])
    const removal = mod.vaultBlobStore.remove('f2')
    // The toast's onClick: `restore()` commits, then asks for the bytes.
    repo.commit(['f2'])
    expect(await mod.vaultBlobStore.restore('f2')).toBe(true)
    expect(await removal).toBe(true)
  })

  it('gets bytes back that an earlier session trashed, when the record reappears', async () => {
    const mod = await load({ [trashed('f3', 'cv.pdf')]: bytes('old cv') })
    const repo = records([])
    mod.bindRecords(repo, false)
    await mod.blobIndex.ready()
    // Settings › Audit log › Undo of a delete made before this load.
    repo.commit(['f3'])
    await vi.waitFor(() => expect(mod.vaultBlobStore.has('f3')).toBe(true))
  })
})

describe('the page-load sweep (health-1)', () => {
  it('puts back what a revert restored before the reload, and purges what stayed deleted', async () => {
    const mod = await load({
      [trashed('back', 'cv.pdf')]: bytes('cv'),
      [trashed('gone', 'letter.pdf')]: bytes('letter'),
    })
    // Trashed longer ago than the retention window.
    fake.trashMeta.set(trashed('gone', 'letter.pdf'), {
      trashedAt: Date.now() - mod.TRASH_RETENTION_MS - 1,
    })
    mod.bindRecords(records(['back']), true)
    await vi.waitFor(() => expect(fake.purges).toBe(1))
    expect(mod.vaultBlobStore.has('back')).toBe(true)
    expect(Object.keys(fake.store.snapshot()).sort()).toEqual([blobPath('back', 'cv.pdf')])
  })

  it('deletes nothing when the record store never hydrated', async () => {
    const mod = await load({
      [blobPath('orphan', 'cv.pdf')]: bytes('cv'),
      [trashed('gone', 'letter.pdf')]: bytes('letter'),
    })
    // A failed boot: an in-memory graph with no records in it.
    mod.bindRecords(records([]), false)
    await mod.blobIndex.ready()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fake.purges).toBe(0)
    expect(Object.keys(fake.store.snapshot()).sort()).toEqual(
      [blobPath('orphan', 'cv.pdf'), trashed('gone', 'letter.pdf')].sort(),
    )
  })

  it('reclaims a document no record names, and leaves the one a record does', async () => {
    const mod = await load({
      [blobPath('orphan', 'cv.pdf')]: bytes('cv'),
      [blobPath('kept', 'letter.pdf')]: bytes('letter'),
    })
    mod.bindRecords(records(['kept']), true)
    await vi.waitFor(() => expect(fake.purges).toBe(1))
    expect(mod.vaultBlobStore.has('orphan')).toBe(false)
    expect(mod.vaultBlobStore.has('kept')).toBe(true)
    // Into the trash, not unlinked: kept there for the retention window.
    expect(Object.keys(fake.store.snapshot()).sort()).toEqual(
      [blobPath('kept', 'letter.pdf'), trashed('orphan', 'cv.pdf')].sort(),
    )
  })
})

/** The same store, a fresh page: what a reload looks like to this module. */
const reload = () => {
  vi.resetModules()
  return import('./vault-blobs')
}

describe('the trash keeps a document for the retention window', () => {
  it('keeps a copy whose record is gone until the window has passed', async () => {
    const { planSweep, purgesTrashed, TRASH_RETENTION_MS } = await load()
    const copy = { path: trashed('f1', 'cv.pdf'), mtime: 1, trashedAt: 1_000 }
    const at = (now: number) => planSweep({ facts: facts(), documents: [], trash: [copy], now })
    expect(at(1_000 + TRASH_RETENTION_MS - 1).purge).toEqual([])
    expect(at(1_000 + TRASH_RETENTION_MS).purge).toEqual([copy.path])
    // Past the window but with its record back, it is put back, never purged.
    const back = planSweep({
      facts: facts({ isLive: () => true }),
      documents: [],
      trash: [copy],
      now: 1_000 + 2 * TRASH_RETENTION_MS,
    })
    expect(back.purge).toEqual([])
    expect(back.restore.map((r) => r.id)).toEqual(['f1'])
    // The purge's own re-check agrees.
    const gone = { trashedAt: 1_000, now: 1_000 + TRASH_RETENTION_MS - 1 }
    expect(purgesTrashed(copy.path, facts(), gone)).toBe(false)
  })

  it('brings the bytes back for an audit-log Undo made two reloads after the delete', async () => {
    const mod = await load({ [blobPath('f1', 'cv.pdf')]: bytes('cv') })
    const repo = records(['f1'])
    mod.bindRecords(repo, true)
    await vi.waitFor(() => expect(fake.purges).toBe(1))
    repo.commit([])
    expect(await mod.vaultBlobStore.remove('f1')).toBe(true)

    // Two loads with the record still deleted: each sweeps, neither purges.
    for (let i = 0; i < 2; i += 1) {
      fake.purges = 0
      const page = await reload()
      page.bindRecords(records([]), true)
      await vi.waitFor(() => expect(fake.purges).toBe(1))
    }
    expect(Object.keys(fake.store.snapshot())).toEqual([trashed('f1', 'cv.pdf')])

    // Settings › Audit log › Undo, on the third page.
    const page = await reload()
    const later = records([])
    page.bindRecords(later, false)
    await page.blobIndex.ready()
    later.commit(['f1'])
    await vi.waitFor(() => expect(page.vaultBlobStore.has('f1')).toBe(true))
    const back = await page.vaultBlobStore.get('f1')
    expect(back === null ? null : await back.text()).toBe('cv')
  })

  it('does not purge a copy with no timestamp on the first run after the upgrade', async () => {
    const { purgesTrashed } = await load()
    // No age known: kept, whatever the clock says.
    expect(purgesTrashed(trashed('f1', 'cv.pdf'), facts())).toBe(false)
    expect(purgesTrashed(trashed('f1', 'cv.pdf'), facts(), { now: Number.MAX_SAFE_INTEGER })).toBe(
      false,
    )

    // A copy an older build trashed: no stamp in `meta`, its record long gone.
    const mod = await load({ [trashed('old', 'cv.pdf')]: bytes('cv') })
    mod.bindRecords(records([]), true)
    await vi.waitFor(() => expect(fake.purges).toBe(1))
    expect(Object.keys(fake.store.snapshot())).toEqual([trashed('old', 'cv.pdf')])
    // Stamped "trashed now", so the window starts once rather than never ending.
    const stamped = fake.trashMeta.get(trashed('old', 'cv.pdf'))?.trashedAt ?? 0
    expect(Date.now() - stamped).toBeLessThan(mod.TRASH_RETENTION_MS)
  })

  it('reclaims a document no record names into the trash, where the window applies', async () => {
    const mod = await load({ [blobPath('orphan', 'cv.pdf')]: bytes('cv') })
    mod.bindRecords(records([]), true)
    await vi.waitFor(() => expect(fake.purges).toBe(1))
    expect(fake.trashMeta.get(trashed('orphan', 'cv.pdf'))?.from).toBe(blobPath('orphan', 'cv.pdf'))
    // The next load does not purge it: it was trashed a moment ago.
    fake.purges = 0
    const page = await reload()
    page.bindRecords(records([]), true)
    await vi.waitFor(() => expect(fake.purges).toBe(1))
    expect(Object.keys(fake.store.snapshot())).toEqual([trashed('orphan', 'cv.pdf')])
  })
})

describe('a name that already ended in a number', () => {
  it('round-trips a name ending in " (2)" through the trash', async () => {
    const { restoreTarget, untrashed } = await load()
    const path = blobPath('f1', 'CV (2).pdf')
    const key = trashPath(path, 1)
    // The key alone reads as the second copy of `CV.pdf`.
    expect(untrashed(key)?.path).toBe(blobPath('f1', 'CV.pdf'))
    // The path the store recorded at `trash` wins.
    expect(restoreTarget({ path: key, from: path })?.path).toBe(path)
    // ...but never one belonging to another record.
    expect(restoreTarget({ path: key, from: blobPath('f9', 'x.pdf') })?.path).toBe(
      blobPath('f1', 'CV.pdf'),
    )

    // End to end: deleted on one page, brought back by a revert on the next.
    const mod = await load({ [path]: bytes('cv two') })
    const repo = records(['f1'])
    mod.bindRecords(repo, false)
    await mod.blobIndex.ready()
    repo.commit([])
    expect(await mod.vaultBlobStore.remove('f1')).toBe(true)
    const page = await reload()
    page.bindRecords(records(['f1']), true)
    await vi.waitFor(() => expect(page.vaultBlobStore.has('f1')).toBe(true))
    const back = await page.vaultBlobStore.get('f1')
    expect(back?.name).toBe('CV (2).pdf')
    expect(Object.keys(fake.store.snapshot())).toContain(path)
  })
})
