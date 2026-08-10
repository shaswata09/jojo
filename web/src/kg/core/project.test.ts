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

  it('drops a removed row and forgets its cache entry', () => {
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
   * A row that kept its identity can still have MOVED, and a reordered array
   * with every element identical is a different array. This is what a drag
   * between stages looks like from here.
   */
  it('publishes a new array when the order changes and nothing else does', () => {
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

  // The distinction has to survive: ApplicationDetail.tsx:112-127 renders "This
  // application no longer exists" from exactly this undefined.
  it('answers undefined for a record that has gone', () => {
    const projectOne = oneProjection()
    const app = application('rice')
    const g = MutableSnapshot.from([app])

    expect(projectOne(g, app.id)).toBeDefined()
    g.removeNode(app.id)
    expect(projectOne(g, app.id)).toBeUndefined()
  })
})
