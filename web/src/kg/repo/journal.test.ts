/**
 * The journal is the undo model, so these are the tests that stand in for the 42
 * hand-written undo closures the change journal replaces.
 *
 * The writer under test is four lines of Map, deliberately: a failure here has to
 * point at the replay order or at the delta, never at the snapshot's indexes.
 */

import { describe, expect, it } from 'vitest'
import type { Instant, NodeId, StoredEdge, StoredNode } from '../core/model'
import { AUDIT_CAP, Ring, UNDO_DEPTH, applyJournal, invert, isEmpty } from './journal'
import type { GraphWriter, JournalEntry } from './journal'

const AT: Instant = '2026-10-12T09:00:00.000Z'

function fakeStore() {
  const nodes = new Map<NodeId, StoredNode>()
  const edges = new Map<string, StoredEdge>()
  /** The order writes arrived in, so the replay ORDER is assertable, not just the result. */
  const log: string[] = []

  const writer: GraphWriter = {
    putNode(node) {
      log.push(`+node ${node.id}`)
      nodes.set(node.id, node)
    },
    removeNode(id) {
      log.push(`-node ${id}`)
      nodes.delete(id)
    },
    putEdge(edge) {
      log.push(`+edge ${edge.id}`)
      edges.set(edge.id, edge)
    },
    removeEdge(id) {
      log.push(`-edge ${id}`)
      edges.delete(id)
    },
  }

  return { writer, nodes, edges, log }
}

const application = (slug: string, note = ''): StoredNode => ({
  id: `app:${slug}`,
  type: 'application',
  props: {
    slug,
    role: 'CS',
    note,
    roleTag: 'Assistant Professor',
    stage: 'draft',
    lastAction: 'Draft created',
    lastActionAt: AT,
  },
  createdAt: AT,
  updatedAt: AT,
})

const item = (slug: string): StoredNode => ({
  id: `item:${slug}`,
  type: 'timelineItem',
  props: { slug, title: slug, date: '2026-10-12', kind: 'admin', urgency: 'gray', remind: false },
  createdAt: AT,
  updatedAt: AT,
})

const about = (from: NodeId, to: NodeId): StoredEdge => ({
  id: `${from}|ABOUT|${to}`,
  rel: 'ABOUT',
  from,
  to,
  props: {},
  createdAt: AT,
})

const entryOf = (parts: Partial<JournalEntry>): JournalEntry => ({
  id: 'j1',
  at: AT,
  tool: 'application.delete',
  input: {},
  label: 'Rice deleted',
  calls: [],
  nodes: [],
  edges: [],
  ...parts,
})

