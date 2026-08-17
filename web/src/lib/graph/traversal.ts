/**
 * Walking a built graph: what touches a node, what lies between two of them,
 * and what is left when a kind of node is hidden.
 *
 * Everything here is undirected, for the reason `GRAPH_RELS` gives: stored
 * direction is a spelling convenience, not a claim about which way a question
 * may be asked.
 *
 * These are `kg/core/algebra.ts`'s functions, re-exported at the concrete graph
 * type. This file used to hold its own copy of all five, which is the exact
 * outcome `algebra.ts`'s own header was written to prevent — it explains that it
 * is generic rather than fixed to `StoredNode` precisely so that
 * "`lib/graph/traversal.ts` [does not keep] a second copy of the BFS for the
 * only graph anyone actually looks at — which is the copy that would drift."
 * The second copy existed anyway, with a second set of tests, and nothing but
 * habit keeping the two in step.
 *
 * The delegation needs no adapter: `IndexedGraph` was already shaped so that a
 * filtered graph is assignable straight back to `Graph` in `./model`, and the
 * generic parameters infer from the argument at every call site.
 */

export {
  filterGraph,
  incidentEdges,
  neighbourhood,
  otherEnd,
  shortestPath,
} from '@jojo/service/core/algebra'
