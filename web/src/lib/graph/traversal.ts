/**
 * Walking a built graph: what touches a node, what lies between two of them,
 * and what is left when a kind of node is hidden.
 *
 * Everything here is undirected, for the reason `GRAPH_RELS` gives: stored
 * direction is a spelling convenience, not a claim about which way a question
 * may be asked.
 */

import type { Graph, GraphEdge, GraphNode } from '@/lib/graph/model'

export function incidentEdges(graph: Graph, nodeId: string): GraphEdge[] {
  const ids = graph.incident.get(nodeId) ?? []
  return ids.map((id) => graph.edgeById.get(id)).filter((e): e is GraphEdge => e !== undefined)
}

/** The other end of an edge, whichever end you came in on. */
export const otherEnd = (edge: GraphEdge, nodeId: string) =>
  edge.from === nodeId ? edge.to : edge.from

/** A node, everything one hop from it, and the edges between — for hover. */
export function neighbourhood(graph: Graph, nodeId: string) {
  const nodes = new Set<string>([nodeId])
  const edges = new Set<string>()
  for (const edge of incidentEdges(graph, nodeId)) {
    nodes.add(otherEnd(edge, nodeId))
    edges.add(edge.id)
  }
  return { nodes, edges }
}

/**
 * Fewest hops between two records, ignoring direction.
 *
 * Breadth-first, so the first time a node is reached is by a shortest route and
 * no queue of candidate paths has to be kept. Returns null when the two sit in
 * unconnected components — which is a real answer worth showing, not an error.
 */
export function shortestPath(
  graph: Graph,
  fromId: string,
  toId: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } | null {
  if (!graph.byId.has(fromId) || !graph.byId.has(toId)) return null
  if (fromId === toId) {
    const node = graph.byId.get(fromId)
    return node ? { nodes: [node], edges: [] } : null
  }

  const cameFrom = new Map<string, { node: string; edge: GraphEdge }>()
  const seen = new Set<string>([fromId])
  const queue: string[] = [fromId]

  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const edge of incidentEdges(graph, current)) {
      const next = otherEnd(edge, current)
      if (seen.has(next)) continue
      seen.add(next)
      cameFrom.set(next, { node: current, edge })
      if (next === toId) {
        const nodeIds: string[] = [toId]
        const edgeList: GraphEdge[] = []
        let cursor = toId
        while (cursor !== fromId) {
          const step = cameFrom.get(cursor)
          if (!step) return null
          edgeList.unshift(step.edge)
          nodeIds.unshift(step.node)
          cursor = step.node
        }
        return {
          nodes: nodeIds
            .map((id) => graph.byId.get(id))
            .filter((n): n is GraphNode => n !== undefined),
          edges: edgeList,
        }
      }
      queue.push(next)
    }
  }

  return null
}

/**
 * A graph with some node types hidden.
 *
 * `degree` is deliberately left at its full-graph value: it is a property of
 * the record, and a node that shrank because you hid one legend row would be
 * telling you about the filter rather than about the data.
 */
export function filterGraph(graph: Graph, keep: (node: GraphNode) => boolean): Graph {
  const nodes = graph.nodes.filter(keep)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges = graph.edges.filter((e) => byId.has(e.from) && byId.has(e.to))
  const edgeById = new Map(edges.map((e) => [e.id, e]))

  const incident = new Map<string, string[]>()
  for (const edge of edges) {
    for (const end of [edge.from, edge.to]) {
      const list = incident.get(end)
      if (list) list.push(edge.id)
      else incident.set(end, [edge.id])
    }
  }

  return { nodes, edges, byId, edgeById, incident }
}
