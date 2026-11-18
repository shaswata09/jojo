/**
 * What a node, an edge and a graph ARE on the /graph page.
 *
 * Types and the two label maps only — no build step, no traversal, no query.
 * Everything else in this folder imports from here, so this is the one file to
 * open when the question is "what shape is a node" rather than "where did this
 * node come from".
 */

import type { Rel, Stage } from '@jojo/service/core/model'
import type { TimelineKind } from '@/data/timeline'
import { i18next } from '@/i18n/i18n'
import { domain } from '@/i18n/domain'

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
  /*
   * The person's own record, and what relates two of them.
   *
   * Both were absent, so the page called "the knowledge graph" drew every
   * record about a JOB and none about the user — a CV read into thirty
   * background entries produced no change on the canvas at all.
   */
  'background',
  'claim',
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
export const GRAPH_RELS = [
  'AT',
  'IS',
  'ABOUT',
  'FILED_UNDER',
  'TAGS',
  'FROM',
  'BECAME',
  'SUBJECT',
  'OBJECT',
] as const

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
  /**
   * Applications only — the pipeline stage, so the overview can group and order
   * by it (`lib/graph/view.ts`). Not shown on its own: the detail line is the
   * location, as it always was.
   */
  stage?: Stage
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

/**
 * Each type's name in English — what the illustrative query text in
 * `pseudo-query.ts` writes, because a query language's labels are not prose.
 */
export const NODE_TYPE_NAME: Readonly<Record<GraphNodeType, string>> = {
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
  background: 'About you',
  claim: 'Relation',
}

/** Each type's name as the person reads it, in their language, looked up when read. */
export const NODE_TYPE_LABEL: Readonly<Record<GraphNodeType, string>> = Object.defineProperties(
  {} as Record<GraphNodeType, string>,
  Object.fromEntries(
    Object.keys(NODE_TYPE_NAME).map((type) => [
      type,
      { enumerable: true, get: () => i18next.t(`messages:graph.nodeType.${type}`) },
    ]),
  ),
)

/**
 * How each relationship reads in a sentence, for the pattern builder.
 *
 * Six of the seven are read out of `EDGE_SCHEMA` rather than restated here.
 * They were restated, and the six sentences were byte-identical to the ones the
 * store already carries — D6's own note says the label is "reused by /graph's
 * sentence builder", and it was not being reused, it was being copied. A
 * relation renamed in `core/model.ts` used to leave this map still printing the
 * old words in the legend, the detail panel and the Answer table.
 *
 * `IS` is the exception because it is the one relation with no `EDGE_SCHEMA`
 * entry to read: an application IS a role tag is synthesised from a prop by
 * `buildGraph` and is never written down. It is spelled here because here is
 * the only place it exists — so it has no `domain` key, and reads the graph
 * page's own catalog instead (`graph:legend.isA`, the phone's `messages:graph.isA`).
 *
 * The others are getters onto `domain.rel`, looked up when read like
 * `NODE_TYPE_LABEL`, so the legend, the detail panel and the Answer table speak
 * the language on screen; the English they fall back to is still
 * `EDGE_SCHEMA[rel].label`, which `domain-text.ts` generates the catalog from.
 */
export const REL_LABEL: Readonly<Record<GraphRel, string>> = Object.defineProperties(
  {} as Record<GraphRel, string>,
  Object.fromEntries(
    GRAPH_RELS.map((rel) => [
      rel,
      {
        enumerable: true,
        get: () => (rel === 'IS' ? i18next.t('graph:legend.isA') : domain.rel(rel satisfies Rel)),
      },
    ]),
  ),
)
