import type { GraphQueryResult } from '@jojo/service/agent/graph-query'
import type { Graph, GraphNode } from '@/lib/graph'

/**
 * A shared query answer, mapped onto this app's smaller canvas.
 *
 * `kg/agent/graph-query.ts` runs against the kg graph rather than either app's
 * drawing, and explains why: this one has `org` and no `role` or `source`
 * because a 390pt canvas has room for neither, and a query language defined over
 * a picture would answer different questions on a phone.
 *
 * The crossing costs more here than on the web, where a graph node's id IS the
 * kg node's id. This app's ids are `${type}:${recordId}`, so records match on
 * `recordId` — and organisations do not match at all, because `graph.ts` keys
 * them by NAME (`add('org', a.org, a.org)`) rather than by record: there is no
 * organisation id on this side to match against. The label is what they have in
 * common, and `labelOf` renders an organisation as exactly its name, so the
 * second pass catches them. Two ways in rather than one, because a query about
 * employers that lit every application and no employer would look broken.
 */
export function highlightFor(graph: Graph, answer: GraphQueryResult): Set<string> {
  const ids = new Set<string>(answer.highlight)
  const labels = new Set<string>()
  for (const row of answer.rows) {
    labels.add(row.record.label)
    for (const m of row.matched) labels.add(m.label)
  }
  const lit = new Set<string>()
  for (const node of graph.nodes) {
    if (ids.has(node.recordId) || labels.has(node.label)) lit.add(node.id)
  }
  return lit
}

/** The rows, as this app's nodes, in the order the engine returned them. */
export function rowsFor(graph: Graph, answer: GraphQueryResult): GraphNode[] {
  const out: GraphNode[] = []
  for (const row of answer.rows) {
    const node =
      graph.nodes.find((n) => n.recordId === row.record.id) ??
      graph.nodes.find((n) => n.label === row.record.label)
    // Dropped rather than faked: a `pipeline` has no node in this graph, and
    // inventing one so a row has somewhere to point would put a record on screen
    // that the picture does not otherwise contain.
    if (node) out.push(node)
  }
  return out
}
