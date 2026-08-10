/**
 * Boot, and the decisions that are only wrong once.
 *
 * D24 is the one to read first: first run is the ABSENCE of the meta row, never
 * "the node store is empty". Get it backwards and Settings → Records → Empty
 * reseeds the demo fixtures on every reload, which makes the button impossible
 * to use and buries whatever the user typed in between. There is a test for it
 * below and it is the reason this file exists.
 *
 * Against `MemoryDriver` rather than IndexedDB, deliberately. The question here
 * is what boot DECIDES — reseed or not, corrupt or not, prune or not — and the
 * memory driver is a faithful stand-in for a store: it clones every row in and
 * out and returns them in ascending key order, exactly as `getAll` does. The
 * question of whether IndexedDB itself keeps them is `storage/idb-driver.test.ts`,
 * and the two of them meeting is `src/lib/kg-durability.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import { createMemoryDriver } from '../storage/memory-driver'
import type { MemoryDriver } from '../storage/memory-driver'
import type { Rows } from '../storage/driver'
import type { MetaRow, StoredRow } from '../storage/schema'
import { boot, resetBoot } from './boot'
import type { BootResult, DurableBootOptions, Session } from './boot'
import { AUDIT_CAP } from './journal'

const NOW = '2026-10-12T12:00:00.000Z'
const LATER = '2026-10-13T09:30:00.000Z'

const at = (instant: string) => () => instant

/** Every test boots from scratch; the module keeps its promise for the process. */
async function bootWith(driver: MemoryDriver, options: Omit<DurableBootOptions, 'driver'>) {
  resetBoot()
  return boot({ ...options, driver })
}

const sessionOf = (result: BootResult): Session => {
  if (result.outcome === 'corrupt') throw new Error(`unexpected corrupt boot: ${result.detail}`)
  return result.session
}

/**
 * Every node and every edge, order-independent.
 *
 * Sorted because `nodes()` returns index order, which is insertion order, and
 * insertion order legitimately differs between a graph compiled from the seed
 * (application, then its employer, then the next) and one read back off disk
 * (every `app:` key, then every `org:` key). Asserting on it would be asserting
 * that a store returns rows in the order they were written, which no store
 * promises and this one deliberately does not.
 */
const graphOf = (session: Session) => {
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1)
  const m = session.repo.getSnapshot()
  return { nodes: [...m.nodes()].sort(byId), edges: [...m.edges()].sort(byId) }
}

const readRows = async (driver: MemoryDriver): Promise<Rows> => {
  const read = await driver.readAll()
  if (!read.ok) throw new Error('the memory driver failed to read')
  return read.value
}

const metaRowIn = (rows: Rows): Record<string, unknown> => {
  const row = rows.meta.find((r) => r.key === 'store')
  if (!row || typeof row.value !== 'object' || row.value === null) {
    throw new Error('no readable meta row')
  }
  return row.value as Record<string, unknown>
}

/* -------------------------------- first run ------------------------------- */

describe('the first run', () => {
  it('seeds the demo fixtures and writes the meta row with them', async () => {
    const driver = createMemoryDriver()
    const result = await bootWith(driver, { now: at(NOW) })

    expect(result.outcome).toBe('first-run')
    const session = sessionOf(result)
    expect(session.durable).toBe(true)
    expect(session.problems).toEqual([])
    expect(session.repo.getSnapshot().ofType('application').length).toBeGreaterThan(0)

    const rows = await readRows(driver)
    expect(rows.nodes.length).toBe(session.repo.getSnapshot().nodes().length)
    expect(metaRowIn(rows)).toMatchObject({ dataSet: 'demo', seededAt: NOW, createdAt: NOW })

    session.dispose()
  })

  it('starts empty when asked to, and records that the user asked', async () => {
    const driver = createMemoryDriver()
    const session = sessionOf(await bootWith(driver, { now: at(NOW), dataSet: 'empty' }))

    expect(session.repo.getSnapshot().nodes()).toEqual([])
    const rows = await readRows(driver)
    // `seededAt: null` is what carries "the user chose this" across the reload.
    // A store that claimed to have been seeded is a store boot would offer to
    // reseed.
    expect(metaRowIn(rows)).toMatchObject({ dataSet: 'empty', seededAt: null })

    session.dispose()
  })
})

/* ------------------------------- reopening -------------------------------- */

