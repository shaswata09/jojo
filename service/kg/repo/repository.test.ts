/**
 * The repository: one commit, one journal row, one Undo — and the durable ops
 * that fall out of the same delta.
 *
 * The driver here is the in-memory one, which is the point of Wave 1: the whole
 * of the state layer is reviewable and testable before a line of IndexedDB
 * exists, and the swap in Wave 2 changes the driver and nothing else.
 */

import { describe, expect, it } from 'vitest'
import type { Instant, StoredEdge, StoredNode } from '../core/model'
import { MutableSnapshot } from '../core/snapshot'
import type { Driver, DurableOp, StoreEvent } from '../storage/driver'
import { createMemoryDriver } from '../storage/memory-driver'
import type { JournalDraft } from './journal'
import { freshMeta } from './meta'
import { createRepository, onRemoteCommit } from './repository'
import type { PersistenceHealth } from './queue'
import type { Repository } from './repository'

const AT: Instant = '2026-10-12T09:00:00.000Z'

const application = (slug: string, note = ''): StoredNode => ({
  id: `app:${slug}`,
  type: 'application',
  props: {
    slug,
    role: 'Statistics',
    note,
    roleTag: 'Assistant Professor',
    stage: 'draft',
    lastAction: 'Draft created',
    lastActionAt: AT,
  },
  createdAt: AT,
  updatedAt: AT,
})

const reminder = (slug: string): StoredNode => ({
  id: `item:${slug}`,
  type: 'timelineItem',
  props: { slug, title: slug, date: '2026-11-01', kind: 'deadline', urgency: 'red', remind: true },
  createdAt: AT,
  updatedAt: AT,
})

const about = (from: string, to: string): StoredEdge => ({
  id: `${from}|ABOUT|${to}`,
  rel: 'ABOUT',
  from,
  to,
  props: {},
  createdAt: AT,
})

const draft = (parts: Partial<JournalDraft>): JournalDraft => ({
  tool: 'application.create',
  input: {},
  label: 'Rice added',
  calls: [],
  nodes: [],
  edges: [],
  ...parts,
})

function setup(nodes: StoredNode[] = [], edges: StoredEdge[] = []) {
  const driver = createMemoryDriver()
  let tick = 0
  const repo = createRepository({
    driver,
    snapshot: MutableSnapshot.from(nodes, edges),
    meta: freshMeta(AT, 'demo'),
    // Injected, never read off the wall clock. D26 is about more than TODAY:
    // a default clock is a clock nobody passes.
    now: () => {
      tick += 1
      return `2026-10-12T09:00:0${tick}.000Z`
    },
  })
  return { driver, repo }
}

const created = (node: StoredNode) => draft({ nodes: [{ id: node.id, before: null, after: node }] })

const tags = (keyword: string, application: string): StoredEdge => ({
  id: `${keyword}|TAGS|${application}`,
  rel: 'TAGS',
  from: keyword,
  to: application,
  props: {},
  createdAt: AT,
})

const keyword = (slug: string): StoredNode => ({
  id: `kw:${slug}`,
  type: 'keyword',
  props: { slug, name: slug, tone: 'teal' },
  createdAt: AT,
  updatedAt: AT,
})

/**
 * A driver that keeps every op it was handed, so the OPS can be asserted on.
 *
 * `createMemoryDriver` allocates the `ops` key itself when it is handed `null` —
 * which is the behaviour under test one layer down, and exactly what makes it
 * blind here: a repository that passed its own key would be served just as
 * happily, and the store would look right. Nothing in the suite inspected what
 * `opsFor` emits until this existed; see `describe('the journal row's key')`.
 */
function recordingDriver() {
  const inner = createMemoryDriver()
  const batches: DurableOp[][] = []
  const driver: Driver = {
    ...inner,
    commit: (ops) => {
      batches.push([...ops])
      return inner.commit(ops)
    },
  }
  return { driver, batches }
}

