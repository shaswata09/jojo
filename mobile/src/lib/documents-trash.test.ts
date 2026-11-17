/**
 * health-1 (review 2026-11-17): the phone's set-aside documents follow the records.
 *
 * Only the toast's Undo moved a deleted document's copy back from
 * `.jojo-trashed`. The audit log's Undo last and the assistant's Undo revert the
 * same journal entry, the record returned, and the launch sweep then unlinked
 * every set-aside copy — the row intact, the document gone.
 *
 * The decision is pure (`planTrashedDocuments`) and tested first; then
 * `trashDocument` and `reconcileTrashedDocuments` over a stubbed filesystem.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const disk = vi.hoisted(() => new Map<string, string>())
const kv = vi.hoisted(() => new Map<string, string>())

vi.mock('react-native-blob-util', () => ({
  default: {
    fs: {
      mv: (from: string, to: string) => {
        const data = disk.get(from)
        if (data === undefined || disk.has(to)) return Promise.reject(new Error('mv failed'))
        disk.delete(from)
        disk.set(to, data)
        return Promise.resolve(true)
      },
      unlink: (path: string) =>
        disk.delete(path) ? Promise.resolve() : Promise.reject(new Error('ENOENT')),
      exists: (path: string) => Promise.resolve(disk.has(path)),
    },
  },
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(kv.get(key) ?? null),
    setItem: (key: string, value: string) => {
      kv.set(key, value)
      return Promise.resolve()
    },
  },
}))

vi.mock('@react-native-documents/picker', () => ({
  pick: () => Promise.resolve([]),
  keepLocalCopy: () => Promise.resolve([]),
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  isErrorWithCode: () => false,
}))

vi.mock('react-native', () => ({ Platform: { OS: 'android' }, Share: { share: vi.fn() } }))

const URI = 'file:///data/user/0/jojo/files/abc/1-CV.pdf'
const PATH = '/data/user/0/jojo/files/abc/1-CV.pdf'
const TRASHED = `${PATH}.jojo-trashed`

beforeEach(() => {
  vi.resetModules()
  disk.clear()
  kv.clear()
})

const load = () => import('./documents')

describe('the set-aside documents, decided by the records (health-1)', () => {
  it('moves a copy back once a revert names its path again', async () => {
    const { planTrashedDocuments } = await load()
    const plan = planTrashedDocuments({
      trashed: [TRASHED],
      livePaths: new Set([PATH]),
      sweep: false,
      hydrated: true,
    })
    expect(plan).toEqual({ restore: [{ from: TRASHED, to: PATH }], purge: [], keep: [] })
  })

  it('deletes a copy at launch only when its record is gone', async () => {
    const { planTrashedDocuments } = await load()
    const at = (sweep: boolean) =>
      planTrashedDocuments({ trashed: [TRASHED], livePaths: new Set(), sweep, hydrated: true })
    expect(at(true).purge).toEqual([TRASHED])
    // Mid-session the toast's Undo may still be owed it.
    expect(at(false)).toEqual({ restore: [], purge: [], keep: [TRASHED] })
  })

  it('deletes nothing when the store never hydrated', async () => {
    const { planTrashedDocuments } = await load()
    const plan = planTrashedDocuments({
      trashed: [TRASHED],
      livePaths: new Set(),
      sweep: true,
      hydrated: false,
    })
    expect(plan).toEqual({ restore: [], purge: [], keep: [TRASHED] })
  })

  it('gives the bytes back for an Undo that is not the toast', async () => {
    const docs = await load()
    disk.set(PATH, 'cv')
    await docs.trashDocument(URI, false)
    expect(disk.has(TRASHED)).toBe(true)
    // Audit log › Undo last: the record is back, nothing calls the toast's restore.
    await docs.reconcileTrashedDocuments([URI], { sweep: false, hydrated: true })
    expect(disk.get(PATH)).toBe('cv')
    expect(disk.has(TRASHED)).toBe(false)
  })

  it('puts back at launch what a revert restored before the app closed', async () => {
    const docs = await load()
    disk.set(PATH, 'cv')
    await docs.trashDocument(URI, false)
    // A new launch: a fresh module, the list read back from storage.
    vi.resetModules()
    const relaunched = await load()
    await relaunched.reconcileTrashedDocuments([URI], { sweep: true, hydrated: true })
    expect(disk.get(PATH)).toBe('cv')
  })

  it('unlinks at launch the copy whose record stayed deleted, and keeps it if the boot failed', async () => {
    const docs = await load()
    disk.set(PATH, 'cv')
    await docs.trashDocument(URI, false)
    await docs.reconcileTrashedDocuments([], { sweep: true, hydrated: false })
    expect(disk.has(TRASHED)).toBe(true)
    await docs.reconcileTrashedDocuments([], { sweep: true, hydrated: true })
    expect(disk.size).toBe(0)
  })

  it('restores from the toast even when Undo is pressed before the move finished', async () => {
    const docs = await load()
    disk.set(PATH, 'cv')
    const trashing = docs.trashDocument(URI, false)
    // The same press reaches both paths; neither may lose the copy.
    const reconciling = docs.reconcileTrashedDocuments([URI], { sweep: false, hydrated: true })
    await trashing.then((restoreBytes) => restoreBytes())
    await reconciling
    expect(disk.get(PATH)).toBe('cv')
    expect([...disk.keys()]).toEqual([PATH])
  })
})
