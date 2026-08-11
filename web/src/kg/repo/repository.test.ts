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
import { createMemoryDriver } from '../storage/memory-driver'
import type { JournalDraft } from './journal'
import { freshMeta } from './meta'
import { createRepository } from './repository'

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

describe('commit', () => {
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
   * Deleting an application UNLINKS, it never cascades — `store-context.ts:152-176`
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

describe('history', () => {
  it('keeps the audit when the undo stack is cleared', () => {
    const { repo } = setup()
    repo.commit(created(application('rice')))

    repo.clearHistory()

    expect(repo.undoable).toEqual([])
    expect(repo.redoable).toEqual([])
    expect(repo.audit).toHaveLength(1)
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
