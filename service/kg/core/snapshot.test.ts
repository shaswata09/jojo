/**
 * The indexes, which are maintained incrementally and never rebuilt.
 *
 * That is the whole risk: an index that drifts from the records it indexes
 * hides a row rather than crashing, and the row is only missing on the screen —
 * it is still in the store, still in the export, and still counted by Settings.
 */

import { describe, expect, it } from 'vitest'
import type { NodePropsByType, NodeType, Rel, StoredEdge, StoredNode } from './model'
import { edgeId, newNodeId } from './ref'
import { MutableSnapshot } from './snapshot'

const NOW = '2026-10-12T09:14:22.311Z'
let clock = Date.UTC(2026, 9, 12)

function node<T extends NodeType>(type: T, props: NodePropsByType[T]): StoredNode<T> {
  clock += 1
  return {
    id: newNodeId(type, clock),
    type,
    props,
    createdAt: NOW,
    updatedAt: NOW,
  } as StoredNode<T>
}

const application = (slug: string) =>
  node('application', {
    slug,
    role: '',
    note: '',
    roleTag: 'Assistant Professor',
    stage: 'draft',
    lastAction: 'Draft created',
    lastActionAt: NOW,
  })

const organisation = (slug: string) => node('organisation', { slug, name: slug })
const keyword = (name: string) => node('keyword', { slug: name, name, tone: 'teal' })

const link = (from: StoredNode, rel: Rel, to: StoredNode): StoredEdge => ({
  id: edgeId(from.id, rel, to.id),
  rel,
  from: from.id,
  to: to.id,
  props: {},
  createdAt: NOW,
})

describe('lookups', () => {
  it('finds a node by id, by type and by slug, and refuses the wrong type', () => {
    const app = application('rice')
    const g = MutableSnapshot.from([app])

    expect(g.node(app.id)).toBe(app)
    expect(g.node(app.id, 'application')).toBe(app)
    expect(g.node(app.id, 'keyword')).toBeUndefined()
    expect(g.bySlug('application', 'rice')).toBe(app)
    expect(g.bySlug('keyword', 'rice')).toBeUndefined()
  })

  // 'id-ascending = creation order' is a contract the board depends on, and
  // UUIDv7 is what makes the two the same sort. Inserting out of order is what
  // an undo of a delete does, so it is not a hypothetical.
  it('returns a type in id order however the nodes arrived', () => {
    const first = application('first')
    const second = application('second')
    const g = MutableSnapshot.from([second, first])
    expect(g.ofType('application').map((n) => n.props.slug)).toEqual(['first', 'second'])
  })

  it('indexes keywords by folded name, so one keyword cannot be minted twice', () => {
    const g = MutableSnapshot.from([keyword('Referral')])
    expect(g.keywordNamed('  referral ')?.props.name).toBe('Referral')
    expect(g.keywordNamed('read')).toBeUndefined()
  })

  it('keeps the slug index correct across a rename', () => {
    const app = application('rice')
    const g = MutableSnapshot.from([app])
    g.putNode({ ...app, props: { ...app.props, slug: 'rice-statistics' } })

    expect(g.bySlug('application', 'rice')).toBeUndefined()
    expect(g.bySlug('application', 'rice-statistics')?.id).toBe(app.id)
    expect(g.ofType('application')).toHaveLength(1)
  })

  /**
   * Two records answering to one [type, slug], and one of them is removed.
   *
   * `#unindexNode` sweeps the slug key only when it still points at the node
   * being removed. The rationale written above it — and above the rename case
   * next door — used to be that "a rename writes the new key before the old one
   * is swept"; it does not, `putNode` unindexes first and both orderings survive
   * a rename. Making the delete unconditional passed the whole suite, and THIS
   * is the case it breaks.
   *
   * Reachable because `checkInvariants` REPORTS a duplicate [type, slug] and
   * deliberately drops nothing — "nothing is dropped, nothing is skipped, and
   * the app starts either way" — so a store that arrived by import or merge
   * carries both rows. Deleting one of them would then take the survivor's URL
   * with it: `resolveAddress` reads `bySlug` first, and the detail route renders
   * "no longer exists" over a record still sitting in the list behind it.
   */
  it('leaves the survivor addressable when a duplicate slug is removed', () => {
    const kept = application('rice')
    const other = application('rice')
    const g = MutableSnapshot.from([kept, other])

    // Last one indexed wins, which is `other`.
    expect(g.bySlug('application', 'rice')?.id).toBe(other.id)

    g.removeNode(kept.id)

    expect(g.node(kept.id)).toBeUndefined()
    expect(g.bySlug('application', 'rice')?.id).toBe(other.id)
  })

  /** The same for the folded-name index, which `keyword.create` dedupes on. */
  it('leaves the surviving keyword findable by name when a duplicate is removed', () => {
    const kept = keyword('Referral')
    const other = keyword('referral')
    const g = MutableSnapshot.from([kept, other])

    expect(g.keywordNamed('REFERRAL')?.id).toBe(other.id)

    g.removeNode(kept.id)

    expect(g.keywordNamed('REFERRAL')?.id).toBe(other.id)
  })
})

