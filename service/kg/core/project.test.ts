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
import { createOneProjection, createProjection, sameValue } from './project'
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
    // `slug`, because this projector reads it. This test used to edit `note`,
    // which it does not read, and assert a new row came back anyway — see the
    // test below for why that stopped being true and why it is an improvement.
    g.putNode({ ...changing, props: { ...changing.props, slug: 'rice-renamed' } })
    g.commit()
    const after = projectRow(g)

    expect(after).not.toBe(before)
    expect(after.find((r) => r.slug === 'rice-renamed')).not.toBe(
      before.find((r) => r.slug === 'rice'),
    )
    expect(after.find((r) => r.slug === 'baylor')).toBe(before.find((r) => r.slug === 'baylor'))
  })

  /**
   * An edit to a field the projector never reads must cost nothing at all.
   *
   * The epoch is coarse on purpose — it moves for the node, its edges, and every
   * neighbour one hop out, because that is the only way a renamed organisation
   * can reach the application rows that display its name. The price is that it
   * also moves for edits no projection cares about, and `note` is the everyday
   * one: a person types in the notes field and, before this, every list keyed on
   * that node republished its array and minted a new row object.
   *
   * Measured on the benchmark world before the fix — editing one application's
   * note republished BOTH the application and the organisation arrays, one new
   * row object in each, and the content of zero rows in either had changed.
   * Every `React.memo` below them missed for nothing.
   *
   * So the cache compares the re-projected value against the one it holds and
   * keeps the OLD object when they match. Identity is the contract the rest of
   * the app renders against; this is where it is decided.
   */
  it('keeps every identity when the edit touches nothing it projects', () => {
    const projectRow = rowProjection()
    const edited = application('rice')
    const untouched = application('baylor')
    const g = MutableSnapshot.from([edited, untouched])

    const before = projectRow(g)
    g.putNode({ ...edited, props: { ...edited.props, note: 'typed into the notes field' } })
    g.commit()
    const after = projectRow(g)

    // The array itself, so the list does not re-render...
    expect(after).toBe(before)
    // ...and the row, so nothing memoised below it re-renders either.
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
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
   * The other half of the same case, and the one the epoch did not cover.
   *
   * `epoch(id)` bumped for the node written and for the two ENDS of any edge
   * written. Renaming the organisation is a `putNode` on the organisation, so
   * only the organisation's epoch moved — every application row hit the cache
   * and kept serving the old employer name, which is the exact failure this
   * file's subject was chosen to demonstrate and the one `createProjection`'s
   * own header claims to have solved.
   *
   * Latent when it was found: no tool renames an organisation, and
   * `application.update` changing the employer relinks the `AT` edge, which
   * bumps the application. It is pinned here rather than left to the day
   * `org.rename` lands, because on that day every board card, table row and
   * detail page shows the old employer until something unrelated edits the
   * application — and the comment that would have warned the author said the
   * opposite.
   */
  it('re-projects a row when a NEIGHBOUR node it reads is rewritten', () => {
    const projectRow = rowProjection()
    const app = application('rice')
    const org = organisation('rice-university')
    const g = MutableSnapshot.from([app, org])
    g.putEdge(at(app, org))
    g.commit()

    const before = projectRow(g)
    expect(before[0]?.org).toBe('rice-university')

    // The organisation's own record changes. The application's does not, and
    // neither does the edge between them.
    g.putNode({ ...org, props: { ...org.props, name: 'Rice University' } })
    g.commit()

    const after = projectRow(g)
    expect(after[0]?.org).toBe('Rice University')
    expect(after[0]).not.toBe(before[0])
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

/**
 * `sameValue` decides whether a projected row is REUSED, so its dangerous
 * direction is the false positive: calling two different rows equal serves a
 * stale one, and nothing downstream can tell. Every branch below survived
 * mutation until it was pinned here.
 */
describe('sameValue', () => {
  it('is true for structurally identical plain data', () => {
    expect(sameValue({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true)
    expect(sameValue({ a: 1, b: ['x', 'y'] }, { a: 1, b: ['x', 'y'] })).toBe(true)
    // Key order is not content. `JSON.stringify` on both sides would say false.
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
  })

  it('counts keys on BOTH sides', () => {
    // A row that GAINED a field, and one that lost it. Comparing only the keys
    // of `a` misses the first; comparing only lengths of one side misses both.
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(sameValue({ a: 1, b: 2 }, { a: 1 })).toBe(false)
    // Same COUNT, different names — the case a length check alone lets through.
    expect(sameValue({ a: 1 }, { b: 1 })).toBe(false)
    // Same count, different names, and BOTH undefined — the case a length check
    // AND a value comparison both let through, because reading a missing key
    // gives `undefined` and so does reading the present one. Only asking
    // whether the key exists separates them. Reachable in real rows: this
    // package builds optional props by spreading `{ key: value }` in or out,
    // so which optional a row carries is exactly the thing that varies.
    expect(sameValue({ a: undefined }, { b: undefined })).toBe(false)
  })

  it('compares arrays element by element, not by length', () => {
    // The realistic row: a list of ids that changed without changing size.
    expect(sameValue(['a', 'b'], ['a', 'c'])).toBe(false)
    expect(sameValue([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(sameValue([1, 2], [1, 2, 3])).toBe(false)
    expect(sameValue([{ id: 'a' }], [{ id: 'b' }])).toBe(false)
    // An array is not a record that happens to have the same keys.
    expect(sameValue(['x'], { 0: 'x' })).toBe(false)
  })

  it('refuses to guess about anything that is not plain data', () => {
    // Two Dates with the same time have identical (empty) own keys, so walking
    // keys would call them equal — and would call two DIFFERENT dates equal too.
    expect(sameValue(new Date(0), new Date(0))).toBe(false)
    expect(sameValue(new Date(0), new Date(1))).toBe(false)
    expect(sameValue(new Map([['a', 1]]), new Map([['a', 1]]))).toBe(false)
    // The same instance is still the same instance.
    const shared = new Date(0)
    expect(sameValue(shared, shared)).toBe(true)
  })

  it('separates null from an object, and NaN from itself the way Object.is does', () => {
    expect(sameValue(null, {})).toBe(false)
    expect(sameValue({}, null)).toBe(false)
    expect(sameValue(null, null)).toBe(true)
    expect(sameValue(Number.NaN, Number.NaN)).toBe(true)
    expect(sameValue(0, -0)).toBe(false)
  })
})
