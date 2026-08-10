/**
 * The knowledge graph, as the /graph page reads it.
 *
 * Nothing here is a second copy of the data any more, and nothing here derives
 * the graph from seven arrays either. The graph IS the store: this file walks
 * the snapshot and dresses it for a canvas — a label, a detail line, an href,
 * and the two view-only node types that are deliberately not persisted.
 *
 * `role` and `source` are synthesised here and nowhere else (D5). They are closed
 * unions driving a fixed filter and a fixed legend order, so promoting them to
 * real nodes would put a join on every projection and buy nothing the user can
 * rename or annotate. They exist on this page because a picture of "which of
 * these came from a referral" is worth drawing.
 *
 * Pure on purpose. It takes a `GraphSnapshot` rather than calling a hook, so the
 * whole thing can be exercised without a React tree, and so the route decides
 * what "the graph" is scoped to.
 */

import { displayName } from '@/data/seed'
import { agoLabel, partsOf, shortDate } from '@/data/timeline'
import type { TimelineKind } from '@/data/timeline'
import type { NodeType, StoredNode } from '@/kg/core/model'
import type { GraphSnapshot } from '@/kg/core/snapshot'
import { applicationsPath, appPath, calendarPath, scoutPath, vaultPath } from '@/lib/links'
import { TODAY } from '@/lib/today'

/* ---------------------------------- model --------------------------------- */

export const GRAPH_NODE_TYPES = [
  'application',
  'organisation',
  'role',
  'item',
  'keyword',
  'link',
  'file',
  'snippet',
  'posting',
  'match',
  'source',
] as const

export type GraphNodeType = (typeof GRAPH_NODE_TYPES)[number]

/**
 * The seven ways two records can be joined.
 *
 * Spelled as verbs read left to right — an Application is AT an Organisation, a
 * TimelineItem is ABOUT an Application — but every traversal in this file is
 * undirected. People asking "what is connected to Rice" do not hold a direction
 * in their heads, and a query that only walked one way would answer half the
 * question while looking like it answered all of it.
 */
export const GRAPH_RELS = ['AT', 'IS', 'ABOUT', 'FILED_UNDER', 'TAGS', 'FROM', 'BECAME'] as const

export type GraphRel = (typeof GRAPH_RELS)[number]

export type GraphNode = {
  /** 'app:stripe' — the type's prefix and the record's own id. */
  id: string
  type: GraphNodeType
  label: string
  /** One line of context: a stage, a date, a bucket. Never a second title. */
  detail?: string
  /** The underlying record's id, for the routes that take one. */
  recordId: string
  /**
   * Where this record lives in the app, when it has a page of its own.
   * Organisations, roles, keywords and sources are derived rather than stored,
   * so most of them have nowhere to send you and say so by leaving this unset.
   */
  href?: string
  /** Timeline items only — what kind of dated thing it is. */
  itemKind?: TimelineKind
  /** Timeline items only — whether it surfaces in the Vault's reminders. */
  reminder?: boolean
  /** Edges touching this node, counted at build time. Drives node size. */
  degree: number
}

export type GraphEdge = {
  id: string
  from: string
  to: string
  rel: GraphRel
}

export type Graph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  byId: ReadonlyMap<string, GraphNode>
  edgeById: ReadonlyMap<string, GraphEdge>
  /** Node id → the ids of every edge touching it. */
  incident: ReadonlyMap<string, string[]>
}

export const NODE_TYPE_LABEL: Record<GraphNodeType, string> = {
  application: 'Application',
  organisation: 'Organisation',
  role: 'Role',
  item: 'Timeline item',
  keyword: 'Keyword',
  link: 'Link',
  file: 'File',
  snippet: 'Snippet',
  posting: 'Saved posting',
  match: 'Scout match',
  source: 'Source',
}

/** How each relationship reads in a sentence, for the pattern builder. */
export const REL_LABEL: Record<GraphRel, string> = {
  AT: 'is at',
  IS: 'is a',
  ABOUT: 'is about',
  FILED_UNDER: 'is filed under',
  TAGS: 'tags',
  FROM: 'came from',
  BECAME: 'became',
}

/**
 * The two node types that are drawn but never stored.
 *
 * Every other node on this canvas answers to its own `NodeId`, which already
 * carries its type — 'app:0192…' — so the prefixing this map used to do for
 * eleven types is only needed for the two that have no record to be an id of.
 */
const VALUE_PREFIX = { role: 'role', source: 'source' } as const

export function graphNodeId(type: 'role' | 'source', value: string) {
  return `${VALUE_PREFIX[type]}:${keyOf(value)}`
}

