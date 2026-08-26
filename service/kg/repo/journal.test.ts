/**
 * The journal is the undo model, so these are the tests that stand in for the 42
 * hand-written undo closures the change journal replaces.
 *
 * The writer under test is four lines of Map, deliberately: a failure here has to
 * point at the replay order or at the delta, never at the snapshot's indexes.
 */

import { describe, expect, it } from 'vitest'
import type { Instant, NodeId, StoredEdge, StoredNode } from '../core/model'
import {
  AUDIT_CAP,
  Ring,
  UNDO_DEPTH,
  applyJournal,
  changesNothing,
  invert,
  readJournalRows,
  trimJournal,
} from './journal'
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
   * This is the removed `store-context.ts` and its `ApplicationEdges` capture, in the
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

describe('changesNothing', () => {
  it('is true when nothing was written at all', () => {
    expect(changesNothing({ nodes: [], edges: [] })).toBe(true)
    expect(
      changesNothing({
        nodes: [],
        edges: [about('a', 'b')].map((e) => ({ id: e.id, before: null, after: e })),
      }),
    ).toBe(false)
  })

  /**
   * The case the old spelling could not see, and the reason it mattered.
   *
   * `tx.patch` stamps `updatedAt` on every call, so a Save pressed over an
   * unchanged form ALWAYS produced a delta. Counting deltas therefore answered
   * "yes, something changed" for every no-op save in the app, the entry took the
   * top of the undo stack, and the next Ctrl+Z restored a timestamp instead of
   * undoing the edit before it.
   */
  it('sees through the updatedAt stamp that every patch writes', () => {
    const before = application('rice', 'statements missing')
    const after = { ...before, updatedAt: '2026-10-12T11:30:00.000Z' }

    expect(changesNothing({ nodes: [{ id: before.id, before, after }], edges: [] })).toBe(true)
  })

  it('is false when a field moved as well as the stamp', () => {
    const before = application('rice', 'statements missing')
    const after = {
      ...application('rice', 'statements done'),
      updatedAt: '2026-10-12T11:30:00.000Z',
    }

    expect(changesNothing({ nodes: [{ id: before.id, before, after }], edges: [] })).toBe(false)
  })

  // A create and a delete are changes whatever the images look like: one side is
  // absent, which is the whole content of the delta.
  it('never calls a create or a delete a no-op', () => {
    const node = application('rice')
    expect(changesNothing({ nodes: [{ id: node.id, before: null, after: node }], edges: [] })).toBe(
      false,
    )
    expect(changesNothing({ nodes: [{ id: node.id, before: node, after: null }], edges: [] })).toBe(
      false,
    )
  })

  /**
   * Compared structurally rather than by identity or by `JSON.stringify`.
   *
   * The images come back from two different places — one off the snapshot, one
   * built by `{ ...current, props }` — so they are never the same object, and
   * `props` is rebuilt key by key, so their key order can differ for values that
   * are identical.
   */
  it('compares props by value, not by reference or key order', () => {
    const before = application('rice')
    const reordered = {
      ...before,
      props: Object.fromEntries(Object.entries(before.props).reverse()),
    } as StoredNode

    expect(
      changesNothing({ nodes: [{ id: before.id, before, after: reordered }], edges: [] }),
    ).toBe(true)

    const deeper = {
      ...before,
      props: { ...before.props, offer: { respondBy: '2026-11-01', note: 'call back' } },
    } as StoredNode
    expect(changesNothing({ nodes: [{ id: before.id, before, after: deeper }], edges: [] })).toBe(
      false,
    )
  })

  /**
   * Clearing a field is a change, even when the cleared key stays present.
   *
   * An explicitly-undefined key is a DIFFERENT record from an absent one
   * everywhere else in this codebase (D21) — it is why `sameImage` asks `key in
   * right` rather than comparing the two reads, which are both `undefined`.
   * Folding them together makes exactly one shape of write vanish: one that
   * clears one optional field and sets another, so the key COUNTS match and
   * every remaining key compares equal. That entry is then a no-op, never
   * reaches the undo ring, and Ctrl+Z silently skips past the edit to the one
   * before it.
   */
  it('is false when a key was cleared and another took its place', () => {
    const base = application('rice')
    // Through `unknown`, because `exactOptionalPropertyTypes` is exactly what
    // forbids writing `comp: undefined` — and a row off disk is not bound by
    // it. That gap is the reason `sameImage` has to treat present-and-undefined
    // as its own state rather than trusting the type.
    const props = base.props as Record<string, unknown>
    const cleared = { ...base, props: { ...props, comp: undefined } } as unknown as StoredNode
    const relocated = { ...base, props: { ...props, location: 'Houston' } } as unknown as StoredNode

    // The trap: same key count, and the only key that differs reads `undefined`
    // on both sides.
    expect(Object.keys(cleared.props)).toHaveLength(Object.keys(relocated.props).length)

    expect(
      changesNothing({ nodes: [{ id: base.id, before: cleared, after: relocated }], edges: [] }),
    ).toBe(false)
  })

  // One real delta among no-ops is still a change, or a bulk write would lose
  // its undo because most of the records it touched happened not to move.
  it('is false when any one delta moved', () => {
    const still = application('rice')
    const moved = application('unt', 'note')

    expect(
      changesNothing({
        nodes: [
          { id: still.id, before: still, after: { ...still, updatedAt: AT } },
          { id: moved.id, before: moved, after: application('unt', 'note changed') },
        ],
        edges: [],
      }),
    ).toBe(false)
  })
})