describe('edges', () => {
  it('reads out, in and incident, and dedupes incident', () => {
    const app = application('rice')
    const org = organisation('rice')
    const read = keyword('read')
    const g = MutableSnapshot.from(
      [app, org, read],
      [link(app, 'AT', org), link(read, 'TAGS', app)],
    )

    expect(g.out(app.id).map((e) => e.rel)).toEqual(['AT'])
    expect(g.in(app.id).map((e) => e.rel)).toEqual(['TAGS'])
    expect(g.incident(app.id)).toHaveLength(2)
    expect(g.out(app.id, 'TAGS')).toEqual([])
  })

  it('follows one and many through the right end of the edge', () => {
    const app = application('rice')
    const org = organisation('rice')
    const read = keyword('read')
    const research = keyword('research')
    const g = MutableSnapshot.from(
      [app, org, read, research],
      [link(app, 'AT', org), link(read, 'TAGS', app), link(research, 'TAGS', app)],
    )

    expect(g.one(app.id, 'AT', 'organisation')?.id).toBe(org.id)
    expect(g.many(app.id, 'TAGS', 'in', 'keyword').map((n) => n.props.name)).toEqual([
      'read',
      'research',
    ])
    expect(g.many(app.id, 'TAGS', 'out', 'keyword')).toEqual([])
  })

  // Writing the same edge twice is how `link` stays idempotent with no
  // read-before-write. Counting it twice would double the node's degree.
  it('is idempotent on a repeated put', () => {
    const app = application('rice')
    const org = organisation('rice')
    const g = MutableSnapshot.from([app, org])
    g.putEdge(link(app, 'AT', org))
    g.putEdge(link(app, 'AT', org))

    expect(g.edges()).toHaveLength(1)
    expect(g.degree(app.id)).toBe(1)
  })

  it('keeps degree at the number of incident edges through add and remove', () => {
    const app = application('rice')
    const org = organisation('rice')
    const read = keyword('read')
    const g = MutableSnapshot.from([app, org, read])

    g.putEdge(link(app, 'AT', org))
    g.putEdge(link(read, 'TAGS', app))
    expect(g.degree(app.id)).toBe(2)

    g.removeEdge(edgeId(read.id, 'TAGS', app.id))
    expect(g.degree(app.id)).toBe(1)
    expect(g.degree(read.id)).toBe(0)
  })
})

describe('removeNode', () => {
  /**
   * Unlink, never cascade — verbatim from the removed `store-context.ts`.
   *
   * Deleting an application drops its edges and leaves the timeline items,
   * links, files and snippets exactly where they were. Cascading would delete
   * the user's own writing because it happened to be filed somewhere, and no
   * undo of that reads as reversible.
   */
  it('drops the record and its edges and touches nothing else', () => {
    const app = application('rice')
    const org = organisation('rice')
    const read = keyword('read')
    const g = MutableSnapshot.from(
      [app, org, read],
      [link(app, 'AT', org), link(read, 'TAGS', app)],
    )

    const removed = g.removeNode(app.id)

    expect(removed?.id).toBe(app.id)
    expect(g.node(app.id)).toBeUndefined()
    expect(g.edges()).toEqual([])
    expect(g.node(org.id)).toBe(org)
    expect(g.node(read.id)).toBe(read)
    expect(g.degree(org.id)).toBe(0)
    expect(g.bySlug('application', 'rice')).toBeUndefined()
  })

  it('answers undefined for a record that was never there', () => {
    expect(MutableSnapshot.from().removeNode('app:missing')).toBeUndefined()
  })
})

