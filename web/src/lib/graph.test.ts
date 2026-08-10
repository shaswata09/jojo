/**
 * Characterisation tests: the traversal contract `src/kg/core/algebra.ts` has
 * to inherit when `graph.ts` is demoted to a reading of the snapshot.
 *
 * Topologies are built by hand rather than through `buildGraph`, so a failure
 * points at the traversal rather than at a change in the seed fixtures.
 */

import { describe, expect, it } from 'vitest'
import type { Graph, GraphEdge, GraphNode, GraphRel } from '@/lib/graph'
import { filterGraph, shortestPath } from '@/lib/graph'

/** Mirrors `buildGraph`'s indexes, including degree counted over EVERY edge. */
function makeGraph(ids: readonly string[], links: readonly [string, string][]): Graph {
  const nodes: GraphNode[] = ids.map((id) => ({
    id,
    type: 'application',
    label: id,
    recordId: id,
    degree: 0,
  }))
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const rel: GraphRel = 'AT'
  const edges: GraphEdge[] = links.map(([from, to]) => ({
    id: `${from}|${rel}|${to}`,
    from,
    to,
    rel,
  }))
  const edgeById = new Map(edges.map((e) => [e.id, e]))

  const incident = new Map<string, string[]>()
  for (const edge of edges) {
    for (const end of [edge.from, edge.to]) {
      const node = byId.get(end)
      if (node) node.degree += 1
      const list = incident.get(end)
      if (list) list.push(edge.id)
      else incident.set(end, [edge.id])
    }
  }

  return { nodes, edges, byId, edgeById, incident }
}

const idsOf = (r: { nodes: GraphNode[] } | null) => r?.nodes.map((n) => n.id) ?? null

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
})