describe('commit', () => {
  /**
   * `stack: false` — the write the SYSTEM finished, not one the user performed.
   *
   * The only case today is attaching a file's bytes once they land on disk,
   * seconds after the drop. Without this, ⌘Z after dropping a CV reverts the
   * attach and silently unlinks bytes the user just watched arrive, and an
   * attach arriving while they are considering a redo destroys it.
   *
   * Journalled and audited either way: the audit log's job is to record
   * everything that touched the store, and a background write is exactly the
   * kind a user later wants an account of. Only the undo ring is withheld.
   */
  describe('stack: false', () => {
    it('journals and audits without taking the top of the undo stack', () => {
      const { repo } = setup()
      const rice = application('rice')
      repo.commit(created(rice))
      expect(repo.undoable).toHaveLength(1)

      const attached = repo.commit(
        draft({
          nodes: [{ id: rice.id, before: rice, after: application('rice', 'attached') }],
        }),
        { stack: false },
      )

      // Still on screen, still in the audit, still a durable write.
      expect(repo.getSnapshot().node('app:rice', 'application')?.props.note).toBe('attached')
      expect(repo.audit.some((e) => e.id === attached.id)).toBe(true)
      // But the user's undo is still the thing the user did.
      expect(repo.undoable).toHaveLength(1)
      expect(repo.undoable[0]?.id).not.toBe(attached.id)
    })

    it('leaves redo alone, so a background write cannot eat it', () => {
      const { repo } = setup()
      const rice = application('rice')
      const create = repo.commit(created(rice))
      repo.revert(create.id)
      expect(repo.redoable).toHaveLength(1)

      repo.commit(created(application('other')), { stack: false })

      expect(repo.redoable).toHaveLength(1)
    })

    it('still enqueues the durable ops', async () => {
      const { repo, driver } = setup()
      repo.commit(created(application('rice')), { stack: false })
      await repo.flush()
      expect(driver.counts().nodes).toBe(1)
      // One journal row, as every commit writes.
      expect(driver.counts().ops).toBe(1)
    })

    it('defaults to stacking, so nothing else changes', () => {
      const { repo } = setup()
      repo.commit(created(application('rice')))
      expect(repo.undoable).toHaveLength(1)
    })
  })

  it('applies the after-images and hands back a stamped entry', () => {
    const { repo } = setup()
    const rice = application('rice')

    const entry = repo.commit(created(rice))

    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(entry.at).toBe('2026-10-12T09:00:01.000Z')
    expect(repo.getSnapshot().node('app:rice')).toEqual(rice)
  })

  /**
   * A commit has to change the snapshot's IDENTITY, not only its contents.
   *
   * `useSyncExternalStore(repo.subscribe, repo.getSnapshot)` compares the two
   * readings by reference and bails out of rendering when they match. The
   * snapshot underneath is mutated in place and never rebuilt, so returning it
   * as itself would hand back the same object forever and not one card in the
   * app would re-render — a total, silent failure with no error anywhere.
   */
  it('hands back a new snapshot reference, and a new version, on every commit', () => {
    const { repo } = setup()
    const before = repo.getSnapshot()

    repo.commit(created(application('rice')))
    const after = repo.getSnapshot()

    expect(after).not.toBe(before)
    expect(after.version).toBeGreaterThan(before.version)
    // And the same one while nothing changes, or every render re-projects.
    expect(repo.getSnapshot()).toBe(after)
  })

  it('notifies subscribers once per commit and stops on unsubscribe', () => {
    const { repo } = setup()
    let ticks = 0
    const off = repo.subscribe(() => {
      ticks += 1
    })

    repo.commit(created(application('rice')))
    expect(ticks).toBe(1)

    off()
    repo.commit(created(application('unt')))
    expect(ticks).toBe(1)
  })

  /**
   * D19: the delta log IS the durable op list.
   *
   * There is no `effectsOf(action, before, after)` anywhere, and this is why —
   * a mapper that re-derives what a write touched forgets things in exactly the
   * way the hand-written undo closures did.
   */
  it('writes one row per delta, plus the journal row, without being awaited', async () => {
    const { driver, repo } = setup()
    const rice = application('rice')
    const item = reminder('rice-deadline')

    repo.commit(
      draft({
        nodes: [
          { id: rice.id, before: null, after: rice },
          { id: item.id, before: null, after: item },
        ],
        edges: [{ id: about(item.id, rice.id).id, before: null, after: about(item.id, rice.id) }],
      }),
    )

    // Nothing has been awaited yet, and the snapshot already has the records.
    expect(repo.getSnapshot().node(rice.id)).toBeDefined()

    await repo.flush()
    expect(driver.counts()).toEqual({ nodes: 2, edges: 1, meta: 1, ops: 1 })
  })

  /**
   * Demo data stops being demo data the moment the user writes to it.
   *
   * Left at 'demo', Settings goes on offering to replace their records with the
   * fixtures and describes a store they have been working in all week as sample
   * data. The meta row goes down with the first write, not on a later pass.
   */
  it('promotes the store from demo to user on the first write', async () => {
    const { driver, repo } = setup()
    expect(repo.meta.dataSet).toBe('demo')

    repo.commit(created(application('rice')))
    await repo.flush()

    expect(repo.meta.dataSet).toBe('user')
    const rows = await driver.readAll()
    expect(rows.ok && rows.value.meta[0]?.value).toMatchObject({ dataSet: 'user' })
  })

  it('audits a no-op but does not let it take the top of the undo stack', () => {
    const { repo } = setup()
    repo.commit(created(application('rice')))
    repo.commit(draft({ label: 'Saved with no changes' }))

    expect(repo.audit.map((e) => e.label)).toEqual(['Saved with no changes', 'Rice added'])
    expect(repo.undoable.map((e) => e.label)).toEqual(['Rice added'])
  })

  /**
   * The same guard, against the shape every real save actually has.
   *
   * A tool cannot produce the entry above: `tx.patch` stamps `updatedAt` on
   * every call, so pressing Save on a form nobody edited stages a delta whose
   * two images differ by a timestamp and nothing else. Guarding on "has deltas"
   * therefore let every no-op save take the top of the undo stack, and the next
   * Ctrl+Z put a timestamp back instead of undoing the edit before it.
   */
  it('does not let a save that only restamped updatedAt eat the undo', () => {
    const rice = application('rice', 'statements missing')
    const { repo: seeded } = setup([rice])

    const real = seeded.commit(
      draft({
        label: 'Note edited',
        nodes: [{ id: rice.id, before: rice, after: application('rice', 'statements done') }],
      }),
    )
    const restamped = {
      ...application('rice', 'statements done'),
      updatedAt: '2026-10-12T10:00:00.000Z',
    }
    seeded.commit(
      draft({
        label: 'Saved with no changes',
        nodes: [{ id: rice.id, before: application('rice', 'statements done'), after: restamped }],
      }),
    )

    // Audited, because "you pressed save and nothing happened" is worth seeing.
    expect(seeded.audit.map((e) => e.label)).toEqual(['Saved with no changes', 'Note edited'])
    // But Undo still means the edit.
    expect(seeded.undoable.map((e) => e.id)).toEqual([real.id])
  })
})

