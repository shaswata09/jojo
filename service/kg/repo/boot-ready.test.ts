/**
 * What boot does about link rows whose ends are gone.
 *
 * The other half of A3, and the half that is easy to forget: fixing journal
 * replay (`withDisplacedEdges` in `repository.ts`) stops NEW dangling rows, and
 * does nothing at all for the stores that already have one. Those stores show
 * "1 record on this device could not be read and is not being shown" on every
 * single launch, forever, with no code path anywhere that could clear it — the
 * row fails `validateRows`, is counted, and is left exactly where it was.
 *
 * The line these draw is between an edge whose end is MISSING and an edge whose
 * end is UNREADABLE, because `validateRows` reports both with the same sentence
 * and only one of them is safe to delete. Sitting next to `boot.test.ts` rather
 * than inside it: this is one decision with one seam, and the file next door is
 * about the first-run fork.
 */

import { describe, expect, it } from 'vitest'
import { createMemoryDriver } from '../storage/memory-driver'
import type { MemoryDriver } from '../storage/memory-driver'
import type { DurableOp, Rows } from '../storage/driver'
import type { MetaRow, StoredRow } from '../storage/schema'
import { boot, resetBoot } from './boot'
import type { BootResult, Session } from './boot'
import { orphanEdgeKeys } from './boot-ready'
import { REVERTABLE_DEPTH } from './journal'

const NOW = '2026-10-12T12:00:00.000Z'
const LATER = '2026-10-13T09:30:00.000Z'

const STORED_META: MetaRow = {
  key: 'store',
  value: {
    schemaVersion: 1,
    createdAt: NOW,
    lastOpenedAt: NOW,
    dataSet: 'user',
    seededAt: NOW,
  },
}

/** Real ids, because `validateNode` checks the uuid: a `kw:k1` is not a jojo id. */
const UUID = (n: number) => `0192f4c1-7b3e-7a41-9c1a-00000000000${n}`
const KW = `kw:${UUID(1)}`
const RICE = `app:${UUID(2)}`
const GONE = `app:${UUID(3)}`
const BROKEN = `app:${UUID(4)}`

const keywordRow = (slug: string): StoredRow => ({
  id: KW,
  type: 'keyword',
  props: { slug, name: slug, tone: 'teal' },
  createdAt: NOW,
  updatedAt: NOW,
})

const applicationRow = (slug: string): StoredRow => ({
  id: RICE,
  type: 'application',
  props: {
    slug,
    role: 'Statistics',
    note: '',
    roleTag: 'Assistant Professor',
    stage: 'draft',
    lastAction: 'Draft created',
    lastActionAt: NOW,
  },
  createdAt: NOW,
  updatedAt: NOW,
})

const tagsRow = (from: string, to: string): StoredRow => ({
  id: `${from}|TAGS|${to}`,
  rel: 'TAGS',
  from,
  to,
  props: {},
  createdAt: NOW,
})

const sessionOf = (result: BootResult): Session => {
  if (result.outcome === 'corrupt') throw new Error(`unexpected corrupt boot: ${result.detail}`)
  return result.session
}

async function bootWith(driver: MemoryDriver) {
  resetBoot()
  return boot({ driver, now: () => LATER })
}

const readRows = async (driver: MemoryDriver): Promise<Rows> => {
  const read = await driver.readAll()
  if (!read.ok) throw new Error('the memory driver failed to read')
  return read.value
}

describe('orphanEdgeKeys', () => {
  it('names an edge whose end has no row in the store', () => {
    const rows: Rows = {
      nodes: [keywordRow('k1')],
      edges: [tagsRow(KW, GONE)],
      meta: [],
      ops: [],
    }

    expect(orphanEdgeKeys(rows)).toEqual([`${KW}|TAGS|${GONE}`])
  })

  /**
   * The distinction the whole pass turns on.
   *
   * A node row that today's schema rejects is still the user's record: a
   * fix-forward migration can bring it back, and it comes back with its links
   * only if the links are still there. `validateRows` says "Joins a record that
   * is not there" about this edge too, which is why the decision is made HERE,
   * against the raw rows, rather than by reading its diagnostics.
   */
  it('leaves an edge whose end is present but unreadable', () => {
    const rows: Rows = {
      nodes: [keywordRow('k1'), { id: BROKEN, type: 'application', props: {} }],
      edges: [tagsRow(KW, BROKEN)],
      meta: [],
      ops: [],
    }

    expect(orphanEdgeKeys(rows)).toEqual([])
  })

  // A row too broken to name its own ends is corrupt rather than orphaned, and
  // corrupt data is the user's to be told about, not ours to delete.
  it('leaves a row that cannot say what it joins', () => {
    const rows: Rows = {
      nodes: [],
      edges: [{ id: `${KW}|TAGS|${RICE}` }, { from: KW, to: RICE }],
      meta: [],
      ops: [],
    }

    expect(orphanEdgeKeys(rows)).toEqual([])
  })
})

