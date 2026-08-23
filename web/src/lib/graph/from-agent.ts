import type { GraphQueryResult } from '@jojo/service/agent/graph-query'
import type { Graph, GraphNode, GraphRel } from '@/lib/graph/model'
import type { QueryResult, QueryRow } from '@/lib/graph/query'

/**
 * A shared query answer, drawn on this app's canvas.
 *
 * `kg/agent/graph-query.ts` runs against the kg graph rather than against either
 * app's drawing, and explains why: web draws `organisation`, `role` and
 * `source`, mobile draws `org` and neither of the others, and a query language
 * defined over a picture answers different questions on a phone. So the engine
 * is shared and the crossing back is per-app — this is web's half of it.
 *
 * The crossing is cheap here because `build.ts` sets `id: node.id`: a web graph
 * node's id IS the kg node's id, so nothing has to be looked up by name. Mobile
 * pays a little more, because its ids are `${type}:${recordId}` and its
 * organisations are keyed by name rather than by record.
 *
 * Nodes the canvas does not draw are dropped rather than faked. A `pipeline` has
 * no node in this graph, and inventing one so a row has somewhere to point would
 * put a record on screen that the picture does not otherwise contain.
 */
export function toQueryResult(graph: Graph, answer: GraphQueryResult): QueryResult {
  const rows: QueryRow[] = []
  for (const row of answer.rows) {
    const node = graph.byId.get(row.record.id)
    if (!node) continue
    const matched = row.matched
      .map((m) => graph.byId.get(m.id))
      .filter((n): n is GraphNode => n !== undefined)
    rows.push({
      node,
      matched,
      count: row.count,
      ...(row.via ? { via: row.via as GraphRel } : {}),
    })
  }

  const nodes = new Set(answer.highlight.filter((id) => graph.byId.has(id)))
  // Every edge with both ends lit. Derived rather than carried across, because
  // the two apps disagree about which edges exist at all — web synthesises an
  // `IS` edge to a role node that the kg graph has never heard of.
  const edges = new Set(
    graph.edges.filter((e) => nodes.has(e.from) && nodes.has(e.to)).map((e) => e.id),
  )

  return {
    rows,
    nodes,
    edges,
    countLabel: 'Matches',
    // The engine's own sentence, which already says what was asked in the terms
    // it was asked in. A generic "nothing matched" here would throw that away.
    emptyNote: answer.summary,
  }
}