describe('readJournalRows', () => {
  const row = (id: string, at: string): Record<string, unknown> => ({
    id,
    at,
    tool: 'application.note.set',
    input: {},
    label: `Change ${id}`,
    calls: [],
    nodes: [],
    edges: [],
  })

  /**
   * Oldest first, by `at` and not by the order the store handed them over.
   *
   * The `ops` keys autoincrement, so disk order and time order agree right up
   * until the prune-and-renumber pass on open rewrites the keys — and after
   * another tab has pruned, a rehydrate reads them back in whatever order the
   * renumber left. `Ring.load` takes the tail of what it is given, so an
   * unsorted read does not merely render the audit inside out: it keeps the
   * WRONG two hundred rows, dropping recent entries and holding the ones the
   * prune was supposed to remove.
   */
  it('returns the rows oldest first, whatever order they arrive in', () => {
    const rows = [
      row('c', '2026-10-12T11:00:00.000Z'),
      row('a', '2026-10-12T09:00:00.000Z'),
      row('d', '2026-10-12T12:00:00.000Z'),
      row('b', '2026-10-12T10:00:00.000Z'),
    ]

    expect(readJournalRows(rows).map((e) => e.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  /**
   * A row that is not an entry is dropped, not reported.
   *
   * An unreadable audit row is a lost NOTE about a change, not a lost change —
   * `validateRows` is the path where a rejection means a record vanished, and
   * that one counts every one. Escalating here would hide a store full of
   * healthy records behind a recovery panel over a broken log line.
   */
  it('drops a row that is not an entry and keeps the rest', () => {
    const good = row('a', '2026-10-12T09:00:00.000Z')
    const rows = [good, { id: 'no-timestamp' }, { ...good, id: 'b', nodes: 'not an array' }, 42]

    expect(readJournalRows(rows).map((e) => e.id)).toEqual(['a'])
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

/**
 * The trim, which is what stops the persisted journal being 95% of every write.
 *
 * Measured with the ring full on the benchmark world: 228.5 KB of journal
 * against 12.3 KB of actual graph — and on the phone the whole store is one
 * AsyncStorage key rewritten on every commit, so that was a quarter of a
 * megabyte to save a note.
 *
 * Two properties have to hold together, and they pull against each other: the
 * log must read exactly as it did (it counts the DELTAS, not their contents),
 * and a trimmed entry must be impossible to revert (inverting two nulls would
 * land a change that deletes every record the entry names).
 */
describe('trimJournal', () => {
  const entry = (id: string, records: number): JournalEntry => ({
    id,
    at: '2026-08-25T09:00:00.000Z',
    tool: 'application.update',
    input: {},
    label: `edit ${id}`,
    calls: [],
    nodes: Array.from({ length: records }, (_, i) => {
      const nodeId = `app:${id}-${String(i)}`
      const props = { slug: nodeId, createdAt: '2026-08-25', updatedAt: '2026-08-25' }
      return {
        id: nodeId,
        before: { id: nodeId, type: 'application', props: { ...props, note: 'before' } },
        after: { id: nodeId, type: 'application', props: { ...props, note: 'after' } },
      }
    }) as unknown as JournalEntry['nodes'],
    edges: [],
  })

  const many = (n: number) => Array.from({ length: n }, (_, i) => entry(String(i), 2))

  it('leaves the newest entries whole, because undo reaches them', () => {
    const trimmed = trimJournal(many(10), 4)
    for (const kept of trimmed.slice(-4)) {
      expect(kept.trimmed).toBeUndefined()
      expect(kept.nodes[0]?.before).not.toBeNull()
    }
  })

  it('drops the images from the older ones, newest LAST', () => {
    // Getting the direction wrong trims exactly what undo needs and keeps what
    // nothing reads, and every test above would still pass.
    const trimmed = trimJournal(many(10), 4)
    for (const old of trimmed.slice(0, 6)) {
      expect(old.trimmed).toBe(true)
      expect(old.nodes[0]?.before).toBeNull()
      expect(old.nodes[0]?.after).toBeNull()
    }
  })

  it('drops the tool input, which is the biggest field and unread', () => {
    const trimmed = trimJournal(many(10), 4)
    expect(trimmed[0]?.input).toBeNull()
    expect(trimmed[0]?.calls).toEqual([])
    // The tool name stays: the log reads it to decide whether undo is offered.
    expect(trimmed[0]?.tool).toBe('application.update')
  })

  it('keeps the counts the audit log renders', () => {
    // `touchedBy` reads `entry.nodes.length`. Dropping the deltas rather than
    // their images would make every old row read "no change".
    const trimmed = trimJournal(many(10), 4)
    for (const [i, row] of trimmed.entries()) {
      expect(row.nodes).toHaveLength(2)
      expect(row.label).toBe(`edit ${String(i)}`)
      expect(row.id).toBe(String(i))
    }
  })

  it('is stable — trimming twice changes nothing', () => {
    // `boot-ready` rewrites the ops store when the trim changed anything, and
    // compares by identity. A trim that minted new objects every open would
    // rewrite the whole journal on every launch, forever.
    const once = trimJournal(many(10), 4)
    const twice = trimJournal(once, 4)
    for (const [i, row] of twice.entries()) expect(row).toBe(once[i])
  })

  it('trims nothing when everything fits in the window', () => {
    const rows = many(3)
    const trimmed = trimJournal(rows, 4)
    for (const [i, row] of trimmed.entries()) expect(row).toBe(rows[i])
  })
})
