import type { Palette } from '@/theme/tokens'
/**
 * The records you already have, as the network they actually are.
 *
 * The real product keeps everything in a graph rather than in seven lists, and
 * this is the argument for that. Nothing here is a new dataset: every node and
 * edge is derived from the session store on every render, so a record deleted on
 * the board is gone from the canvas before you get back to it.
 *
 * A deliberately smaller build than the web version's. That one carries a force
 * solver and a visual query builder; a 390pt canvas has room for neither, so
 * this keeps the model — the node types, the relationships and the questions
 * only a graph can answer — and lays it out radially instead of simulating it.
 */

import type { Label } from '@/data/labels'
import type { Match, SavedPosting } from '@/data/scout'
import type { Application } from '@/data/seed'
import { displayName } from '@/data/seed'
import type { TimelineItem } from '@/data/timeline'
import type { Snippet, VaultFile, VaultLink } from '@/data/vault'

export const GRAPH_NODE_TYPES = [
  'application',
  'org',
  'role',
  'item',
  'file',
  'link',
  'snippet',
  'posting',
  'match',
  'keyword',
] as const

export type GraphNodeType = (typeof GRAPH_NODE_TYPES)[number]

export const NODE_TYPE_LABEL: Record<GraphNodeType, string> = {
  application: 'Application',
  org: 'Employer',
  role: 'Role',
  item: 'Date or reminder',
  file: 'File',
  link: 'Link',
  snippet: 'Snippet',
  posting: 'Saved posting',
  match: 'Match',
  keyword: 'Keyword',
}

/** How one node is joined to another. Read as `<from> —REL→ <to>`. */
export const GRAPH_RELS = ['AT', 'IS', 'ABOUT', 'FILED_UNDER', 'TAGS', 'FROM'] as const
export type GraphRel = (typeof GRAPH_RELS)[number]

export const REL_LABEL: Record<GraphRel, string> = {
  AT: 'is at',
  IS: 'is a',
  ABOUT: 'is about',
  FILED_UNDER: 'is filed under',
  TAGS: 'tags',
  FROM: 'came from',
}

export type GraphNode = {
  id: string
  type: GraphNodeType
  label: string
  /** One line of context under the name in the detail panel. */
  detail?: string
  /** The record this node stands for, so a tap can open the real thing. */
  recordId: string
  degree: number
}

export type GraphEdge = { from: string; to: string; rel: GraphRel }

export type Graph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  byId: Map<string, GraphNode>
}

/**
 * Six records in the seed answer to 'stripe' — an application, a deadline, a
 * pipeline, a posting and two more — so a node id has to carry its type.
 */
export const graphNodeId = (type: GraphNodeType, recordId: string) => `${type}:${recordId}`

export type GraphInput = {
  applications: readonly Application[]
  timeline: readonly TimelineItem[]
  links: readonly VaultLink[]
  files: readonly VaultFile[]
  snippets: readonly Snippet[]
  postings: readonly SavedPosting[]
  matches: readonly Match[]
  labelsOf: (recordId: string) => Label[]
}