/** Lowercased and hyphenated, so 'UT Austin' and 'ut austin' are one node. */
const keyOf = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-')

/**
 * Which stored types get drawn, and as what.
 *
 * `pipeline` and `profile` are absent: a pipeline is a saved search over a job
 * board and names no record here, and the profile is a singleton that would sit
 * alone in the corner of every canvas. Both were absent before this file read
 * the snapshot, and leaving them absent is what keeps the page unchanged.
 */
const DRAWN: Partial<Record<NodeType, GraphNodeType>> = {
  application: 'application',
  organisation: 'organisation',
  timelineItem: 'item',
  keyword: 'keyword',
  link: 'link',
  file: 'file',
  snippet: 'snippet',
  posting: 'posting',
  match: 'match',
}

/** The stored relations that have a drawn node at both ends. */
const DRAWN_RELS: ReadonlySet<string> = new Set(['AT', 'ABOUT', 'FILED_UNDER', 'TAGS', 'BECAME'])

/* ---------------------------------- build --------------------------------- */

export function buildGraph(memory: GraphSnapshot): Graph {
  const nodes: GraphNode[] = []
  const byId = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  const edgeById = new Map<string, GraphEdge>()

  /** Returns the existing node when the id is taken — roles and sources are
   *  shared by many records and must not be duplicated. */
  const addNode = (node: Omit<GraphNode, 'degree'>): GraphNode => {
    const existing = byId.get(node.id)
    if (existing) return existing
    const full: GraphNode = { ...node, degree: 0 }
    nodes.push(full)
    byId.set(full.id, full)
    return full
  }

  // Guarded on both ends: an edge to a node this page does not draw — a posting
  // FROM a pipeline — would otherwise render as a line into empty space, which
  // reads as the layout having broken rather than as a type being hidden.
  const addEdge = (from: string, to: string, rel: GraphRel) => {
    if (from === to || !byId.has(from) || !byId.has(to)) return
    const id = `${from}|${rel}|${to}`
    if (edgeById.has(id)) return
    const edge: GraphEdge = { id, from, to, rel }
    edges.push(edge)
    edgeById.set(id, edge)
  }

  for (const node of memory.nodes()) {
    const type = DRAWN[node.type]
    if (type) addNode(describe(memory, node, type))
  }

  /*
   * The value nodes, and the two edges that only exist on this canvas.
   *
   * `IS` and the application->source edge are not in `RELS` and are never
   * written down. They are drawn from props, here, at the point the props are
   * already in hand.
   */
  for (const application of memory.ofType('application')) {
    const role = addNode({
      id: graphNodeId('role', application.props.roleTag),
      type: 'role',
      label: application.props.roleTag,
      recordId: application.props.roleTag,
    })
    addEdge(application.id, role.id, 'IS')

    const from = application.props.source
    if (from) {
      const source = addNode({
        id: graphNodeId('source', from),
        type: 'source',
        label: from,
        recordId: from,
      })
      addEdge(application.id, source.id, 'FROM')
    }
  }

  for (const edge of memory.edges()) {
    if (DRAWN_RELS.has(edge.rel)) addEdge(edge.from, edge.to, edge.rel as GraphRel)
  }

  const incident = new Map<string, string[]>()
  for (const edge of edges) {
    for (const end of [edge.from, edge.to]) {
      const list = incident.get(end)
      if (list) list.push(edge.id)
      else incident.set(end, [edge.id])
      const node = byId.get(end)
      if (node) node.degree += 1
    }
  }

  return { nodes, edges, byId, edgeById, incident }
}

/**
 * One stored record, dressed for the canvas.
 *
 * `href` is where the record lives in the app. Roles, sources and keywords have
 * nowhere to send you and say so by leaving it unset — an organisation's page is
 * the board's search box, which does match on `org`, and that is as close as it
 * gets to one.
 */