describe('booting a store that has a dangling link row', () => {
  it('deletes the row and stops counting it as a record that could not be read', async () => {
    const driver = createMemoryDriver({
      rows: {
        nodes: [keywordRow('k1')],
        // Exactly what an undo of a create used to leave behind: the tag row
        // survived, the application it tagged did not.
        edges: [tagsRow(KW, GONE)],
        meta: [STORED_META],
        ops: [],
      },
    })

    const session = sessionOf(await bootWith(driver))

    // The banner's number. It used to be 1 here on every launch of this store,
    // with nothing the user could do about it.
    expect(session.skipped).toEqual([])
    expect(driver.counts().edges).toBe(0)
    expect((await readRows(driver)).edges).toEqual([])
    session.dispose()
  })

  it('leaves the records themselves alone', async () => {
    const driver = createMemoryDriver({
      rows: {
        nodes: [keywordRow('k1'), applicationRow('rice')],
        edges: [tagsRow(KW, RICE), tagsRow(KW, GONE)],
        meta: [STORED_META],
        ops: [],
      },
    })

    const session = sessionOf(await bootWith(driver))

    expect(session.skipped).toEqual([])
    expect((await readRows(driver)).edges.map((row) => row['id'])).toEqual([`${KW}|TAGS|${RICE}`])
    expect(session.repo.getSnapshot().out(KW, 'TAGS')).toHaveLength(1)
    session.dispose()
  })

  /**
   * The counterpart, and the reason this is not just "delete what validation
   * rejected".
   *
   * The application row is present and unreadable. Its tag is kept, both rows
   * stay on disk, and the user is told — which is R-1(d): a rejection is
   * counted and logged, never dropped quietly.
   */
  it('keeps a link to a record it could not read, and still reports it', async () => {
    const driver = createMemoryDriver({
      rows: {
        nodes: [keywordRow('k1'), { ...applicationRow('rice'), props: { slug: 'rice' } }],
        edges: [tagsRow(KW, RICE)],
        meta: [STORED_META],
        ops: [],
      },
    })

    const session = sessionOf(await bootWith(driver))

    expect(session.skipped.length).toBeGreaterThan(0)
    expect(driver.counts().edges).toBe(1)
    session.dispose()
  })
})

/* ------------------------- the prune, on the SECOND open ------------------- */

describe('re-opening a store whose audit was pruned on an earlier launch', () => {
  const journalRow = (index: number): StoredRow => ({
    id: `entry-${String(index).padStart(4, '0')}`,
    at: `2026-10-12T09:${String(index).padStart(2, '0')}:00.000Z`,
    tool: 'application.note.set',
    input: { note: 'the whole argument object, which is the big half' },
    label: `Change ${index}`,
    calls: [],
    nodes: [],
    edges: [],
  })

  /** The driver, with every op it is asked to commit recorded on the way past. */
  const watching = (driver: MemoryDriver, seen: DurableOp[]): MemoryDriver => ({
    ...driver,
    commit: async (ops) => {
      seen.push(...ops)
      return driver.commit(ops)
    },
  })

  /**
   * The prune has to be able to see that it already ran.
   *
   * `trimJournal` returns an entry it has already trimmed BY IDENTITY, and that
   * identity is the whole of the decision at `boot-ready.ts` — comparing
   * lengths would not work, because a trim changes no counts. The mark that
   * makes the short-circuit possible is `trimmed`, and it has to survive the
   * disk: while `readJournalRows` dropped it, every launch rebuilt every old
   * entry, cleared the `ops` store and wrote all of it back byte-identical,
   * logging 'pruned the audit log from 200 to 200 entries' every time. On the
   * phone that is not a log line, it is the entire store rewritten — `rn-driver`
   * holds all four stores in one AsyncStorage key.
   */
  it('does not clear and rewrite the ops store when the trim has nothing to do', async () => {
    const driver = createMemoryDriver({
      rows: {
        nodes: [],
        edges: [],
        meta: [STORED_META],
        // Five past the revertable window, so the first launch owes a real trim
        // and the second owes none.
        ops: Array.from({ length: REVERTABLE_DEPTH + 5 }, (_, i) => journalRow(i)),
      },
    })

    const first = sessionOf(await bootWith(driver))
    await first.repo.flush()

    // What the first launch left: the five oldest stripped and MARKED, the
    // revertable ten untouched.
    const pruned = (await readRows(driver)).ops
    expect(pruned[0]?.['trimmed']).toBe(true)
    expect(pruned[0]?.['input']).toBeNull()
    expect(pruned.at(-1)?.['trimmed']).toBeUndefined()

    const seen: DurableOp[] = []
    const second = sessionOf(await bootWith(watching(driver, seen)))

    // `lastOpenedAt` and nothing else. Before the fix this was a `clear` on
    // `ops` followed by fifteen puts, on this launch and on every one after it.
    expect(seen.map((op) => `${op.kind} ${op.store}`)).toEqual(['put meta'])
    // And the mark is still there to be read on the launch after this one.
    expect(second.repo.audit.at(-1)?.trimmed).toBe(true)

    second.dispose()
    first.dispose()
  })
})