describe('revert', () => {
  it('takes a create back and offers it as a redo', () => {
    const { repo } = setup()
    const entry = repo.commit(created(application('rice')))

    const undone = repo.revert(entry.id)

    expect(repo.getSnapshot().node('app:rice')).toBeUndefined()
    expect(repo.undoable).toEqual([])
    expect(repo.redoable.map((e) => e.id)).toEqual([undone.id])
  })

  // Redo is free because the revert of a revert is the original. If it needed a
  // second mechanism it would need a second set of bugs.
  it('redoes by reverting the revert', () => {
    const { repo } = setup()
    const rice = application('rice')
    const entry = repo.commit(created(rice))
    const undone = repo.revert(entry.id)

    const redone = repo.revert(undone.id)

    expect(repo.getSnapshot().node('app:rice')).toEqual(rice)
    expect(repo.redoable).toEqual([])
    expect(repo.undoable.map((e) => e.id)).toEqual([redone.id])
  })

  /**
   * A new write drops whatever was redoable.
   *
   * Anything on the redo stack described a future this write has just replaced,
   * and reapplying a before-image captured against records that no longer look
   * like that is the sort of undo that quietly loses work.
   */
  it('clears the redo stack on the next commit', () => {
    const { repo } = setup()
    const entry = repo.commit(created(application('rice')))
    repo.revert(entry.id)
    expect(repo.redoable).toHaveLength(1)

    repo.commit(created(application('unt')))
    expect(repo.redoable).toEqual([])
  })

  /**
   * Deleting an application UNLINKS, it never cascades — the removed `store-context.ts`
   * in the graph's spelling, with the undo it never had.
   *
   * The reminder survives the delete carrying no pointer, and comes back
   * carrying it again. The old reducer needed a hand-captured `ApplicationEdges`
   * record of five collections to manage the same thing, and it was a person
   * remembering what a write touched.
   */
  it('unlinks without cascading, and relinks on undo', () => {
    const rice = application('rice')
    const item = reminder('rice-deadline')
    const edge = about(item.id, rice.id)
    const { repo } = setup([rice, item], [edge])

    const entry = repo.commit(
      draft({
        tool: 'application.delete',
        label: 'Rice deleted',
        nodes: [{ id: rice.id, before: rice, after: null }],
        edges: [{ id: edge.id, before: edge, after: null }],
      }),
    )

    expect(repo.getSnapshot().node(rice.id)).toBeUndefined()
    // The record at the other end is untouched — no delta names it.
    expect(repo.getSnapshot().node(item.id)).toEqual(item)
    expect(repo.getSnapshot().incident(item.id)).toEqual([])

    repo.revert(entry.id)

    expect(repo.getSnapshot().node(rice.id)).toEqual(rice)
    expect(repo.getSnapshot().one(item.id, 'ABOUT', 'application')?.id).toBe(rice.id)
  })

  it('reverts a row out of the audit as a plain new change, not as a redo', () => {
    const { repo } = setup()
    const entry = repo.commit(created(application('rice')))
    // Aged out of the undo stack, as it would be after fifty more writes.
    repo.clearHistory()

    repo.revert(entry.id)

    expect(repo.getSnapshot().node('app:rice')).toBeUndefined()
    expect(repo.redoable).toEqual([])
    expect(repo.undoable.map((e) => e.label)).toEqual(['Undo Rice added'])
  })

  it('refuses an id it has never seen', () => {
    const { repo } = setup()
    expect(() => repo.revert('nothing')).toThrow(/not in the undo, redo or audit ring/)
  })
})