describe('reopening', () => {
  it('hands back the same graph, node for node and edge for edge', async () => {
    const first = createMemoryDriver()
    const one = sessionOf(await bootWith(first, { now: at(NOW) }))
    const before = graphOf(one)
    const carried = await readRows(first)
    one.dispose()

    const second = createMemoryDriver({ rows: carried })
    const result = await bootWith(second, { now: at(LATER) })

    expect(result.outcome).toBe('ready')
    const two = sessionOf(result)
    expect(graphOf(two)).toEqual(before)
    expect(two.skipped).toEqual([])

    // `nodes()` is compared sorted above because its order is an implementation
    // detail of the index; `ofType` is not — "id-ascending = creation order" is
    // what every list in the app renders in, so it is checked as written.
    const applications = (session: Session) =>
      session.repo
        .getSnapshot()
        .ofType('application')
        .map((a) => a.id)
    expect(applications(two)).toEqual(applications(one))

    two.dispose()
  })

  it('does NOT reseed a store the user emptied — D24, and the reason it exists', async () => {
    const first = createMemoryDriver()
    const one = sessionOf(await bootWith(first, { now: at(NOW), dataSet: 'empty' }))
    const carried = await readRows(first)
    one.dispose()

    // Zero nodes and a meta row. "The node store is empty" would say first run
    // here and load 91 demo records over the user's deliberate choice, on every
    // single reload.
    expect(carried.nodes).toEqual([])
    expect(carried.meta).toHaveLength(1)

    const second = createMemoryDriver({ rows: carried })
    const result = await bootWith(second, { now: at(LATER) })

    expect(result.outcome).toBe('ready')
    const two = sessionOf(result)
    expect(two.repo.getSnapshot().nodes()).toEqual([])
    expect(two.meta.dataSet).toBe('empty')
    two.dispose()
  })

  it('stamps lastOpenedAt without touching createdAt or seededAt', async () => {
    const first = createMemoryDriver()
    const one = sessionOf(await bootWith(first, { now: at(NOW) }))
    const carried = await readRows(first)
    one.dispose()

    const second = createMemoryDriver({ rows: carried })
    const two = sessionOf(await bootWith(second, { now: at(LATER) }))

    expect(metaRowIn(await readRows(second))).toMatchObject({
      createdAt: NOW,
      seededAt: NOW,
      lastOpenedAt: LATER,
    })
    two.dispose()
  })
})

/* -------------------------------- the audit ------------------------------- */

describe('the audit log', () => {
  const journalRow = (index: number): StoredRow => ({
    id: `entry-${String(index).padStart(4, '0')}`,
    at: `2026-10-${String((index % 28) + 1).padStart(2, '0')}T0${index % 10}:00:00.000Z`,
    tool: 'application.note.set',
    input: {},
    label: `Change ${index}`,
    calls: [],
    nodes: [],
    edges: [],
  })

  it('prunes to the cap on open and renumbers what is left', async () => {
    const meta: MetaRow = {
      key: 'store',
      value: {
        schemaVersion: 1,
        createdAt: NOW,
        lastOpenedAt: NOW,
        dataSet: 'user',
        seededAt: NOW,
      },
    }
    const overflowing = Array.from({ length: AUDIT_CAP + 50 }, (_, i) => journalRow(i))
    const driver = createMemoryDriver({
      rows: { nodes: [], edges: [], meta: [meta], ops: overflowing },
    })

    const session = sessionOf(await bootWith(driver, { now: at(LATER) }))
    expect(session.repo.audit).toHaveLength(AUDIT_CAP)

    // Written back, not merely trimmed in memory: an unpruned `ops` store grows
    // without bound, and every boot after this one would re-read the rows it
    // had already decided to drop.
    const rows = await readRows(driver)
    expect(rows.ops).toHaveLength(AUDIT_CAP)

    // The sequence continues from the pruned count rather than the original, so
    // the next commit appends rather than overwriting entry 201.
    session.repo.commit({
      tool: 't',
      input: {},
      label: 'after the prune',
      calls: [],
      nodes: [],
      edges: [],
    })
    await session.repo.flush()
    expect((await readRows(driver)).ops).toHaveLength(AUDIT_CAP + 1)

    session.dispose()
  })

  it('drops an unreadable journal row without failing the boot', async () => {
    const meta: MetaRow = {
      key: 'store',
      value: {
        schemaVersion: 1,
        createdAt: NOW,
        lastOpenedAt: NOW,
        dataSet: 'user',
        seededAt: NOW,
      },
    }
    const driver = createMemoryDriver({
      rows: {
        nodes: [],
        edges: [],
        meta: [meta],
        ops: [journalRow(1), { id: 'broken' }, journalRow(2)],
      },
    })

    const session = sessionOf(await bootWith(driver, { now: at(LATER) }))
    // A lost audit note is a lost note about a change, not a lost change — so it
    // is dropped rather than escalated to the corrupt path, which would hide the
    // user's records behind a recovery panel over a broken log entry.
    expect(session.repo.audit).toHaveLength(2)
    session.dispose()
  })
})