function describe(
  memory: GraphSnapshot,
  node: StoredNode,
  type: GraphNodeType,
): Omit<GraphNode, 'degree'> {
  const base = { id: node.id, type, recordId: node.id }

  switch (node.type) {
    case 'application': {
      const org = memory.one(node.id, 'AT', 'organisation')?.props.name ?? ''
      return {
        ...base,
        label: displayName({ org, role: node.props.role }),
        ...(node.props.location === undefined ? {} : { detail: node.props.location }),
        // The stored node, so the link carries the slug rather than the id the
        // canvas happens to be drawing this session.
        href: appPath({ id: node.id, slug: node.props.slug }),
      }
    }
    case 'organisation':
      return {
        ...base,
        label: node.props.name,
        href: applicationsPath({ q: node.props.name }),
      }
    case 'timelineItem': {
      const { y, m, d } = partsOf(node.props.date)
      return {
        ...base,
        label: node.props.title,
        detail: shortDate(node.props.date),
        href: calendarPath({ y, m, d, focus: node.id }),
        itemKind: node.props.kind,
        reminder: node.props.remind,
      }
    }
    case 'keyword':
      return { ...base, label: node.props.name }
    case 'link':
      return {
        ...base,
        label: node.props.title,
        detail: node.props.category,
        href: vaultPath({ tool: 'links', focus: node.id }),
      }
    case 'file':
      return {
        ...base,
        label: node.props.name,
        detail: node.props.bucket,
        href: vaultPath({ tool: 'files', focus: node.id }),
      }
    case 'snippet':
      return {
        ...base,
        label: node.props.title,
        detail: node.props.tag,
        href: vaultPath({ tool: 'snippets', focus: node.id }),
      }
    case 'posting':
      return {
        ...base,
        label: node.props.title,
        detail: `Saved ${agoLabel(node.props.savedOn, TODAY)}`,
        href: scoutPath({ focus: { kind: 'posting', id: node.id } }),
      }
    case 'match':
      return {
        ...base,
        label: node.props.role,
        detail: `${node.props.fit}% fit`,
        href: scoutPath({ focus: { kind: 'match', id: node.id } }),
      }
    default:
      // Unreachable while DRAWN and this switch agree. It is written as a
      // fallback rather than an exhaustiveness assert because a new node type
      // must not be able to blank the whole canvas before anyone has decided
      // how to draw it.
      return { ...base, label: node.id }
  }
}

/* -------------------------------- traversal ------------------------------- */

export function incidentEdges(graph: Graph, nodeId: string): GraphEdge[] {
  const ids = graph.incident.get(nodeId) ?? []
  return ids.map((id) => graph.edgeById.get(id)).filter((e): e is GraphEdge => e !== undefined)
}

/** The other end of an edge, whichever end you came in on. */
export const otherEnd = (edge: GraphEdge, nodeId: string) =>
  edge.from === nodeId ? edge.to : edge.from

export function neighbours(graph: Graph, nodeId: string): GraphNode[] {
  return incidentEdges(graph, nodeId)
    .map((edge) => graph.byId.get(otherEnd(edge, nodeId)))
    .filter((n): n is GraphNode => n !== undefined)
}

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

/** The nodes named, plus every edge with both ends inside the set. */
export function subgraphOf(graph: Graph, nodeIds: Iterable<string>) {
  const keep = new Set(nodeIds)
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
  }
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

/* ---------------------------------- query --------------------------------- */

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

/* ------------------------------ pseudo-query ------------------------------ */

const variableFor = (type: GraphNodeType | 'any') => (type === 'any' ? 'n' : type[0])

/** '(a:Application)' · '(i:Timeline item {kind: "follow-up"})'. */
function nodePattern(variable: string, type: GraphNodeType | 'any', facet?: ItemFacet) {
  const label = type === 'any' ? '' : `:${NODE_TYPE_LABEL[type]}`
  const props =
    !facet || facet === 'any'
      ? ''
      : facet === 'reminder'
        ? ' {reminder: true}'
        : ` {kind: "${facet}"}`
  return `(${variable}${label}${props})`
}

/**
 * The pattern, written the way a graph query language would write it.
 *
 * Illustrative only — jojo parses nothing, and the UI has to say so wherever
 * this is shown. It earns its place by making the shape of the question legible:
 * once you have seen "WHERE NOT (a)-[:ABOUT]-(:Timeline item)" beside the words
 * "applications with no follow-up", the builder above it stops being a mystery.
 */
export function describeQuery(graph: Graph, query: GraphQuery): string {
  if (query.kind === 'path') {
    const from = graph.byId.get(query.from)
    const to = graph.byId.get(query.to)
    if (!from || !to) return 'MATCH p = shortestPath((a)-[*]-(b)) RETURN p'
    return `MATCH p = shortestPath(${nodePattern('a', from.type)}-[*]-${nodePattern('b', to.type)})\nWHERE a.id = "${from.recordId}" AND b.id = "${to.recordId}"\nRETURN p`
  }

  const a = variableFor(query.start)
  const b = query.end === 'any' ? 'm' : variableFor(query.end)
  const start = nodePattern(a, query.start, query.startFacet)
  const end = nodePattern(b === a ? `${b}2` : b, query.end, query.endFacet)
  const rel = query.rel === 'any' ? '-[]-' : `-[:${query.rel}]-`

  const keyword = graph.byId.get(query.keywordId ?? '')
  const keywordClause = keyword
    ? `\nMATCH (${a})-[:TAGS]-(:Keyword {name: "${keyword.label}"})`
    : ''

  if (query.quantifier === 'missing') {
    return `MATCH ${start}${keywordClause}\nWHERE NOT (${a})${rel}${end}\nRETURN ${a}`
  }

  if (query.quantifier === 'atLeast') {
    const n = Math.max(2, query.atLeast ?? 2)
    return `MATCH ${start}${rel}${end}${keywordClause}\nWITH ${a}, count(${b}) AS n\nWHERE n >= ${n}\nRETURN ${a}, n`
  }

  return `MATCH ${start}${rel}${end}${keywordClause}\nRETURN ${a}, ${b}`
}