describe('replaceAll', () => {
  it('swaps the whole graph in one driver transaction and drops the history', async () => {
    const { driver, repo } = setup([application('rice')])
    repo.commit(created(application('unt')))

    const rows = await repo.replaceAll(
      { nodes: [application('meta-only')], edges: [] },
      freshMeta(AT, 'empty'),
    )

    expect(rows.ok).toBe(true)
    expect(repo.getSnapshot().node('app:rice')).toBeUndefined()
    expect(repo.getSnapshot().node('app:meta-only')).toBeDefined()
    expect(repo.meta.dataSet).toBe('empty')
    // Every before-image in the rings was captured against records that are
    // gone; putting one back would restore a record this store never held.
    expect(repo.undoable).toEqual([])
    expect(repo.audit).toEqual([])
    expect(driver.counts()).toEqual({ nodes: 1, edges: 0, meta: 1, ops: 0 })
  })

  it('reports a driver failure as a KgError rather than throwing', async () => {
    const driver = createMemoryDriver({
      fault: (call) =>
        call === 'replace' ? { code: 'storage/quota', message: 'the disk is full' } : null,
    })
    const repo = createRepository({
      driver,
      snapshot: MutableSnapshot.from([application('rice')]),
      meta: freshMeta(AT, 'demo'),
      now: () => AT,
    })

    const result = await repo.replaceAll({ nodes: [], edges: [] }, freshMeta(AT, 'empty'))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('storage/quota')
      // Toast copy: a plain sentence, no jargon, no ids, and never the driver's.
      expect(result.error.userMessage).not.toContain('disk is full')
      expect(result.error.context).toMatchObject({ driverMessage: 'the disk is full' })
    }
    // The graph is untouched, because the write that would have justified it failed.
    expect(repo.getSnapshot().node('app:rice')).toBeDefined()
  })
})

