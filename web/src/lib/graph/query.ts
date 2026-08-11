/**
 * The query engine behind "Ask the graph".
 *
 * Two shapes of question, and nothing else: a pattern (records of one kind that
 * have, lack, or have several of some relationship) and a path (how two records
 * are joined). Both answer with the same `QueryResult`, so the table and the
 * highlighted subgraph beside it are two readings of one object rather than two
 * calculations that can disagree.
 *
 * Pure, like everything else here — it takes a built graph and returns rows.
 */

import type { TimelineKind } from '@/data/timeline'
import type { Graph, GraphEdge, GraphNode, GraphNodeType, GraphRel } from '@/lib/graph/model'
import { incidentEdges, otherEnd, shortestPath } from '@/lib/graph/traversal'

/**
 * The extra axis timeline items need.
 *
 * "Applications with no follow-up scheduled" and "reminders not linked to any
 * application" are the two questions a job-seeker actually asks, and neither is
 * expressible in node types alone: a follow-up is a `kind`, a reminder is a
 * flag. Every other node type ignores this.
 */
export type ItemFacet = 'any' | 'reminder' | TimelineKind

export const ITEM_FACETS: ItemFacet[] = [
  'any',
  'reminder',
  'deadline',
  'interview',
  'visit',
  'call',
  'prep',
  'admin',
  'follow-up',
]

export type Quantifier = 'has' | 'missing' | 'atLeast'

export type PatternQuery = {
  kind: 'pattern'
  start: GraphNodeType | 'any'
  startFacet?: ItemFacet
  quantifier: Quantifier
  /** Only for `atLeast`. Ignored otherwise. */
  atLeast?: number
  rel: GraphRel | 'any'
  end: GraphNodeType | 'any'
  endFacet?: ItemFacet
  /** Narrows the starting set to records carrying this keyword node. */
  keywordId?: string
}

export type PathQuery = {
  kind: 'path'
  from: string
  to: string
}

export type GraphQuery = PatternQuery | PathQuery

export type QueryRow = {
  node: GraphNode
  /** What it matched on. Empty for a `missing` query — that is the point. */
  matched: GraphNode[]
  count: number
  /** Path queries only: the relationship that got you to this node. */
  via?: GraphRel
}

export type QueryResult = {
  rows: QueryRow[]
  /** Node ids to keep lit in the visualisation. */
  nodes: Set<string>
  /** Edge ids to keep lit. */
  edges: Set<string>
  /** What the numbers in the table count, for the column header. */
  countLabel: string
  /** Said in the result panel when nothing matched, in the question's own words. */
  emptyNote: string
}

const EMPTY_RESULT: QueryResult = {
  rows: [],
  nodes: new Set(),
  edges: new Set(),
  countLabel: 'Matches',
  emptyNote: 'Nothing in your records matches that pattern.',
}

function matchesFacet(node: GraphNode, facet: ItemFacet | undefined): boolean {
  if (!facet || facet === 'any') return true
  if (node.type !== 'item') return true
  if (facet === 'reminder') return node.reminder === true
  return node.itemKind === facet
}

const matchesType = (node: GraphNode, type: GraphNodeType | 'any', facet?: ItemFacet) =>
  (type === 'any' || node.type === type) && matchesFacet(node, facet)

export function runQuery(graph: Graph, query: GraphQuery): QueryResult {
  if (query.kind === 'path') return runPath(graph, query)
  return runPattern(graph, query)
}

function runPattern(graph: Graph, query: PatternQuery): QueryResult {
  const threshold = query.quantifier === 'atLeast' ? Math.max(2, query.atLeast ?? 2) : 1

  const carriesKeyword = (node: GraphNode) => {
    if (!query.keywordId) return true
    return incidentEdges(graph, node.id).some(
      (edge) => edge.rel === 'TAGS' && otherEnd(edge, node.id) === query.keywordId,
    )
  }

  const rows: QueryRow[] = []
  const nodes = new Set<string>()
  const edges = new Set<string>()

  for (const node of graph.nodes) {
    if (!matchesType(node, query.start, query.startFacet)) continue
    // A keyword node matching its own TAGS pattern is a tautology, and it
    // crowds the answer to "everything tagged Referral" with Referral itself.
    if (query.keywordId && node.id === query.keywordId) continue
    if (!carriesKeyword(node)) continue

    const hits: { node: GraphNode; edge: GraphEdge }[] = []
    for (const edge of incidentEdges(graph, node.id)) {
      if (query.rel !== 'any' && edge.rel !== query.rel) continue
      const other = graph.byId.get(otherEnd(edge, node.id))
      if (!other || !matchesType(other, query.end, query.endFacet)) continue
      hits.push({ node: other, edge })
    }

    const passes = query.quantifier === 'missing' ? hits.length === 0 : hits.length >= threshold
    if (!passes) continue

    rows.push({ node, matched: hits.map((h) => h.node), count: hits.length })
    nodes.add(node.id)
    for (const hit of hits) {
      nodes.add(hit.node.id)
      edges.add(hit.edge.id)
    }
  }

  // Most connected first for a positive query, alphabetical for a negative one:
  // when every row counts zero, a count sort is a coin toss dressed as ranking.
  rows.sort((a, b) =>
    query.quantifier === 'missing'
      ? a.node.label.localeCompare(b.node.label)
      : b.count - a.count || a.node.label.localeCompare(b.node.label),
  )

  return {
    rows,
    nodes,
    edges,
    countLabel: query.quantifier === 'missing' ? 'Connections' : 'Matches',
    emptyNote:
      query.quantifier === 'missing'
        ? 'Nothing is missing that connection — every record of this kind has one.'
        : 'Nothing in your records matches that pattern.',
  }
}

function runPath(graph: Graph, query: PathQuery): QueryResult {
  const path = shortestPath(graph, query.from, query.to)
  if (!path) {
    return {
      ...EMPTY_RESULT,
      nodes: new Set(),
      edges: new Set(),
      countLabel: 'Hops',
      emptyNote: 'No path — these two records are not connected by anything in your store.',
    }
  }

  const rows: QueryRow[] = path.nodes.map((node, i) => ({
    node,
    matched: i < path.nodes.length - 1 ? [path.nodes[i + 1]] : [],
    count: i,
    via: i === 0 ? undefined : path.edges[i - 1].rel,
  }))

  return {
    rows,
    nodes: new Set(path.nodes.map((n) => n.id)),
    edges: new Set(path.edges.map((e) => e.id)),
    countLabel: 'Hop',
    emptyNote: 'No path between those two records.',
  }
}