export function buildGraph(input: GraphInput): Graph {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const seen = new Set<string>()

  const add = (type: GraphNodeType, recordId: string, label: string, detail?: string) => {
    const id = graphNodeId(type, recordId)
    if (!seen.has(id)) {
      seen.add(id)
      nodes.push({ id, type, label, detail, recordId, degree: 0 })
    }
    return id
  }

  const join = (from: string, to: string, rel: GraphRel) => {
    edges.push({ from, to, rel })
  }

  /**
   * Keywords are keyed two ways in the label store — 'app:rice' for
   * applications, a bare id for everything else — so both spellings are asked
   * for and the answers merged. Reading only one would leave half the records
   * looking untagged.
   */
  const tagFrom = (nodeId: string, ...recordKeys: string[]) => {
    const labels = new Map<string, Label>()
    for (const key of recordKeys) for (const l of input.labelsOf(key)) labels.set(l.id, l)
    for (const l of labels.values()) {
      const keywordId = add('keyword', l.id, l.name)
      join(keywordId, nodeId, 'TAGS')
    }
  }

  for (const a of input.applications) {
    const appId = add('application', a.id, displayName(a), a.note)
    const orgId = add('org', a.org, a.org)
    const roleId = add('role', a.roleTag, a.roleTag)
    join(appId, orgId, 'AT')
    join(appId, roleId, 'IS')
    tagFrom(appId, `app:${a.id}`, a.id)
  }

  for (const i of input.timeline) {
    const itemId = add('item', i.id, i.title, i.detail ?? i.note)
    if (i.applicationId) join(itemId, graphNodeId('application', i.applicationId), 'ABOUT')
    tagFrom(itemId, i.id)
  }

  for (const f of input.files) {
    const id = add('file', f.id, f.name, `${f.bucket} · ${f.size}`)
    if (f.applicationId) join(id, graphNodeId('application', f.applicationId), 'FILED_UNDER')
    tagFrom(id, f.id)
  }

  for (const l of input.links) {
    const id = add('link', l.id, l.title, l.category)
    if (l.applicationId) join(id, graphNodeId('application', l.applicationId), 'FILED_UNDER')
    tagFrom(id, l.id)
  }

  for (const s of input.snippets) {
    const id = add('snippet', s.id, s.title, s.tag)
    if (s.applicationId) join(id, graphNodeId('application', s.applicationId), 'FILED_UNDER')
    tagFrom(id, s.id)
  }

  for (const p of input.postings) {
    const id = add('posting', p.id, p.title, p.url)
    if (p.applicationId) join(id, graphNodeId('application', p.applicationId), 'FROM')
  }

  for (const m of input.matches) {
    const id = add('match', m.id, m.role, `${m.fit}% fit`)
    if (m.applicationId) join(id, graphNodeId('application', m.applicationId), 'FROM')
  }

  // An edge whose other end was never built is not an edge. This can happen the
  // moment an application is deleted, because the store unlinks rather than
  // cascading and a stale id survives on the record that pointed at it.
  const live = edges.filter((e) => seen.has(e.from) && seen.has(e.to))

  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const e of live) {
    const from = byId.get(e.from)
    const to = byId.get(e.to)
    if (from) from.degree += 1
    if (to) to.degree += 1
  }

  return { nodes, edges: live, byId }
}

export const incidentEdges = (graph: Graph, nodeId: string) =>
  graph.edges.filter((e) => e.from === nodeId || e.to === nodeId)

export const otherEnd = (edge: GraphEdge, nodeId: string) =>
  edge.from === nodeId ? edge.to : edge.from

export function neighbours(graph: Graph, nodeId: string): GraphNode[] {
  const ids = new Set(incidentEdges(graph, nodeId).map((e) => otherEnd(e, nodeId)))
  return [...ids].map((id) => graph.byId.get(id)).filter((n): n is GraphNode => Boolean(n))
}

/* --------------------------------- queries -------------------------------- */

export type QueryExample = {
  id: string
  question: string
  /** Why the answer is only available once the records are a graph. */
  why: string
  run: (graph: Graph) => GraphNode[]
}

const typed = (graph: Graph, type: GraphNodeType) => graph.nodes.filter((n) => n.type === type)

const hasNeighbourOfType = (graph: Graph, node: GraphNode, type: GraphNodeType) =>
  neighbours(graph, node.id).some((n) => n.type === type)

/**
 * The questions worth asking, each answerable only across collections.
 *
 * Every one of these is a join the seven-list version cannot do at all: "which
 * applications have nothing dated against them" needs applications and the
 * timeline in the same query, and neither list knows about the other.
 */
export const QUERY_EXAMPLES: QueryExample[] = [
  {
    id: 'undated',
    question: 'Applications with nothing dated against them',
    why: 'These are invisible on the calendar and in the week ahead, however live they are.',
    run: (g) => typed(g, 'application').filter((n) => !hasNeighbourOfType(g, n, 'item')),
  },
  {
    id: 'untagged',
    question: 'Applications carrying no keyword',
    why: 'A record nobody has filed is a record no filter will ever surface.',
    run: (g) => typed(g, 'application').filter((n) => !hasNeighbourOfType(g, n, 'keyword')),
  },
  {
    id: 'orphan-files',
    question: 'Files not filed under any application',
    why: 'Documents drift; this is what says which ones nothing is pointing at.',
    run: (g) => typed(g, 'file').filter((n) => !hasNeighbourOfType(g, n, 'application')),
  },
  {
    id: 'orphan-links',
    question: 'Links not filed under any application',
    why: 'The same question for the postings and pages you saved to come back to.',
    run: (g) => typed(g, 'link').filter((n) => !hasNeighbourOfType(g, n, 'application')),
  },
  {
    id: 'busiest',
    question: 'The employers you have the most going on with',
    why: 'Counted across every collection at once — applications, dates, files and links.',
    run: (g) => [...typed(g, 'org')].sort((a, b) => b.degree - a.degree).slice(0, 5),
  },
  {
    id: 'unpromoted',
    question: 'Matches and postings that never became applications',
    why: 'Leads go stale silently; nothing in the list views ever says which.',
    run: (g) =>
      [...typed(g, 'match'), ...typed(g, 'posting')].filter(
        (n) => !hasNeighbourOfType(g, n, 'application'),
      ),
  },
]

