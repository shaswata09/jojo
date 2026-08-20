/**
 * Which changes to the graph are changes to the LAYOUT, and which are not.
 *
 * The distinction is worth a test file of its own because getting it wrong is
 * invisible and expensive in opposite directions. Too broad and a field edited
 * on another page re-runs a 192-tick O(n²) solve — 1.56 seconds at two thousand
 * records, measured in `force.ts` — while `/graph` is open. Too narrow and a
 * record deleted on the board leaves its dot on the canvas attached to nothing,
 * because the simulation was never told.
 *
 * `GraphCanvas` cannot be mounted (D20), so this is the only place the question
 * gets asked.
 */

import { describe, expect, it } from 'vitest'
import { filterGraph } from '@/lib/graph/traversal'
import type { Graph, GraphEdge, GraphNode } from '@/lib/graph/model'
import { structureOf } from './structure'
import { nodeRadius } from './visuals'

function makeGraph(
  specs: readonly { id: string; label?: string; detail?: string }[],
  links: readonly [string, string][],
): Graph {
  const nodes: GraphNode[] = specs.map((s) => ({
    id: s.id,
    type: 'application',
    label: s.label ?? s.id,
    recordId: s.id,
    degree: 0,
    ...(s.detail === undefined ? {} : { detail: s.detail }),
  }))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges: GraphEdge[] = links.map(([from, to]) => ({
    id: `${from}|AT|${to}`,
    from,
    to,
    rel: 'AT' as const,
  }))
  const edgeById = new Map(edges.map((e) => [e.id, e]))
  const incident = new Map<string, string[]>()
  for (const e of edges) {
    for (const end of [e.from, e.to]) {
      byId.get(end)!.degree += 1
      const list = incident.get(end)
      if (list) list.push(e.id)
      else incident.set(end, [e.id])
    }
  }
  return { nodes, edges, byId, edgeById, incident }
}

const base = () =>
  makeGraph(
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    [
      ['a', 'b'],
      ['b', 'c'],
    ],
  )

const keyOf = (graph: Graph) => structureOf(graph).key

describe('what does not move the layout', () => {
  it('gives two readings of the same records the same key', () => {
    // The commit case: `useGraph()` hands back a new object every time and
    // `buildGraph` builds new nodes from it. Nothing about the shape changed.
    expect(keyOf(base())).toBe(keyOf(base()))
    // …and they really are different objects, or this asserts nothing.
    expect(base()).not.toBe(base())
    expect(base().nodes[0]).not.toBe(base().nodes[0])
  })

  it('ignores a record being renamed or re-described', () => {
    const renamed = makeGraph(
      [{ id: 'a', label: 'Rice — Statistics', detail: 'Houston' }, { id: 'b' }, { id: 'c' }],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    )
    expect(keyOf(renamed)).toBe(keyOf(base()))
  })
})

describe('what does move it', () => {
  it('notices a record arriving', () => {
    const grown = makeGraph(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    )
    expect(keyOf(grown)).not.toBe(keyOf(base()))
  })

  it('notices a record leaving', () => {
    const shrunk = makeGraph([{ id: 'a' }, { id: 'b' }], [['a', 'b']])
    expect(keyOf(shrunk)).not.toBe(keyOf(base()))
  })

  it('notices a connection appearing between two records that are already there', () => {
    const joined = makeGraph(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['a', 'c'],
      ],
    )
    expect(keyOf(joined)).not.toBe(keyOf(base()))
  })

  it('notices the connections being rearranged between the same records', () => {
    // Isolates the links from everything else: same ids in the same order, and
    // every node has exactly one connection either way, so the node half of the
    // key is identical and only the pairing differs.
    const pairs = (links: [string, string][]) =>
      makeGraph([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], links)
    const across = pairs([
      ['a', 'b'],
      ['c', 'd'],
    ])
    const crossed = pairs([
      ['a', 'c'],
      ['b', 'd'],
    ])
    expect(structureOf(across).spec).toEqual(structureOf(crossed).spec)
    expect(keyOf(across)).not.toBe(keyOf(crossed))
  })

  it('notices the same records arriving in a different order', () => {
    // The ids ARE the simulation's indices, and the seeded spiral is a function
    // of the index — so a reordered list is a different starting layout even
    // though it is the same set. Asserted on a graph with no edges, because with
    // edges the link indices move too and would carry the assertion on their
    // own: the point here is that the node half of the key is ordered.
    const loose = (ids: string[]) => makeGraph(ids.map((id) => ({ id })), [])
    expect(keyOf(loose(['c', 'b', 'a']))).not.toBe(keyOf(loose(['a', 'b', 'c'])))
  })

  it('notices a degree the drawn size cannot show, which the legend produces', () => {
    /*
     * Degree is not derivable from the links here, and this is the case that
     * proves it: `filterGraph` drops the hidden nodes' EDGES and keeps the
     * surviving nodes' `degree`, which was counted over the whole graph. So two
     * legend states can show the same two records joined the same way with the
     * hub carrying a different degree — and the simulation lays them out
     * differently, because `mass` is `1 + degree * 0.35`.
     *
     * `nodeRadius` saturates at 17, so above about 23 connections the radius
     * cannot tell them apart either. A key built from ids and links alone, or
     * from ids and radius alone, calls these two identical.
     */
    const hubWith = (spokes: number) => {
      const others = Array.from({ length: spokes }, (_, i) => ({ id: `x${i}` }))
      const whole = makeGraph(
        [{ id: 'hub' }, ...others],
        others.map((o) => ['hub', o.id] as [string, string]),
      )
      return filterGraph(whole, (n) => n.id === 'hub' || n.id === 'x0' || n.id === 'x1')
    }
    const fewer = hubWith(23)
    const more = hubWith(24)

    // The premise, both halves: same visible shape, same drawn size.
    expect(structureOf(fewer).links).toEqual(structureOf(more).links)
    expect(nodeRadius(fewer.byId.get('hub')!.degree)).toBe(
      nodeRadius(more.byId.get('hub')!.degree),
    )
    expect(fewer.byId.get('hub')!.degree).not.toBe(more.byId.get('hub')!.degree)

    expect(keyOf(fewer)).not.toBe(keyOf(more))
  })
})

describe('the links the simulation is handed', () => {
  it('resolves each edge to the two indices its ends sit at', () => {
    const { links, index } = structureOf(base())
    expect(index.get('a')).toBe(0)
    expect(links).toEqual([
      { a: 0, b: 1 },
      { a: 1, b: 2 },
    ])
  })

  it('drops an edge whose end is not in the drawn set rather than pointing it at index 0', () => {
    // `filterGraph` hides node types without rewriting the edges, so this is the
    // ordinary case for a legend toggle — and `?? -1` on a missing index would
    // have tied every hidden record's edges to whichever node happened to be
    // drawn first.
    const graph = base()
    const dangling: Graph = {
      ...graph,
      edges: [...graph.edges, { id: 'a|AT|gone', from: 'a', to: 'gone', rel: 'AT' }],
    }
    expect(structureOf(dangling).links).toEqual(structureOf(graph).links)
  })

  it('reads a radius for every node, so nothing is laid out at size zero', () => {
    for (const node of structureOf(base()).spec) expect(node.radius).toBeGreaterThan(0)
    expect(structureOf(base()).spec).toHaveLength(3)
  })
})
