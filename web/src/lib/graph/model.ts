/**
 * What a node, an edge and a graph ARE on the /graph page.
 *
 * Types and the two label maps only — no build step, no traversal, no query.
 * Everything else in this folder imports from here, so this is the one file to
 * open when the question is "what shape is a node" rather than "where did this
 * node come from".
 */

import type { TimelineKind } from '@/data/timeline'

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
 * TimelineItem is ABOUT an Application — but every traversal in this folder is
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
