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
import type { NodeType, StoredNode } from '@/kg/core/model'
import type { GraphSnapshot } from '@/kg/core/snapshot'
import type { Graph, GraphEdge, GraphNode, GraphNodeType, GraphRel } from '@/lib/graph/model'
import { applicationsPath, appPath, calendarPath, scoutPath, vaultPath } from '@/lib/links'
import { TODAY } from '@/lib/today'

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