/**
 * The one bug in this codebase's history that is KNOWN to have destroyed user
 * data, and until this block nothing observed the value that causes it.
 *
 * `opsFor` emits `key: null` so the STORE allocates the journal row's key. It
 * used to emit a counter this repository kept, which is per tab: two tabs open
 * on the same database both believed the next free key was the same integer, so
 * `put` overwrote instead of appending and a concurrent burst reached disk with
 * about half its journal rows destroyed. The audit re-introduced exactly that
 * mutation and the suite stayed green at 362/362, because `idb-driver.test.ts`'s
 * `append()` helper hardcodes `key: null` — the STORE's behaviour was proven and
 * what the repository PASSES was never looked at.
 */
describe("the journal row's key", () => {
  it('is left for the store to allocate, never chosen here', async () => {
    const { driver, batches } = recordingDriver()
    const repo = createRepository({
      driver,
      snapshot: MutableSnapshot.from(),
      meta: freshMeta(AT, 'demo'),
      now: () => AT,
    })

    repo.commit(created(application('rice')))
    repo.commit(created(application('unt')))
    await repo.flush()

    const journalPuts = batches
      .flat()
      .filter((op) => op.store === 'ops')
      .map((op) => (op.kind === 'clear' ? 'clear' : op.key))

    expect(journalPuts).toHaveLength(2)
    expect(journalPuts).toEqual([null, null])
    repo.close()
  })

  /**
   * The loss itself, not the value that causes it.
   *
   * Two repositories over one store are the two tabs. The memory driver models
   * IndexedDB's key generator rather than a Map's — an explicit key is honoured
   * and raises the sequence, `null` allocates — so a repository that supplies
   * its own key overwrites the other tab's rows here exactly as it did on disk.
   */
  it('lets two tabs on one store keep every entry each of them wrote', async () => {
    const shared = createMemoryDriver()
    const tab = (label: string) => {
      const repo = createRepository({
        driver: shared,
        snapshot: MutableSnapshot.from(),
        meta: freshMeta(AT, 'demo'),
        now: () => AT,
      })
      return { repo, label }
    }

    const a = tab('a')
    const b = tab('b')
    for (let n = 0; n < 3; n += 1) {
      a.repo.commit(draft({ label: `a${n}`, nodes: [], edges: [] }))
      b.repo.commit(draft({ label: `b${n}`, nodes: [], edges: [] }))
    }
    await a.repo.flush()
    await b.repo.flush()

    expect(shared.counts().ops).toBe(6)
    const rows = await shared.readAll()
    const labels = rows.ok ? rows.value.ops.map((row) => row['label']) : []
    expect([...labels].sort()).toEqual(['a0', 'a1', 'a2', 'b0', 'b1', 'b2'])
    a.repo.close()
    b.repo.close()
  })
})

/**
 * Replay removes a node; the snapshot's cascade removes its edges; the entry
 * names only the node. That gap is A3.
 *
 * The user creates an application (toast: Undo, live eight seconds), tags it
 * inside the window, and presses Undo. Before this, the tag left the screen with
 * no undo that could bring it back, and its TAGS row stayed on disk pointing at
 * a node that no longer existed — so `validateRows` rejected it on every launch
 * from then on and the app said "1 record on this device could not be read and
 * is not being shown", forever, with nothing to clear it.
 */
