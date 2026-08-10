/**
 * L1 — neighbours, shortestPath, subgraphOf, filterGraph. Lifted from src/lib/graph.ts.
 *
 * Edges are stored directed and traversed both ways by default: someone asking
 * what connects two records does not hold a direction in their head, and a query
 * that walked one way would answer half the question while looking like it had
 * answered all of it.
 *
 * `filterGraph` leaves `degree` at its whole-graph value on purpose — it is a
 * property of the record, not of the view. See src/lib/graph.test.ts, which pins
 * this so nobody "fixes" it.
 *
 * Generic over the node and edge shape rather than typed to `StoredNode`.
 * `/graph` traverses a graph that has role and source nodes in it, which are
 * synthesised for the view and never stored, and it carries `label`, `href` and
 * `degree` on every node. Fixing this file to the stored shape would mean
 * `lib/graph.ts` keeping a second copy of the BFS for the only graph anyone
 * actually looks at — which is the copy that would drift.
 */

/** The two fields traversal needs. Everything else is the caller's business. */
export type GraphNodeLike = { id: string }

export type GraphEdgeLike = { id: string; from: string; to: string }

export type ReadableGraph<N extends GraphNodeLike, E extends GraphEdgeLike> = {
  nodes: readonly N[]
  edges: readonly E[]
  byId: ReadonlyMap<string, N>
  edgeById: ReadonlyMap<string, E>
  /** Node id -> the ids of every edge touching it. */
  incident: ReadonlyMap<string, readonly string[]>
}

/**
 * The same shape with mutable containers, so a filtered graph is assignable
 * straight back to `lib/graph.ts`'s `Graph` without a cast at the call site.
 */
export type IndexedGraph<N extends GraphNodeLike, E extends GraphEdgeLike> = {
  nodes: N[]
  edges: E[]
  byId: Map<string, N>
  edgeById: Map<string, E>
  incident: Map<string, string[]>
}

export function incidentEdges<N extends GraphNodeLike, E extends GraphEdgeLike>(
  graph: ReadableGraph<N, E>,
  nodeId: string,
): E[] {
  const ids = graph.incident.get(nodeId) ?? []
  return ids.map((id) => graph.edgeById.get(id)).filter((e): e is E => e !== undefined)
}

/** The other end of an edge, whichever end you came in on. */
export const otherEnd = (edge: GraphEdgeLike, nodeId: string) =>
  edge.from === nodeId ? edge.to : edge.from

export function neighbours<N extends GraphNodeLike, E extends GraphEdgeLike>(
  graph: ReadableGraph<N, E>,
  nodeId: string,
): N[] {
  return incidentEdges(graph, nodeId)
    .map((edge) => graph.byId.get(otherEnd(edge, nodeId)))
    .filter((n): n is N => n !== undefined)
}

/** A node, everything one hop from it, and the edges between — for hover. */
export function neighbourhood<N extends GraphNodeLike, E extends GraphEdgeLike>(
  graph: ReadableGraph<N, E>,
  nodeId: string,
): { nodes: Set<string>; edges: Set<string> } {
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
 *
 * Ties between two equal routes are broken by edge insertion order, which makes
 * the answer stable rather than arbitrary; `graph.test.ts` pins the diamond case
 * so a change of index structure cannot quietly reverse it.
 */
export function shortestPath<N extends GraphNodeLike, E extends GraphEdgeLike>(
  graph: ReadableGraph<N, E>,
  fromId: string,
  toId: string,
): { nodes: N[]; edges: E[] } | null {
  if (!graph.byId.has(fromId) || !graph.byId.has(toId)) return null
  if (fromId === toId) {
    const node = graph.byId.get(fromId)
    return node ? { nodes: [node], edges: [] } : null
  }

  const cameFrom = new Map<string, { node: string; edge: E }>()
  const seen = new Set<string>([fromId])
  const queue: string[] = [fromId]

  while (queue.length > 0) {
    // The queue is non-empty by the loop condition, but `shift()` is typed as
    // possibly-undefined and `noUncheckedIndexedAccess` will not take the
    // programmer's word for it.
    const current = queue.shift()
    if (current === undefined) break

    for (const edge of incidentEdges(graph, current)) {
      const next = otherEnd(edge, current)
      if (seen.has(next)) continue
      seen.add(next)
      cameFrom.set(next, { node: current, edge })

      if (next === toId) {
        const nodeIds: string[] = [toId]
        const edgeList: E[] = []
        let cursor = toId
        while (cursor !== fromId) {
          const step = cameFrom.get(cursor)
          if (!step) return null
          edgeList.unshift(step.edge)
          nodeIds.unshift(step.node)
          cursor = step.node
        }
        return {
          nodes: nodeIds.map((id) => graph.byId.get(id)).filter((n): n is N => n !== undefined),
          edges: edgeList,
        }
      }

      queue.push(next)
    }
  }

  return null
}

/** The nodes named, plus every edge with both ends inside the set. */
export function subgraphOf<N extends GraphNodeLike, E extends GraphEdgeLike>(
  graph: ReadableGraph<N, E>,
  nodeIds: Iterable<string>,
): { nodes: N[]; edges: E[] } {
  const keep = new Set(nodeIds)
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
  }
}

/**
 * A graph with some node types hidden.
 *
 * `degree` is deliberately untouched: it is a property of the record, and a node
 * that shrank because you hid one legend row would be telling you about the
 * filter rather than about the data. Nothing here recounts it — the node objects
 * are passed through by reference, so whatever the whole graph said they still
 * say.
 */
export function filterGraph<N extends GraphNodeLike, E extends GraphEdgeLike>(
  graph: ReadableGraph<N, E>,
  keep: (node: N) => boolean,
): IndexedGraph<N, E> {
  const nodes = graph.nodes.filter(keep)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  // An edge with one end hidden goes entirely. Kept, it would render as a line
  // running off into empty space, which reads as a broken layout rather than as
  // a hidden record.
  const edges = graph.edges.filter((e) => byId.has(e.from) && byId.has(e.to))
  const edgeById = new Map(edges.map((e) => [e.id, e]))

  return { nodes, edges, byId, edgeById, incident: indexIncident(edges) }
}

/** Node id -> incident edge ids, in the order the edges were given. */
export function indexIncident<E extends GraphEdgeLike>(edges: readonly E[]): Map<string, string[]> {
  const incident = new Map<string, string[]>()

  const add = (end: string, id: string) => {
    const list = incident.get(end)
    if (list) list.push(id)
    else incident.set(end, [id])
  }

  for (const edge of edges) {
    add(edge.from, edge.id)
    // A self-edge is listed once, not twice. `buildGraph` rejected them outright
    // so the case never arose; listed twice, `neighbours` would report the node
    // as its own neighbour and `degree` would count one edge as two.
    if (edge.to !== edge.from) add(edge.to, edge.id)
  }

  return incident
}
