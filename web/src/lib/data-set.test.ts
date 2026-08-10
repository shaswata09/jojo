/**
 * The first-run fork, checked against the DATABASE rather than against the app.
 *
 * Every assertion below that matters reads the object stores back through a
 * second driver, after the session that wrote them has been disposed. That is not
 * ceremony: the bug this file exists to catch is a clear that leaves the demo
 * records in IndexedDB while every list on screen is empty — the graph in memory
 * is the thing that was emptied, the write behind it is queued, partial, or was
 * never issued for a record type nobody remembered to name, and the store looks
 * fine until tomorrow's launch reads it back. Asserting on `repo.getSnapshot()`
 * cannot see any of that, because the snapshot is the half that is right.
 *
 * It sits in `src/lib` for the reason `kg-durability.test.ts` gives: this is
 * where the pieces are allowed to meet. `kg/repo` compiles with no DOM lib and
 * cannot name the IndexedDB driver, so the composition — and the test of it —
 * belongs to the app shell.
 */

import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { dayOf } from '@/kg/core/project'
import { createProjections } from '@/kg/react/projections'
import { boot, resetBoot } from '@/kg/repo/boot'
import { readMeta } from '@/kg/repo/meta'
import { createIdbDriver } from '@/kg/storage/idb-driver'
import { createToolRuntime } from '@/kg/tools/runtime'
import { applyDataSet, graphFor, metaFor } from '@/lib/data-set'

const NOW = '2026-10-12T12:00:00.000Z'
const LATER = '2026-10-13T09:30:00.000Z'

let sequence = 0
const nextName = () => `jojo-data-set-${(sequence += 1)}`

/** One tab: its own driver, its own connection, its own boot. */
async function openTab(name: string, now: string) {
  resetBoot()
  // `channel: null` because Node delivers BroadcastChannel messages between
  // contexts in the same process, so two "tabs" here would talk to each other
  // AND to every other test file running in parallel.
  const result = await boot({ now: () => now, driver: createIdbDriver({ name, channel: null }) })
  if (result.outcome === 'corrupt') throw new Error(`boot went corrupt: ${result.detail}`)
  if (result.outcome === 'unavailable') throw new Error(`boot went unavailable: ${result.detail}`)
  return result
}

/** What is actually on disk, read by a connection that wrote none of it. */
async function readBack(name: string) {
  const driver = createIdbDriver({ name, channel: null })
  const opened = await driver.open()
  if (!opened.ok) throw new Error(`could not reopen: ${opened.error.message}`)
  const rows = await driver.readAll()
  if (!rows.ok) throw new Error(`could not read back: ${rows.error.message}`)
  driver.close()
  return rows.value
}