describe('epochs and version', () => {
  /**
   * An epoch bumps for the node AND for both ends of any edge it is on.
   *
   * A projection depends on its node and on its edges — an application's row
   * carries its organisation's name — so an epoch that only tracked the node
   * would serve a stale org name until the application was edited for some
   * unrelated reason.
   */
  it('bumps both ends when an edge changes', () => {
    const app = application('rice')
    const org = organisation('rice')
    const g = MutableSnapshot.from([app, org])

    const before = { app: g.epoch(app.id), org: g.epoch(org.id) }
    g.putEdge(link(app, 'AT', org))

    expect(g.epoch(app.id)).toBeGreaterThan(before.app)
    expect(g.epoch(org.id)).toBeGreaterThan(before.org)
  })

  it('leaves an untouched node at the epoch it had', () => {
    const app = application('rice')
    const other = application('baylor')
    const g = MutableSnapshot.from([app, other])

    const untouched = g.epoch(other.id)
    g.putNode({ ...app, props: { ...app.props, note: 'edited' } })
    expect(g.epoch(other.id)).toBe(untouched)
  })

  // One bump per commit, not one per write: `version` is what
  // useSyncExternalStore compares, so six writes in one tool would otherwise
  // re-render the tree six times for one user action.
  it('moves version once per commit', () => {
    const g = MutableSnapshot.from([application('rice')])
    const before = g.version
    g.putNode(application('baylor'))
    g.putNode(application('unt'))
    expect(g.version).toBe(before)
    expect(g.commit()).toBe(before + 1)
  })
})

/**
 * The wholesale swap — *Start empty*, *Load demo data*, and another tab's write.
 *
 * Every assertion here is about a COUNTER rather than about the records, and
 * that is the point. The records were never the half that went wrong: a rebuilt
 * `MutableSnapshot.from` held exactly the right rows and restarted `version` at
 * 0, `createProjection` read the repeat of a version it had already served as
 * "same commit, same answer", and the whole app went on drawing the store that
 * had just been deleted from a cache nothing could invalidate.
 */
describe('reset', () => {
  it('swaps the contents and leaves nothing of the old store behind', () => {
    const app = application('rice')
    const org = organisation('rice')
    const g = MutableSnapshot.from([app, org], [link(app, 'AT', org)])

    const baylor = application('baylor')
    g.reset([baylor], [])

    expect(g.nodes()).toEqual([baylor])
    expect(g.edges()).toEqual([])
    expect(g.node(app.id)).toBeUndefined()
    expect(g.bySlug('application', 'rice')).toBeUndefined()
    expect(g.ofType('application')).toEqual([baylor])
    expect(g.degree(app.id)).toBe(0)
  })

  it('drops a keyword out of the folded-name index too', () => {
    const g = MutableSnapshot.from([keyword('Referral')])
    g.reset([], [])
    expect(g.keywordNamed('referral')).toBeUndefined()
  })

  // The version is what the projection cache compares, so a swap that published
  // a number already served would be read as no change at all — which is the
  // bug: Settings correctly reporting an empty store while /applications
  // rendered the twelve demo records on the same screenful.
  it('never moves the version backwards', () => {
    const g = MutableSnapshot.from([application('rice')])
    g.commit()
    g.commit()
    const before = g.version

    g.reset([], [])
    expect(g.version).toBe(before)
    expect(g.commit()).toBe(before + 1)
  })

  // `createOneProjection` keys on the epoch and on nothing else, so a record
  // whose id survived a swap into a snapshot with restarted counters could serve
  // the detail route a projection of the record it used to be.
  it('keeps the epoch of a surviving record running rather than restarting it', () => {
    const app = application('rice')
    const g = MutableSnapshot.from([app])
    const before = g.epoch(app.id)

    g.reset([app], [])
    expect(g.epoch(app.id)).toBeGreaterThan(before)
  })

  // `removeNode` walks the edges incident to a node it can SEE. An edge whose
  // endpoints were never in the store is not on that walk, and one left behind
  // would outlive the store it belonged to.
  it('clears an edge whose endpoints were never nodes', () => {
    const ghost = link(application('gone'), 'AT', organisation('gone'))
    const g = MutableSnapshot.from([], [ghost])
    expect(g.edges()).toEqual([ghost])

    g.reset([], [])
    expect(g.edges()).toEqual([])
  })
})

describe('clone', () => {
  // The discard path for a failed tool. A clone sharing an index with its
  // parent would leave the failed transaction's writes behind after the buffer
  // was thrown away — a half-applied tool with no journal row to undo.
  it('shares no index with its parent', () => {
    const app = application('rice')
    const org = organisation('rice')
    const g = MutableSnapshot.from([app, org])

    const draft = g.clone()
    draft.putEdge(link(app, 'AT', org))
    draft.removeNode(org.id)

    expect(g.node(org.id)).toBe(org)
    expect(g.edges()).toEqual([])
    expect(g.degree(app.id)).toBe(0)
    expect(draft.node(org.id)).toBeUndefined()
  })
})