/* --------------------------------- failure -------------------------------- */

describe('when the store cannot be trusted', () => {
  it('never reseeds over a meta row it cannot read', async () => {
    const driver = createMemoryDriver({
      rows: {
        nodes: [{ id: 'app:1', type: 'application', props: {}, createdAt: NOW, updatedAt: NOW }],
        meta: [{ key: 'store', value: 'this is not a meta row' }],
      },
    })

    const result = await bootWith(driver, { now: at(NOW) })

    expect(result.outcome).toBe('corrupt')
    if (result.outcome === 'corrupt') {
      // The rows come back so the recovery panel can offer *Download what we
      // could read* before anything else.
      expect(result.rescued?.nodes).toHaveLength(1)
    }

    // And nothing was written. Reseeding to make the app look healthy is the
    // single worst outcome available on this path: it turns a recoverable
    // problem into a permanent one while looking like a successful boot.
    expect(driver.counts().nodes).toBe(1)
  })

  it('falls back to an in-memory session when the store will not open', async () => {
    const driver = createMemoryDriver({
      fault: (call) =>
        call === 'open' ? { code: 'storage/unavailable', message: 'private browsing' } : null,
    })

    const result = await bootWith(driver, { now: at(NOW) })

    expect(result.outcome).toBe('unavailable')
    if (result.outcome !== 'unavailable') return
    expect(result.reason).toBe('unsupported')
    // The app still runs. It just cannot promise anything, and `durable: false`
    // is how the banner knows to say so.
    expect(result.session.durable).toBe(false)
    expect(result.session.repo.getSnapshot().ofType('application').length).toBeGreaterThan(0)
    result.session.dispose()
  })

  it('reports a blocked open as blocked, not as unsupported', async () => {
    const driver = createMemoryDriver({
      fault: (call) =>
        call === 'open' ? { code: 'storage/blocked', message: 'an older tab holds it' } : null,
    })
    const result = await bootWith(driver, { now: at(NOW) })
    expect(result.outcome === 'unavailable' && result.reason).toBe('blocked')
    if (result.outcome === 'unavailable') result.session.dispose()
  })
})

/* -------------------------------- cross-tab ------------------------------- */

describe('another tab', () => {
  it('adopts a remote change and clears the undo stack', async () => {
    const first = createMemoryDriver()
    const one = sessionOf(await bootWith(first, { now: at(NOW) }))
    const carried = await readRows(first)
    one.dispose()

    let told = 0
    const driver = createMemoryDriver({ rows: carried })
    const session = sessionOf(
      await bootWith(driver, { now: at(LATER), onRemoteChange: () => (told += 1) }),
    )

    const [mine, theirs] = session.repo.getSnapshot().ofType('application')
    if (!mine || !theirs) throw new Error('the demo store should have applications')

    session.repo.commit({
      tool: 'application.note.set',
      input: {},
      label: 'A local edit',
      calls: [],
      nodes: [
        { id: mine.id, before: mine, after: { ...mine, props: { ...mine.props, note: 'mine' } } },
      ],
      edges: [],
    })
    expect(session.repo.undoable).toHaveLength(1)
    await session.repo.flush()

    // The other tab deletes a different record and announces it.
    await driver.commit([{ kind: 'delete', store: 'nodes', key: theirs.id }])
    driver.emitRemoteCommit({ kind: 'commit', at: LATER, entryId: 'theirs' })
    await new Promise<void>((resolve) => setTimeout(resolve, 80))

    expect(told).toBe(1)
    expect(session.repo.getSnapshot().node(theirs.id)).toBeUndefined()
    // Our own edit survived, because the flush happens BEFORE the rehydrate.
    // The other way round, our queued rows would drain over their fresh ones and
    // the other tab's change would appear to undo itself a moment after landing.
    expect(session.repo.getSnapshot().node(mine.id, 'application')?.props.note).toBe('mine')
    // Every before-image in the stack was captured against a record that tab may
    // since have changed, so keeping it would offer to restore a version of the
    // store that has never existed.
    expect(session.repo.undoable).toEqual([])

    session.dispose()
  })

  it('tells the app when it has been closed for another tab to upgrade', async () => {
    const driver = createMemoryDriver()
    let told = 0
    const session = sessionOf(
      await bootWith(driver, { now: at(NOW), onBlocking: () => (told += 1) }),
    )
    driver.emitBlocking()
    expect(told).toBe(1)
    session.dispose()
  })
})