describe('choosing a data set', () => {
  it('writes the demo fixtures and a meta row that remembers them', async () => {
    const name = nextName()

    const first = await openTab(name, NOW)
    expect(first.outcome).toBe('first-run')
    expect(first.session.meta.dataSet).toBe('demo')

    // Explore with demo data on a first run is a decision, not a write: boot
    // seeded the store in the same transaction as the meta row (D24), so there is
    // nothing left for the choice to do.
    await first.session.repo.flush()
    first.session.dispose()

    const rows = await readBack(name)
    expect(rows.nodes.length).toBeGreaterThan(0)
    const meta = readMeta(rows.meta)
    expect(meta).not.toBe('corrupt')
    expect(meta === null || meta === 'corrupt' ? null : meta.dataSet).toBe('demo')
  })

  it('leaves NOTHING in the database when the choice is empty', async () => {
    const name = nextName()

    const first = await openTab(name, NOW)
    const seeded = await readBack(name)
    expect(seeded.nodes.length).toBeGreaterThan(0)
    expect(seeded.edges.length).toBeGreaterThan(0)

    const applied = await applyDataSet(first.session.repo, 'empty', NOW)
    expect(applied.ok).toBe(true)
    first.session.dispose()

    // The whole point of the file. Not "the app shows no applications" — no rows,
    // in any store, including the keywords the fixtures authored and the journal
    // rows describing writes against records that no longer exist.
    const wiped = await readBack(name)
    expect(wiped.nodes).toEqual([])
    expect(wiped.edges).toEqual([])
    expect(wiped.ops).toEqual([])

    const meta = readMeta(wiped.meta)
    if (meta === null || meta === 'corrupt') throw new Error('the meta row did not survive')
    expect(meta.dataSet).toBe('empty')
    // The field that would talk the next boot into reseeding. `null` is what says
    // this store was never seeded and must not be.
    expect(meta.seededAt).toBeNull()
  })

  it('stays empty across a reload — D24, from the side that bites', async () => {
    const name = nextName()

    const first = await openTab(name, NOW)
    await applyDataSet(first.session.repo, 'empty', NOW)
    first.session.dispose()

    const second = await openTab(name, LATER)
    // NOT 'first-run'. An emptiness test in place of the meta row would reseed
    // the fixtures here, on every reload, for the rest of this store's life.
    expect(second.outcome).toBe('ready')
    expect(second.session.meta.dataSet).toBe('empty')
    expect([...second.session.repo.getSnapshot().nodes()]).toEqual([])

    const rows = await readBack(name)
    expect(rows.nodes).toEqual([])
    second.session.dispose()
  })

  it('loads the demo data back into an emptied store', async () => {
    const name = nextName()

    const first = await openTab(name, NOW)
    await applyDataSet(first.session.repo, 'empty', NOW)
    const reloaded = await applyDataSet(first.session.repo, 'demo', LATER)
    expect(reloaded.ok).toBe(true)
    first.session.dispose()

    const rows = await readBack(name)
    expect(rows.nodes.length).toBeGreaterThan(0)
    const meta = readMeta(rows.meta)
    if (meta === null || meta === 'corrupt') throw new Error('the meta row did not survive')
    expect(meta.dataSet).toBe('demo')
    expect(meta.seededAt).toBe(LATER)

    const second = await openTab(name, LATER)
    expect(second.outcome).toBe('ready')
    expect(second.session.repo.getSnapshot().ofType('application').length).toBeGreaterThan(0)
    second.session.dispose()
  })

  it('replaces a store the user has written to, records and keywords alike', async () => {
    const name = nextName()

    const first = await openTab(name, NOW)
    const runtime = createToolRuntime({ repo: first.session.repo, now: () => NOW })
    const mine = runtime.run('keyword.create', { name: 'Referral' })
    if (!mine.ok) throw new Error('the keyword should have been created')
    expect(first.session.meta.dataSet).toBe('user')

    await applyDataSet(first.session.repo, 'empty', LATER)
    first.session.dispose()

    const rows = await readBack(name)
    expect(rows.nodes).toEqual([])
    // The queued ops from the write above described rows that were about to stop
    // existing. `replaceAll` flushes before it replaces for exactly this reason —
    // a drain landing afterwards writes a deleted record back into an emptied
    // store, and the wipe silently un-wipes itself one microtask later.
    const meta = readMeta(rows.meta)
    if (meta === null || meta === 'corrupt') throw new Error('the meta row did not survive')
    expect(meta.dataSet).toBe('empty')
  })
})

/**
 * The other half of the same bug, and the half this file used to be blind to.
 *
 * Everything above reads the DATABASE back, because the failure it was written
 * for is records surviving in IndexedDB while the screen is empty. The audit
 * found the mirror image and it is worse: the database was right every time, and
 * the SCREEN kept the records the user had just pressed a button to be rid of.
 *
 * Nothing here calls React. The projections are the last thing between a
 * snapshot and a card, they are pure functions of a `GraphSnapshot`, and they
 * are where the staleness lived — so they are what these assert on. A test that
 * read `repo.getSnapshot().ofType(…)` would have passed throughout, for the same
 * reason `useStoreAdmin().isEmpty` was correct on a page listing twelve
 * applications: the graph is the half that was right.
 *
 * The single read before the choice is not incidental — it IS the reproduction.
 * The app renders the dashboard and the board behind the first-run modal, which
 * caches those lists against version 0; a rebuilt snapshot came back at version 0
 * too, and `project.ts` reads an equal version as "same commit, same answer".
 * Delete that line and these tests pass against the broken code.
 */