describe('undoing a create that something has since pointed at', () => {
  const setupTagged = () => {
    const driver = createMemoryDriver()
    const repo = createRepository({
      driver,
      snapshot: MutableSnapshot.from([keyword('k1')]),
      meta: freshMeta(AT, 'demo'),
      now: () => AT,
    })
    const app = application('a1')
    const edge = tags('kw:k1', app.id)

    const create = repo.commit(created(app))
    repo.commit(draft({ label: 'Tagged', edges: [{ id: edge.id, before: null, after: edge }] }))
    return { driver, repo, app, edge, create }
  }

  it('journals the edge the cascade removes, and deletes its row', async () => {
    const { driver, repo, app, edge, create } = setupTagged()

    const undone = repo.revert(create.id)

    // In memory first: the node is gone and the edge went with it.
    expect(repo.getSnapshot().node(app.id)).toBeUndefined()
    expect(repo.getSnapshot().edges()).toEqual([])

    // Then the disk, which is where the damage was. The row left behind was
    // 'kw:k1|TAGS|app:a1' — a link to a node the same undo had just deleted, and
    // nothing anywhere ever deleted it.
    await repo.flush()
    const rows = await driver.readAll()
    expect(rows.ok && rows.value.edges).toEqual([])
    expect(rows.ok && rows.value.nodes.map((row) => row['id'])).toEqual([])

    // And the entry SAYS what it removed, which is what makes the undo undoable
    // and the delete durable. D12: a delta captured by the write cannot be
    // forgotten.
    expect(undone.edges).toEqual([{ id: edge.id, before: edge, after: null }])
    // The keyword itself is untouched — D15, unlink never cascade.
    expect(repo.getSnapshot().node('kw:k1')).toBeDefined()
    repo.close()
  })

  it('puts the tag back on redo, on screen and on disk alike', async () => {
    const { driver, repo, app, edge, create } = setupTagged()
    const undone = repo.revert(create.id)

    repo.revert(undone.id)

    expect(repo.getSnapshot().node(app.id)).toBeDefined()
    expect(repo.getSnapshot().edge(edge.id)).toEqual(edge)

    await repo.flush()
    const rows = await driver.readAll()
    expect(rows.ok && rows.value.edges.map((row) => row['id'])).toEqual([edge.id])
    repo.close()
  })
})

/**
 * A1 — Settings -> Empty and Import must not proceed on a flush that did not
 * drain.
 *
 * `flush()` settles on a failed attempt by design, so `replaceAll` used to wipe
 * the store on the strength of a promise that said nothing about whether
 * anything had reached disk. The audit drove it: Empty reported success, the
 * screen went blank, storage recovered, the backoff fired, and the record the
 * user had just deleted was back on disk under an empty graph — with health
 * reporting `idle`.
 */
describe('replaceAll while a write is failing', () => {
  const failing = () => {
    let broken = true
    const driver = createMemoryDriver({
      fault: (call) =>
        broken && call === 'commit' ? { code: 'storage/unavailable', message: 'blip' } : null,
    })
    return { driver, recover: () => (broken = false) }
  }

  it('refuses, and says why, rather than reporting a wipe it cannot make stick', async () => {
    const { driver, recover } = failing()
    const repo = createRepository({
      driver,
      snapshot: MutableSnapshot.from(),
      meta: freshMeta(AT, 'demo'),
      now: () => AT,
    })

    repo.commit(created(application('doomed')))
    await repo.flush()
    expect(repo.health.state).toBe('degraded')

    const result = await repo.replaceAll({ nodes: [], edges: [] }, freshMeta(AT, 'empty'))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('storage/unavailable')
      // A sentence about what jojo did, not about what IndexedDB said.
      expect(result.error.userMessage).toContain('have not reached the disk')
    }
    // Nothing moved: not the graph, not the meta row, not the store.
    expect(repo.getSnapshot().node('app:doomed')).toBeDefined()
    expect(repo.meta.dataSet).toBe('user')
    expect(driver.counts()).toEqual({ nodes: 0, edges: 0, meta: 0, ops: 0 })

    // And when the disk comes back, screen and disk agree — which is the whole
    // point. The old behaviour left the record on disk and NOT on screen.
    recover()
    await repo.flush()
    const rows = await driver.readAll()
    expect(rows.ok && rows.value.nodes.map((row) => row['id'])).toEqual(['app:doomed'])
    expect(repo.getSnapshot().node('app:doomed')).toBeDefined()
    repo.close()
  })

  it('still empties the store once the queue has actually drained', async () => {
    const { driver, recover } = failing()
    const repo = createRepository({
      driver,
      snapshot: MutableSnapshot.from(),
      meta: freshMeta(AT, 'demo'),
      now: () => AT,
    })

    repo.commit(created(application('doomed')))
    await repo.flush()
    recover()

    const result = await repo.replaceAll({ nodes: [], edges: [] }, freshMeta(AT, 'empty'))

    expect(result.ok).toBe(true)
    expect(driver.counts()).toEqual({ nodes: 0, edges: 0, meta: 1, ops: 0 })
    repo.close()
  })
})

