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
/** How many of the next `mv` calls fail, whatever they move. */
const mvFails = vi.hoisted(() => ({ count: 0 }))

vi.mock('react-native-blob-util', () => ({
  default: {
    fs: {
      dirs: { DocumentDir: '/data/user/0/jojo/files' },
      mv: (from: string, to: string) => {
        if (mvFails.count > 0) {
          mvFails.count -= 1
          return Promise.reject(new Error('mv failed (transient)'))
        }
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

// Nothing here reads a sentence, and the real module pulls in twenty locales'
// catalogs: under a loaded machine that first import alone ran past the 5 s
// test timeout (coverage-13).
vi.mock('@/i18n/i18n', () => ({ i18next: { t: (key: string) => key } }))

const URI = 'file:///data/user/0/jojo/files/abc/1-CV.pdf'
const PATH = '/data/user/0/jojo/files/abc/1-CV.pdf'
const TRASHED = `${PATH}.jojo-trashed`

beforeEach(() => {
  vi.resetModules()
  disk.clear()
  kv.clear()
  mvFails.count = 0
})

const load = () => import('./documents')

/** The paths the stored trash list names. */
const listed = () =>
  (JSON.parse(kv.get('jojo/documents/trashed') ?? '[]') as { path: string }[]).map((e) => e.path)

describe('the set-aside documents, decided by the records (health-1)', () => {
  it('moves a copy back once a revert names its path again', async () => {
    const { planTrashedDocuments } = await load()
    const plan = planTrashedDocuments({
      trashed: [{ path: TRASHED, at: 0 }],
      livePaths: new Set([PATH]),
      sweep: false,
      hydrated: true,
      now: 0,
    })
    expect(plan).toEqual({ restore: [{ from: TRASHED, to: PATH }], purge: [], keep: [] })
  })

  it('deletes a copy at launch only when its record is gone', async () => {
    const { planTrashedDocuments, TRASH_RETENTION_MS } = await load()
    const entry = { path: TRASHED, at: 0 }
    // Set aside longer ago than the retention window.
    const at = (sweep: boolean) =>
      planTrashedDocuments({
        trashed: [entry],
        livePaths: new Set(),
        sweep,
        hydrated: true,
        now: TRASH_RETENTION_MS,
      })
    expect(at(true).purge).toEqual([TRASHED])
    // Mid-session the toast's Undo may still be owed it.
    expect(at(false)).toEqual({ restore: [], purge: [], keep: [entry] })
  })

  it('deletes nothing when the store never hydrated', async () => {
    const { planTrashedDocuments } = await load()
    const plan = planTrashedDocuments({
      trashed: [{ path: TRASHED, at: 0 }],
      livePaths: new Set(),
      sweep: true,
      hydrated: false,
      now: Number.MAX_SAFE_INTEGER,
    })
    expect(plan).toEqual({ restore: [], purge: [], keep: [{ path: TRASHED, at: 0 }] })
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
    // A launch past the retention window.
    const later = Date.now() + docs.TRASH_RETENTION_MS
    await docs.reconcileTrashedDocuments([], { sweep: true, hydrated: false, now: later })
    expect(disk.has(TRASHED)).toBe(true)
    await docs.reconcileTrashedDocuments([], { sweep: true, hydrated: true, now: later })
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

describe('a document whose record left some other way', () => {
  it('names the paths a commit dropped, never one still named', async () => {
    const { vanishedDocuments } = await load()
    const other = 'file:///data/user/0/jojo/files/def/2-Letter.pdf'
    expect(vanishedDocuments([URI, other, undefined], [other])).toEqual([PATH])
    // A duplicate row still names it.
    expect(vanishedDocuments([URI, URI], [URI])).toEqual([])
    expect(vanishedDocuments([URI, URI], [])).toEqual([PATH])
  })

  it('sets aside the bytes of a record the assistant deleted, and a revert puts them back', async () => {
    const docs = await load()
    disk.set(PATH, 'cv')
    // `vault.file.delete` commits: the record is gone and nothing called `trashDocument`.
    const vanished = docs.vanishedDocuments([URI], [])
    await docs.reconcileTrashedDocuments([], { sweep: false, hydrated: true, vanished })
    expect(disk.has(PATH)).toBe(false)
    expect(disk.get(TRASHED)).toBe('cv')
    // The assistant's step Undo, or Undo last: the record is back.
    await docs.reconcileTrashedDocuments([URI], { sweep: false, hydrated: true })
    expect(disk.get(PATH)).toBe('cv')
    expect(disk.has(TRASHED)).toBe(false)
  })

  it('sets nothing aside before the store hydrated, or while another record names it', async () => {
    const docs = await load()
    disk.set(PATH, 'cv')
    await docs.reconcileTrashedDocuments([], { sweep: false, hydrated: false, vanished: [PATH] })
    expect(disk.get(PATH)).toBe('cv')
    await docs.reconcileTrashedDocuments([URI], { sweep: false, hydrated: true, vanished: [PATH] })
    expect(disk.get(PATH)).toBe('cv')
    expect(kv.get('jojo/documents/trashed') ?? '[]').toBe('[]')
  })

  it("does not trash twice when the row's delete already set the bytes aside", async () => {
    const docs = await load()
    disk.set(PATH, 'cv')
    // `FilesTool`'s delete, then the commit that removed the record.
    const trashing = docs.trashDocument(URI, false)
    await docs.reconcileTrashedDocuments([], { sweep: false, hydrated: true, vanished: [PATH] })
    await trashing
    const listed = JSON.parse(kv.get('jojo/documents/trashed') ?? '[]') as { path: string }[]
    expect(listed.map((entry) => entry.path)).toEqual([TRASHED])
    // And the other order: the commit got there first, the toast's restore is a
    // no-op, and the revert brings the bytes back.
    disk.clear()
    kv.clear()
    vi.resetModules()
    const again = await load()
    disk.set(PATH, 'cv')
    await again.reconcileTrashedDocuments([], { sweep: false, hydrated: true, vanished: [PATH] })
    const restoreBytes = await again.trashDocument(URI, false)
    await restoreBytes()
    await again.reconcileTrashedDocuments([URI], { sweep: false, hydrated: true })
    expect([...disk.entries()]).toEqual([[PATH, 'cv']])
  })
})

describe('the retention window', () => {
  it('keeps a set-aside copy until the window has passed, then a launch deletes it', async () => {
    const docs = await load()
    disk.set(PATH, 'cv')
    await docs.trashDocument(URI, false)
    const at = Date.now()
    // The next launch, a day later: the record is still gone, the copy stays.
    vi.resetModules()
    const next = await load()
    await next.reconcileTrashedDocuments([], { sweep: true, hydrated: true, now: at + 86_400_000 })
    expect(disk.has(TRASHED)).toBe(true)
    // An audit-log Undo in that launch still finds it.
    await next.reconcileTrashedDocuments([URI], { sweep: false, hydrated: true })
    expect(disk.get(PATH)).toBe('cv')
    // Deleted again, and a launch past the window: gone.
    await next.trashDocument(URI, false)
    vi.resetModules()
    const late = await load()
    const past = Date.now() + late.TRASH_RETENTION_MS
    await late.reconcileTrashedDocuments([], { sweep: true, hydrated: true, now: past })
    expect(disk.size).toBe(0)
  })

  it('reads an entry stored without a timestamp as set aside now, and keeps it on the first launch', async () => {
    // What an older build wrote: bare paths.
    kv.set('jojo/documents/trashed', JSON.stringify([TRASHED]))
    disk.set(TRASHED, 'cv')
    const docs = await load()
    await docs.reconcileTrashedDocuments([], { sweep: true, hydrated: true })
    expect(disk.get(TRASHED)).toBe('cv')
    // Written back with the stamp, so the window starts once.
    const listed = JSON.parse(kv.get('jojo/documents/trashed') ?? '[]') as {
      path: string
      at: number
    }[]
    expect(listed.map((entry) => entry.path)).toEqual([TRASHED])
    expect(Date.now() - (listed[0]?.at ?? 0)).toBeLessThan(docs.TRASH_RETENTION_MS)
  })

  it('round-trips a name ending in " (2)"', async () => {
    const docs = await load()
    const uri = 'file:///data/user/0/jojo/files/abc/1-CV%20(2).pdf'
    const path = '/data/user/0/jojo/files/abc/1-CV (2).pdf'
    disk.set(path, 'cv two')
    await docs.trashDocument(uri, false)
    expect(disk.has(path)).toBe(false)
    await docs.reconcileTrashedDocuments([uri], { sweep: false, hydrated: true })
    expect([...disk.entries()]).toEqual([[path, 'cv two']])
  })
})

describe("the toast's own Undo (coverage-3)", () => {
  it('moves the bytes back by itself when no reconcile ran first', async () => {
    const docs = await load()
    disk.set(PATH, 'cv')
    const restoreBytes = await docs.trashDocument(URI, false)
    await restoreBytes()
    expect([...disk.entries()]).toEqual([[PATH, 'cv']])
    expect(listed()).toEqual([])
  })

  it('keeps the entry when its move back fails, so a later reconcile still restores it', async () => {
    const docs = await load()
    disk.set(PATH, 'cv')
    const restoreBytes = await docs.trashDocument(URI, false)
    mvFails.count = 1
    await restoreBytes()
    expect([...disk.keys()]).toEqual([TRASHED])
    expect(listed()).toEqual([TRASHED])
    await docs.reconcileTrashedDocuments([URI], { sweep: false, hydrated: true })
    expect([...disk.entries()]).toEqual([[PATH, 'cv']])
    expect(listed()).toEqual([])
  })

  it("keeps reconcile's own entry when its restore fails with the original absent", async () => {
    const docs = await load()
    disk.set(PATH, 'cv')
    await docs.trashDocument(URI, false)
    mvFails.count = 1
    await docs.reconcileTrashedDocuments([URI], { sweep: false, hydrated: true })
    expect(listed()).toEqual([TRASHED])
    await docs.reconcileTrashedDocuments([URI], { sweep: false, hydrated: true })
    expect([...disk.entries()]).toEqual([[PATH, 'cv']])
  })
})

describe("only the app's own documents (security-2)", () => {
  const STORE = '/data/user/0/jojo/databases/RKStorage'

  it('never moves aside a vanished path outside the document directory', async () => {
    const docs = await load()
    disk.set(STORE, 'every record')
    // `vault.file.add {uri: <the store>}`, then `vault.file.update {uri: 'x'}`.
    const vanished = docs.vanishedDocuments([`file://${STORE}`], ['x'])
    expect(vanished).toEqual([STORE])
    await docs.reconcileTrashedDocuments(['x'], { sweep: false, hydrated: true, vanished })
    expect([...disk.entries()]).toEqual([[STORE, 'every record']])
    expect(listed()).toEqual([])
  })

  it("refuses a '..' that climbs out of it, and a trash or wipe of a foreign path", async () => {
    const docs = await load()
    const climbing = '/data/user/0/jojo/files/../databases/RKStorage'
    disk.set(climbing, 'every record')
    disk.set(STORE, 'every record')
    await docs.reconcileTrashedDocuments([], {
      sweep: false,
      hydrated: true,
      vanished: [climbing],
    })
    const restoreBytes = await docs.trashDocument(`file://${STORE}`, false)
    await restoreBytes()
    await docs.forgetDocuments([`file://${STORE}`, `file://${climbing}`])
    expect(disk.get(STORE)).toBe('every record')
    expect(disk.get(climbing)).toBe('every record')
    expect(listed()).toEqual([])
  })

  it('never purges a listed path outside it, whatever an older build wrote', async () => {
    kv.set('jojo/documents/trashed', JSON.stringify([{ path: STORE, at: 0 }]))
    disk.set(STORE, 'every record')
    const docs = await load()
    await docs.reconcileTrashedDocuments([], { sweep: true, hydrated: true, now: Date.now() })
    expect(disk.get(STORE)).toBe('every record')
  })
})