describe('applyJournal', () => {
  it('replays a create forwards and takes it back on undo', () => {
    const store = fakeStore()
    const node = application('rice')
    const entry = entryOf({ nodes: [{ id: node.id, before: null, after: node }] })

    applyJournal(store.writer, entry, 'redo')
    expect(store.nodes.get('app:rice')).toEqual(node)

    applyJournal(store.writer, entry, 'undo')
    expect(store.nodes.has('app:rice')).toBe(false)
  })

  /**
   * The ordering rule, stated as a test because nothing else states it.
   *
   * Edges come out first and go back in last. Without it, undoing a delete puts
   * the application back AFTER its ABOUT edge, and any index keyed on the
   * endpoints is asked to file an edge against a node that is not there yet —
   * which is a dangling reference in a structure whose whole job is not to have
   * any.
   */
  it('removes edges before nodes and restores nodes before edges', () => {
    const store = fakeStore()
    const app = application('rice')
    const reminder = item('rice-draft')
    const edge = about(reminder.id, app.id)

    const entry = entryOf({
      nodes: [{ id: app.id, before: app, after: null }],
      edges: [{ id: edge.id, before: edge, after: null }],
    })

    applyJournal(store.writer, entry, 'redo')
    expect(store.log).toEqual([`-edge ${edge.id}`, `-node ${app.id}`])

    store.log.length = 0
    applyJournal(store.writer, entry, 'undo')
    expect(store.log).toEqual([`+node ${app.id}`, `+edge ${edge.id}`])
  })

  /**
   * Deleting an application UNLINKS, it never cascades — and the undo has to put
   * every one of those edges back.
   *
   * This is `store-context.ts:152-176` and its `ApplicationEdges` capture, in the
   * graph's spelling. The reminder, the link, the file, the snippet and the
   * captured posting all survive the delete carrying no pointer, and come back
   * carrying it again. An undo that returned the application to an app where
   * nothing referenced it any more looks like a successful undo and is not one.
   */
  it('unlinks five records on delete and relinks all five on undo', () => {
    const store = fakeStore()
    const app = application('rice')
    const pointing = ['rice-draft', 'rice-deadline', 'l-rice', 'f-rice-ad', 'p-rice'].map((slug) =>
      about(`item:${slug}`, app.id),
    )
    for (const edge of pointing) store.edges.set(edge.id, edge)
    store.nodes.set(app.id, app)

    const entry = entryOf({
      nodes: [{ id: app.id, before: app, after: null }],
      edges: pointing.map((edge) => ({ id: edge.id, before: edge, after: null })),
    })

    applyJournal(store.writer, entry, 'redo')
    expect(store.edges.size).toBe(0)
    // The records at the other end are never touched: no delta names them, so
    // the writer was never asked to remove one.
    expect(store.log.filter((l) => l.startsWith('-node'))).toEqual([`-node ${app.id}`])

    applyJournal(store.writer, entry, 'undo')
    expect([...store.edges.values()]).toEqual(pointing)
    expect(store.nodes.get(app.id)).toEqual(app)
  })

  it('round-trips an update back to the exact before-image', () => {
    const store = fakeStore()
    const before = application('rice', 'statements missing')
    const after = application('rice', 'statements done')
    store.nodes.set(before.id, before)

    const entry = entryOf({ nodes: [{ id: before.id, before, after }] })

    applyJournal(store.writer, entry, 'redo')
    expect(store.nodes.get(before.id)).toEqual(after)

    applyJournal(store.writer, entry, 'undo')
    expect(store.nodes.get(before.id)).toEqual(before)
  })
})

describe('invert', () => {
  // Redo is free because the inverse of the inverse is the original. If this
  // stops holding, redo needs a second mechanism and a second set of bugs.
  it('swaps every before and after, and inverting twice is the original', () => {
    const node = application('rice')
    const entry = entryOf({ nodes: [{ id: node.id, before: null, after: node }] })

    const undone = invert(entry, 'Undo Rice added')
    expect(undone.nodes[0]).toEqual({ id: node.id, before: node, after: null })
    expect(undone.label).toBe('Undo Rice added')

    const redone = invert({ ...entry, ...undone }, entry.label)
    expect(redone.nodes).toEqual(entry.nodes)
  })
})

describe('isEmpty', () => {
  it('is true only when nothing was written', () => {
    expect(isEmpty({ nodes: [], edges: [] })).toBe(true)
    expect(
      isEmpty({
        nodes: [],
        edges: [about('a', 'b')].map((e) => ({ id: e.id, before: null, after: e })),
      }),
    ).toBe(false)
  })
})

describe('Ring', () => {
  it('drops from the front once it is full', () => {
    const ring = new Ring<number>(3)
    for (const n of [1, 2, 3, 4, 5]) ring.push(n)

    expect(ring.size).toBe(3)
    // Newest first — the order both the Undo menu and the audit log read in.
    expect(ring.entries).toEqual([5, 4, 3])
  })

  it('loads the tail of what it is handed, so a long audit prunes on open', () => {
    const ring = new Ring<number>(2)
    ring.load([1, 2, 3, 4])
    expect(ring.entries).toEqual([4, 3])
  })

  it('pops the newest and clears to empty', () => {
    const ring = new Ring<string>(5)
    ring.push('a')
    ring.push('b')

    expect(ring.pop()).toBe('b')
    expect(ring.entries).toEqual(['a'])

    ring.clear()
    expect(ring.size).toBe(0)
  })

  // Pinned because the two numbers say different things: the undo stack is
  // session-scoped and about human memory, the audit is persisted and about
  // being able to explain what happened.
  it('keeps the two capacities apart', () => {
    expect(UNDO_DEPTH).toBe(50)
    expect(AUDIT_CAP).toBe(200)
  })
})