/* ----------------------------- worked examples ---------------------------- */

/**
 * The questions worth a click.
 *
 * Each one builds a query against the graph in front of it rather than a
 * hard-coded record id, and returns null when this session has nothing to ask
 * it about — a button that cannot answer is disabled rather than silently
 * returning an empty table.
 */
export type QueryExample = {
  id: string
  label: string
  hint: string
  build: (graph: Graph) => GraphQuery | null
}

const firstOfType = (graph: Graph, type: GraphNodeType) => graph.nodes.find((n) => n.type === type)

export const QUERY_EXAMPLES: QueryExample[] = [
  {
    id: 'no-follow-up',
    label: 'Applications with no follow-up scheduled',
    hint: 'The gap that costs people interviews.',
    build: (graph) =>
      firstOfType(graph, 'application')
        ? {
            kind: 'pattern',
            start: 'application',
            quantifier: 'missing',
            rel: 'ABOUT',
            end: 'item',
            endFacet: 'follow-up',
          }
        : null,
  },
  {
    id: 'tagged',
    label: 'Everything tagged Referral',
    hint: 'One keyword, across every kind of record.',
    build: (graph) => {
      const keyword =
        graph.nodes.find((n) => n.type === 'keyword' && n.label.toLowerCase() === 'referral') ??
        graph.nodes.find((n) => n.type === 'keyword')
      if (!keyword) return null
      return {
        kind: 'pattern',
        start: 'any',
        quantifier: 'has',
        rel: 'TAGS',
        end: 'keyword',
        keywordId: keyword.id,
      }
    },
  },
  {
    id: 'repeat-orgs',
    label: 'Organisations I applied to more than once',
    hint: 'Two applications at one employer, from one org node.',
    build: (graph) =>
      firstOfType(graph, 'organisation')
        ? {
            kind: 'pattern',
            start: 'organisation',
            quantifier: 'atLeast',
            atLeast: 2,
            rel: 'AT',
            end: 'application',
          }
        : null,
  },
  {
    id: 'loose-reminders',
    label: 'Reminders not linked to any application',
    hint: 'Work you will do without knowing what it was for.',
    build: (graph) =>
      graph.nodes.some((n) => n.type === 'item' && n.reminder)
        ? {
            kind: 'pattern',
            start: 'item',
            startFacet: 'reminder',
            quantifier: 'missing',
            rel: 'ABOUT',
            end: 'application',
          }
        : null,
  },
  {
    id: 'unused-files',
    label: 'Files not used by any application',
    hint: 'Documents sitting in the Vault doing nothing.',
    build: (graph) =>
      firstOfType(graph, 'file')
        ? {
            kind: 'pattern',
            start: 'file',
            quantifier: 'missing',
            rel: 'FILED_UNDER',
            end: 'application',
          }
        : null,
  },
  {
    id: 'bare-applications',
    label: 'Applications with nothing filed in the Vault',
    hint: 'No link, no file, no snippet — usually an unstarted one.',
    build: (graph) =>
      firstOfType(graph, 'application')
        ? {
            kind: 'pattern',
            start: 'application',
            quantifier: 'missing',
            rel: 'FILED_UNDER',
            end: 'any',
          }
        : null,
  },
  {
    id: 'path',
    label: 'Shortest path between two records',
    hint: 'How a file and a job you applied for are related.',
    build: (graph) => {
      // Picks a pair that is actually joined, so the example demonstrates a
      // path rather than demonstrating that there is not one.
      const files = graph.nodes.filter((n) => n.type === 'file')
      const applications = graph.nodes.filter((n) => n.type === 'application')
      for (const file of files) {
        for (const application of applications) {
          if (shortestPath(graph, file.id, application.id)) {
            return { kind: 'path', from: file.id, to: application.id }
          }
        }
      }
      const [first, second] = graph.nodes
      return first && second ? { kind: 'path', from: first.id, to: second.id } : null
    },
  },
]