describe('history', () => {
  it('keeps the audit when the undo stack is cleared', () => {
    const { repo } = setup()
    repo.commit(created(application('rice')))

    repo.clearHistory()

    expect(repo.undoable).toEqual([])
    expect(repo.redoable).toEqual([])
    expect(repo.audit).toHaveLength(1)
  })

  /**
   * D23 and R-7: flush, THEN rehydrate, then clear. The order is the guarantee.
   *
   * Our queued ops are last-write-wins against the other tab's, so draining them
   * after we adopt would replay our stale rows over their fresh ones — and the
   * other direction loses the user's work outright: rehydrating first replaces
   * the graph on screen with the one on disk, which is missing exactly the
   * writes still sitting in our queue. The edit vanishes from the screen while
   * the flush that follows puts it on the disk, so the two copies now disagree
   * and only a reload reveals which one won.
   *
   * Deliberately a four-line fake rather than two tabs and a clock. The function
   * under test IS the ordering; a real driver would let a microtask drain the
   * queue on its own and pass whichever way round the two awaits went, which is
   * how this survived a mutation against the whole suite.
   */
  describe('onRemoteCommit', () => {
    const event: StoreEvent = { kind: 'commit', at: AT, entryId: 'theirs' }

    /** A repo whose flush drains iff the disk is working. */
    const fake = (health: PersistenceHealth) => {
      const state = { disk: ['theirs'], queued: ['mine'], onScreen: ['mine'], cleared: false }
      const repo = {
        health,
        flush: async () => {
          await Promise.resolve()
          // `flush()` settles either way — that is the point of the guard.
          if (health.state === 'idle' || health.state === 'writing') {
            state.disk.push(...state.queued)
            state.queued = []
          }
        },
        clearHistory: () => {
          state.cleared = true
        },
      } as unknown as Repository
      const rehydrate = async () => {
        await Promise.resolve()
        state.onScreen = [...state.disk]
      }
      return { repo, rehydrate, state }
    }

    it('puts our queued write on disk before adopting what is there', async () => {
      const { repo, rehydrate, state } = fake({ state: 'idle' })
      await onRemoteCommit(repo, event, rehydrate)

      expect(state.onScreen).toEqual(['theirs', 'mine'])
      // And the stack goes last: every before-image in it was captured against
      // records the adopt has just replaced.
      expect(state.cleared).toBe(true)
    })

    /*
     * The guard `replaceAll` already has, sixty lines above, for the same
     * reason: `flush()` settles on a FAILED attempt so `pagehide` cannot hang,
     * so awaiting it says nothing about whether anything drained.
     *
     * Adopting anyway is the worst outcome available. `rehydrate` resets the
     * graph to what is on DISK, so every edit still only in memory is gone, and
     * `clearHistory` then destroys the undo ring and audit log that were the
     * last record of it — permanently, because `off` never clears in-session,
     * and triggered by another tab the person is not even looking at.
     */
    for (const health of [
      { state: 'off', reason: 'quota', pending: 1, unsaved: 1 },
      { state: 'degraded', pending: 1, unsaved: 1, attempts: 3, lastError: 'boom' },
    ] as const) {
      it(`keeps unsaved work on screen when the disk is ${health.state}`, async () => {
        const { repo, rehydrate, state } = fake(health)
        await onRemoteCommit(repo, event, rehydrate)

        // Stale, and that is the lesser harm: the work is still there to export.
        expect(state.onScreen).toEqual(['mine'])
        // And the undo that could recover it is still standing.
        expect(state.cleared).toBe(false)
      })
    }
  })

  it('replays a persisted audit so it survives a rehydrate', () => {
    const seen = [
      { id: 'j1', at: AT, tool: 't', input: {}, label: 'older', calls: [], nodes: [], edges: [] },
      { id: 'j2', at: AT, tool: 't', input: {}, label: 'newer', calls: [], nodes: [], edges: [] },
    ]
    const repo = createRepository({
      driver: createMemoryDriver(),
      snapshot: MutableSnapshot.from(),
      meta: freshMeta(AT, 'demo'),
      now: () => AT,
      audit: seen,
    })

    expect(repo.audit.map((e) => e.label)).toEqual(['newer', 'older'])
    // The undo STACK does not come back: an entry whose before-image predates a
    // reload is not a safe undo, and one that predates another tab's write is
    // actively unsafe.
    expect(repo.undoable).toEqual([])
  })
})
