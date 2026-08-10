/**
 * The Wave 0 characterisation tests, re-pointed at the layer that inherits them.
 *
 * `src/lib/graph.test.ts` pins the same five topologies against `graph.ts`.
 * These are the same assertions against `algebra.ts`, deliberately duplicated
 * rather than shared: for as long as both implementations exist, the pair is the
 * proof that the move preserved the contract, and the day `graph.ts` starts
 * calling this file the duplication becomes one test of one function.
 */

import { describe, expect, it } from 'vitest'
import type { GraphEdgeLike, GraphNodeLike, ReadableGraph } from './algebra'
import { filterGraph, indexIncident, neighbours, shortestPath, subgraphOf } from './algebra'

type Node = GraphNodeLike & { degree: number }
type Edge = GraphEdgeLike & { rel: string }

/** Mirrors `buildGraph`'s indexes, including degree counted over EVERY edge. */
function makeGraph(
  ids: readonly string[],
  links: readonly [string, string][],
): ReadableGraph<Node, Edge> {
  const nodes: Node[] = ids.map((id) => ({ id, degree: 0 }))
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const edges: Edge[] = links.map(([from, to]) => ({ id: `${from}|AT|${to}`, from, to, rel: 'AT' }))
  const edgeById = new Map(edges.map((e) => [e.id, e]))

  for (const edge of edges) {
    for (const end of [edge.from, edge.to]) {
      const node = byId.get(end)
      if (node) node.degree += 1
    }
  }

  return { nodes, edges, byId, edgeById, incident: indexIncident(edges) }
}

const idsOf = (r: { nodes: Node[] } | null) => r?.nodes.map((n) => n.id) ?? null

describe('shortestPath', () => {
  // Two components is a real answer worth rendering, not an error. A thrown
  // exception here would blank the /graph route on a perfectly valid question.
  it('returns null across disconnected components', () => {
    const g = makeGraph(
      ['a', 'b', 'x', 'y'],
      [
        ['a', 'b'],
        ['x', 'y'],
      ],
    )
    expect(shortestPath(g, 'a', 'x')).toBeNull()
  })

  it('returns null when either end is not in the graph', () => {
    const g = makeGraph(['a', 'b'], [['a', 'b']])
    expect(shortestPath(g, 'a', 'ghost')).toBeNull()
    expect(shortestPath(g, 'ghost', 'a')).toBeNull()
  })

  // A node is trivially connected to itself: one node, zero edges. Falling into
  // the BFS instead would walk out and back and report a 2-hop path through a
  // neighbour, which draws a loop that is not in the data.
  it('answers a self-query with the node alone and no edges', () => {
    const g = makeGraph(['a', 'b'], [['a', 'b']])
    const path = shortestPath(g, 'a', 'a')
    expect(idsOf(path)).toEqual(['a'])
    expect(path?.edges).toEqual([])
  })

  // Diamond: a→b→d and a→c→d. Both routes are two hops, and the tie is broken
  // by edge insertion order, so the answer is stable rather than arbitrary.
  it('takes the shortest of two equal routes, breaking the tie by insertion order', () => {
    const g = makeGraph(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b'],
        ['a', 'c'],
        ['b', 'd'],
        ['c', 'd'],
      ],
    )
    const path = shortestPath(g, 'a', 'd')
    expect(idsOf(path)).toEqual(['a', 'b', 'd'])
    expect(path?.edges).toHaveLength(2)
  })

  // Every edge is stored directed but traversed both ways: someone asking what
  // connects two records does not hold a direction in their head.
  it('walks edges against their direction', () => {
    const g = makeGraph(
      ['a', 'b', 'c'],
      [
        ['b', 'a'],
        ['c', 'b'],
      ],
    )
    expect(idsOf(shortestPath(g, 'a', 'c'))).toEqual(['a', 'b', 'c'])
  })
})

describe('filterGraph', () => {
  /**
   * `degree` is deliberately the WHOLE-graph value, per graph.ts:462-468.
   *
   * It sizes the node, and it is a property of the record rather than of the
   * view: recounting it after a filter would make a node shrink because you hid
   * an unrelated legend row, telling the user about their filter while looking
   * like it was telling them about their data. This test exists to stop someone
   * "fixing" that.
   */
  it('keeps degree at its full-graph value', () => {
    const g = makeGraph(
      ['hub', 'keep', 'drop'],
      [
        ['hub', 'keep'],
        ['hub', 'drop'],
      ],
    )
    expect(g.byId.get('hub')?.degree).toBe(2)

    const filtered = filterGraph(g, (n) => n.id !== 'drop')
    expect(filtered.nodes.map((n) => n.id)).toEqual(['hub', 'keep'])
    expect(filtered.byId.get('hub')?.degree).toBe(2)
  })

  // An edge with one end hidden is dropped entirely — kept, it would render as
  // a line running off into empty space, which reads as a broken layout.
  it('drops every edge with a hidden end and reindexes what is left', () => {
    const g = makeGraph(
      ['hub', 'keep', 'drop'],
      [
        ['hub', 'keep'],
        ['hub', 'drop'],
      ],
    )
    const filtered = filterGraph(g, (n) => n.id !== 'drop')

    expect(filtered.edges.map((e) => e.id)).toEqual(['hub|AT|keep'])
    expect(filtered.incident.get('hub')).toEqual(['hub|AT|keep'])
    expect(filtered.incident.has('drop')).toBe(false)
    expect(filtered.edgeById.has('hub|AT|drop')).toBe(false)
  })

  // The node objects are passed through by reference, not copied. A filter that
  // rebuilt them would break `React.memo` on every card in the visualisation
  // the moment a legend row was toggled.
  it('passes node objects through by reference', () => {
    const g = makeGraph(['a', 'b'], [['a', 'b']])
    const filtered = filterGraph(g, () => true)
    expect(filtered.byId.get('a')).toBe(g.byId.get('a'))
  })
})

describe('neighbours and subgraphOf', () => {
  it('walks both ways out of one node', () => {
    const g = makeGraph(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['c', 'a'],
      ],
    )
    expect(neighbours(g, 'a').map((n) => n.id)).toEqual(['b', 'c'])
  })

  it('keeps only the edges with both ends inside the set', () => {
    const g = makeGraph(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    )
    const sub = subgraphOf(g, ['a', 'b'])
    expect(sub.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(sub.edges.map((e) => e.id)).toEqual(['a|AT|b'])
  })
})

describe('indexIncident', () => {
  // buildGraph rejected self-edges outright, so this case never arose there.
  // Listed twice, `neighbours` would report a node as its own neighbour.
  it('lists a self-edge once', () => {
    const incident = indexIncident([{ id: 'a|AT|a', from: 'a', to: 'a', rel: 'AT' }])
    expect(incident.get('a')).toEqual(['a|AT|a'])
  })
})