/* ----------------------------- pattern queries ---------------------------- */

/**
 * A question built from parts rather than picked off a list.
 *
 * The examples above are fixed questions with the answer hard-coded into a
 * `run`. This is the other half the web app has and this did not: pick what you
 * are looking for, whether it has a relationship or is missing one, and what
 * sits on the other end. Three dropdowns cover every join the seven-list
 * version of this app cannot do at all.
 *
 * `'any'` on either end is not a wildcard for tidiness — it is what makes
 * "anything with no keyword on it" askable, which is the query people actually
 * want and the one a fixed list never quite has.
 */
export type Quantifier = 'has' | 'missing'

export type PatternQuery = {
  start: GraphNodeType | 'any'
  quantifier: Quantifier
  rel: GraphRel | 'any'
  end: GraphNodeType | 'any'
}

export type PatternRow = {
  node: GraphNode
  /** What it matched on. Empty for `missing` — that is the point of asking. */
  matched: GraphNode[]
}

export const DEFAULT_PATTERN: PatternQuery = {
  start: 'application',
  quantifier: 'missing',
  rel: 'any',
  end: 'item',
}

/**
 * The question in words, so the controls above it are legible.
 *
 * The web app also prints a pseudo-Cypher line beside this. Left out here: it
 * needs a monospace line the width of a phone does not have, and its whole job
 * was to teach the shape to someone who already reads query languages.
 */
export function describePattern(q: PatternQuery): string {
  const start = q.start === 'any' ? 'Anything' : `${NODE_TYPE_LABEL[q.start]}s`
  const rel = q.rel === 'any' ? 'linked to' : REL_LABEL[q.rel]
  const end = q.end === 'any' ? 'anything' : `a ${NODE_TYPE_LABEL[q.end].toLowerCase()}`
  return q.quantifier === 'has' ? `${start} ${rel} ${end}` : `${start} not ${rel} ${end}`
}

/** Runs the pattern over the graph. Pure, and cheap enough to run per keystroke. */
export function runPattern(graph: Graph, q: PatternQuery): PatternRow[] {
  const pool = q.start === 'any' ? graph.nodes : graph.nodes.filter((n) => n.type === q.start)

  return pool
    .map((node) => {
      const matched = incidentEdges(graph, node.id)
        .filter((e) => (q.rel === 'any' ? true : e.rel === q.rel))
        .map((e) => graph.byId.get(otherEnd(e, node.id)))
        .filter((n): n is GraphNode => Boolean(n))
        .filter((n) => (q.end === 'any' ? true : n.type === q.end))
      return { node, matched }
    })
    .filter((row) => (q.quantifier === 'has' ? row.matched.length > 0 : row.matched.length === 0))
}

/* --------------------------------- visuals -------------------------------- */

/**
 * A colour per node type.
 *
 * Drawn from the chart-series namespace rather than the status one, so a red
 * node is never ambiguous between "overdue" and "type 4". Ten types over five
 * series means two types share a hue; they are ordered so the pairs are never
 * adjacent in the legend and never joined by an edge in practice.
 */
export function typeColor(type: GraphNodeType, c: Palette) {
  const map: Record<GraphNodeType, string> = {
    application: c.series[0],
    org: c.series[3],
    role: c.series[4],
    item: c.series[2],
    file: c.series[1],
    link: c.info,
    snippet: c.series[4],
    posting: c.series[1],
    match: c.series[3],
    keyword: c.text3,
  }
  return map[type]
}