describe('a choice reaches the screen, not only the database', () => {
  it('empties every list on a tab that has committed nothing since boot', async () => {
    const name = nextName()
    const first = await openTab(name, NOW)
    const repo = first.session.repo
    const projections = createProjections(dayOf(NOW))

    expect(projections.applications(repo.getSnapshot()).length).toBeGreaterThan(0)

    const applied = await applyDataSet(repo, 'empty', LATER)
    expect(applied.ok).toBe(true)

    expect(projections.applications(repo.getSnapshot())).toEqual([])
    expect(projections.timeline(repo.getSnapshot())).toEqual([])
    expect(projections.keywords(repo.getSnapshot())).toEqual([])
    expect(projections.snippets(repo.getSnapshot())).toEqual([])
    first.session.dispose()
  })

  it('draws the demo data onto a screen that was showing the empty state', async () => {
    const name = nextName()
    const first = await openTab(name, NOW)
    const repo = first.session.repo
    const projections = createProjections(dayOf(NOW))

    await applyDataSet(repo, 'empty', NOW)
    expect(projections.applications(repo.getSnapshot())).toEqual([])

    await applyDataSet(repo, 'demo', LATER)
    expect(projections.applications(repo.getSnapshot()).length).toBeGreaterThan(0)
    first.session.dispose()
  })

  /**
   * D23's remote-change path, which is the common case rather than the exotic
   * one: a second tab that has not itself written anything is the normal state
   * of a second tab, and that is exactly the tab whose lists never moved.
   *
   * `rehydrate` is called directly rather than through a BroadcastChannel — the
   * delivery is `channel.ts`'s to test, and Node routes those messages between
   * every file running in parallel anyway (see `openTab`).
   */
  it('renders rows another tab wrote', async () => {
    const name = nextName()
    const first = await openTab(name, NOW)
    const repo = first.session.repo
    const projections = createProjections(dayOf(NOW))

    await applyDataSet(repo, 'empty', NOW)
    expect(projections.applications(repo.getSnapshot())).toEqual([])

    repo.rehydrate(graphFor('demo', LATER), metaFor(repo.meta, 'demo', LATER))
    expect(projections.applications(repo.getSnapshot()).length).toBeGreaterThan(0)
    first.session.dispose()
  })

  it('publishes a version no projection has seen, on both swap paths', async () => {
    const name = nextName()
    const first = await openTab(name, NOW)
    const repo = first.session.repo

    const seeded = repo.getSnapshot().version
    await applyDataSet(repo, 'empty', LATER)
    const replaced = repo.getSnapshot().version
    expect(replaced).toBeGreaterThan(seeded)

    repo.rehydrate(graphFor('demo', LATER), metaFor(repo.meta, 'demo', LATER))
    expect(repo.getSnapshot().version).toBeGreaterThan(replaced)
    first.session.dispose()
  })
})

describe('the meta row a choice writes', () => {
  it('keeps the store its own age', () => {
    const current = {
      schemaVersion: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastOpenedAt: NOW,
      dataSet: 'user' as const,
      seededAt: NOW,
    }

    const next = metaFor(current, 'empty', LATER)
    // Choosing a data set is not creating a store. Diagnostics reads `createdAt`
    // as "since when has jojo held my records"; minting a fresh one here would
    // make it mean "when did you last press a button in Settings".
    expect(next.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(next.schemaVersion).toBe(3)
    expect(next.lastOpenedAt).toBe(LATER)
    expect(next.seededAt).toBeNull()
    expect(metaFor(current, 'demo', LATER).seededAt).toBe(LATER)
  })

  it('compiles an empty choice to no rows at all', () => {
    expect(graphFor('empty', NOW)).toEqual({ nodes: [], edges: [] })
    expect(graphFor('demo', NOW).nodes.length).toBeGreaterThan(0)
  })
})
