/**
 * The epoch cache, and the property it exists for: one edit re-projects one row.
 *
 * Referential identity is not an optimisation here, it is the contract
 * `React.memo` holds on. A projection that rebuilt every row on every commit
 * would re-render all twelve application cards when one note changed, and the
 * only visible symptom is that the app feels slow on a machine you do not own.
 */

import { describe, expect, it } from 'vitest'
import type { NodePropsByType, NodeType, StoredEdge, StoredNode } from './model'
import { createOneProjection, createProjection } from './project'
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

const at = (from: StoredNode, to: StoredNode): StoredEdge => ({
  id: edgeId(from.id, 'AT', to.id),
  rel: 'AT',
  from: from.id,
  to: to.id,
  props: {},
  createdAt: NOW,
})

/**
 * The projection that motivates the design: the row carries the ORG's name.
 *
 * Built fresh per test, never shared. A projection IS a cache, so one shared
 * across tests carries the previous test's rows into the next one and makes the
 * identity assertions answer about the wrong snapshot.
 */
const rowProjection = () =>
  createProjection('application', (n, g) => ({
    id: n.id,
    slug: n.props.slug,
    org: g.one(n.id, 'AT', 'organisation')?.props.name ?? '',
  }))

describe('createProjection', () => {
  it('projects every node of the type, in the snapshot order', () => {
    const projectRow = rowProjection()
    const first = application('baylor')
    const second = application('rice')
    const g = MutableSnapshot.from([first, second])

    expect(projectRow(g).map((r) => r.slug)).toEqual(['baylor', 'rice'])
  })

  it('returns the identical array when nothing changed', () => {
    const projectRow = rowProjection()
    const g = MutableSnapshot.from([application('rice')])
    const rows = projectRow(g)
    g.commit()
    expect(projectRow(g)).toBe(rows)
  })

  it('re-projects only the row that changed', () => {
    const projectRow = rowProjection()
    const changing = application('rice')
    const stable = application('baylor')
    const g = MutableSnapshot.from([changing, stable])

    const before = projectRow(g)
    g.putNode({ ...changing, props: { ...changing.props, note: 'edited' } })
    g.commit()
    const after = projectRow(g)

    expect(after).not.toBe(before)
    expect(after.find((r) => r.slug === 'rice')).not.toBe(before.find((r) => r.slug === 'rice'))
    expect(after.find((r) => r.slug === 'baylor')).toBe(before.find((r) => r.slug === 'baylor'))
  })

  /**
   * The case a `WeakMap<StoredNode, R>` cannot see.
   *
   * The application's own record did not change — its organisation's did — so a
   * cache keyed on the node object alone would serve the old name until the
   * application was edited for some unrelated reason.
   */
  it('re-projects a row when an incident edge changes', () => {
    const projectRow = rowProjection()
    const app = application('rice')
    const org = organisation('rice-university')
    const g = MutableSnapshot.from([app, org])

    const before = projectRow(g)
    expect(before[0]?.org).toBe('')

    g.putEdge(at(app, org))
    g.commit()
    expect(projectRow(g)[0]?.org).toBe('rice-university')
  })

  /**
   * The row leaving is the assertable half. The cache entry leaving with it is
   * not, and the name used to claim both.
   *
   * Eviction reclaims memory and nothing else: a removed id can never be served
   * from the cache again, because `removeNode` bumps its epoch and a re-add
   * bumps it once more, so a stale entry would miss on the epoch anyway. There
   * is no reading of this projection that can tell the two versions apart —
   * which is worth saying here, so the next person to notice the gap does not
   * write a test that passes either way and believe they have closed it.
   */
  it('drops a removed row', () => {
    const projectRow = rowProjection()
    const app = application('rice')
    const g = MutableSnapshot.from([app, application('baylor')])

    projectRow(g)
    g.removeNode(app.id)
    g.commit()

    const after = projectRow(g)
    expect(after.map((r) => r.slug)).toEqual(['baylor'])
  })

  /**
   * A snapshot whose version went BACKWARDS is a different store, not an earlier
   * commit of this one.
   *
   * The equality check that makes a re-render cheap reads a lower version as
   * "not the version I cached", walks the rows, and then hits the epoch cache —
   * and epochs restart at 1 in every store, so a record that is `rice` here and
   * `baylor` there matches on the number and is served from the wrong one. The
   * failure is silent and total: every list in the app rendering records that no
   * longer exist, beside a Settings page correctly reporting the store empty.
   *
   * `Repository` keeps `version` monotonic — `replaceAll` and `rehydrate` swap
   * the snapshot's CONTENTS rather than minting a fresh object — so nothing in
   * the app reaches this today. That is exactly why it is pinned: the guard is
   * two words, it protects the worst outcome available to a cache, and the next
   * person to read "this should be unreachable" is being invited to delete it.
   */
  it('serves the snapshot it was handed, even one older than the last', () => {
    const projectRow = rowProjection()
    const id = application('rice').id

    const before = MutableSnapshot.from([{ ...application('rice'), id } as StoredNode])
    for (let i = 0; i < 4; i += 1) before.commit()
    expect(projectRow(before).map((r) => r.slug)).toEqual(['rice'])

    // A second store holding a different record under the same id, at a lower
    // version. This is what a fresh snapshot over the same ids looks like.
    const replaced = MutableSnapshot.from([{ ...application('baylor'), id } as StoredNode])
    expect(replaced.version).toBeLessThan(before.version)

    expect(projectRow(replaced).map((r) => r.slug)).toEqual(['baylor'])
  })

  /**
   * A row that kept its identity can still have MOVED, and a reordered array
   * with every element identical is a different array.
   *
   * Not a drag between stages, which this used to claim: a stage change is a
   * `putNode`, so the row's epoch moves and the cache miss alone republishes.
   * This is an insert AHEAD of the existing rows — `ofType` is id-ascending, so
   * a record restored by undo lands wherever its id says rather than at the end.
   */
  it('publishes a new array when a row is inserted ahead of the others', () => {
    const projectRow = rowProjection()
    const g = MutableSnapshot.from([application('baylor')])
    const before = projectRow(g)

    // 'aaa' sorts before the existing id only if it was minted earlier, so the
    // new row lands at the front and every other row shifts.
    const earlier = { ...application('rice'), id: 'app:00000000-0000-7000-8000-000000000000' }
    g.putNode(earlier as StoredNode)
    g.commit()

    const after = projectRow(g)
    expect(after.map((r) => r.slug)).toEqual(['rice', 'baylor'])
    expect(after).not.toBe(before)
  })
})

describe('createOneProjection', () => {
  const oneProjection = () => createOneProjection('application', (n) => ({ slug: n.props.slug }))

  it('keeps identity until the record changes', () => {
    const projectOne = oneProjection()
    const app = application('rice')
    const g = MutableSnapshot.from([app])

    const first = projectOne(g, app.id)
    expect(projectOne(g, app.id)).toBe(first)

    g.putNode({ ...app, props: { ...app.props, note: 'edited' } })
    expect(projectOne(g, app.id)).not.toBe(first)
  })

  // The distinction has to survive: `routes/ApplicationDetail.tsx` renders its
  // "This application no longer exists" state from exactly this undefined.
  it('answers undefined for a record that has gone', () => {
    const projectOne = oneProjection()
    const app = application('rice')
    const g = MutableSnapshot.from([app])

    expect(projectOne(g, app.id)).toBeDefined()
    g.removeNode(app.id)
    expect(projectOne(g, app.id)).toBeUndefined()
  })
})
