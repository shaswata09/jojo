/**
 * The phone's half of the calm overview: what the shared rules in
 * `kg/core/graph-view.ts` are told about THIS app's records, and how their keys
 * are put into words. The web's twin is `web/src/lib/graph/view.ts`; the rules
 * themselves — folding, grouping, both layouts, the threshold — are the core's,
 * so the two apps draw the same store the same way.
 *
 * The core knows nothing about applications, stages or roles. This file
 * decides:
 *
 *   - which records may fold (never an application or a role — the picture is
 *     about them, and they must not vanish into a count);
 *   - what each application is grouped by on each dimension, read off the
 *     graph's own edges (its role, its employer, its keywords) and its stage;
 *   - the order members sit in, centre outward: the role a group is about
 *     first, then applications by stage, then by name;
 *   - the words: a group's name, and a folded count as counted phrases
 *     ("2 timeline items and 1 file") from the catalog.
 *
 * Pure: no React Native, so `graph-view.requests.test.ts` runs it on node.
 */

import {
  GROUP_LOOSE,
  GROUP_NONE,
  GROUP_REST,
  GROUP_SHARED,
  GROUP_SINGLES,
  GROUP_TYPE_PREFIX,
  foldLeaves,
} from '@jojo/service/core/graph-view'
import type { Folding, ViewGraph, ViewNode } from '@jojo/service/core/graph-view'
import { STAGE_VALUES } from '@jojo/service/core/model'
import { domain } from '@/i18n/domain'
import { GRAPH_NODE_TYPES, NODE_TYPE_LABEL } from '@/lib/graph'
import type { Graph, GraphNodeType } from '@/lib/graph'

/** A translate function over the `screens` namespace — `t` from `useTranslation('screens')`. */
export type Say = (key: string, options?: Record<string, unknown>) => string

/** The dimensions the "Group by" control offers, Role first because it is the default. */
export const GROUP_DIMENSIONS = ['role', 'stage', 'organisation', 'keyword'] as const
export type GroupDimension = (typeof GROUP_DIMENSIONS)[number]

/** Types that never fold: the picture is about them. */
const NEVER_FOLD: ReadonlySet<string> = new Set<GraphNodeType>(['application', 'role'])

export const canFold = (node: ViewNode) => !NEVER_FOLD.has(node.type)

/**
 * The graph in the core module's shape, with each application's group values,
 * leaving out the types hidden in the legend.
 *
 * Read off the drawn edges rather than the store, so a type hidden from the
 * legend is hidden from the grouping too: hide keywords and every application
 * has no keyword, which is what the picture then shows.
 */
export function toViewGraph(
  graph: Graph,
  hidden: ReadonlySet<GraphNodeType> = new Set(),
): ViewGraph {
  const shown = graph.nodes.filter((n) => !hidden.has(n.type))
  const keep = new Set(shown.map((n) => n.id))
  const edges = graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to))

  const facets = new Map<string, { role: string[]; organisation: string[]; keyword: string[] }>()
  const facetOf = (id: string) => {
    let entry = facets.get(id)
    if (!entry) {
      entry = { role: [], organisation: [], keyword: [] }
      facets.set(id, entry)
    }
    return entry
  }
  for (const edge of edges) {
    const from = graph.byId.get(edge.from)
    const to = graph.byId.get(edge.to)
    if (!from || !to) continue
    const [app, other] =
      from.type === 'application' ? [from, to] : to.type === 'application' ? [to, from] : []
    if (!app || !other) continue
    if (other.type === 'role') facetOf(app.id).role.push(other.label)
    else if (other.type === 'org') facetOf(app.id).organisation.push(other.label)
    else if (other.type === 'keyword') facetOf(app.id).keyword.push(other.label)
  }

  const nodes: ViewNode[] = shown.map((node) => {
    if (node.type !== 'application') return { id: node.id, type: node.type, label: node.label }
    const facet = facets.get(node.id) ?? { role: [], organisation: [], keyword: [] }
    return {
      id: node.id,
      type: node.type,
      label: node.label,
      groupKeys: {
        role: facet.role,
        stage: node.stage ? [node.stage] : [],
        organisation: facet.organisation,
        keyword: facet.keyword,
      },
    }
  })
  return { nodes, edges }
}

/** `foldLeaves` with this app's rule about what may fold. */
export const foldGraph = (graph: ViewGraph): Folding => foldLeaves(graph, { canFold })

/**
 * Centre-outward order inside a group: the hubs a group is about, then
 * applications by pipeline stage, then the rest; names in plain code-point
 * order so the seats are the same in every language.
 */
const TYPE_RANK: Readonly<Record<GraphNodeType, number>> = {
  role: 0,
  org: 1,
  keyword: 2,
  application: 3,
  posting: 4,
  match: 5,
  item: 6,
  link: 7,
  file: 8,
  snippet: 9,
}

export function memberOrder(a: ViewNode, b: ViewNode): number {
  const ra = TYPE_RANK[a.type as GraphNodeType] ?? 99
  const rb = TYPE_RANK[b.type as GraphNodeType] ?? 99
  if (ra !== rb) return ra - rb
  const sa = stageRank(a)
  const sb = stageRank(b)
  if (sa !== sb) return sa - sb
  return a.label < b.label ? -1 : a.label > b.label ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

const stageRank = (node: ViewNode) => {
  const stage = node.groupKeys?.['stage']?.[0]
  const at = stage === undefined ? -1 : (STAGE_VALUES as readonly string[]).indexOf(stage)
  return at === -1 ? STAGE_VALUES.length : at
}

/** Type order for folded counts that tie — the legend's. */
export const TYPE_ORDER: readonly string[] = GRAPH_NODE_TYPES

/** Stages read draft → closed, the way the board does; nothing else has a fixed order. */
export function groupOrderOf(by: GroupDimension): readonly string[] | undefined {
  return by === 'stage' ? STAGE_VALUES : undefined
}

/** A group's name as the person reads it. Special keys are worded; values are shown as stored. */
export function groupName(key: string, by: GroupDimension, t: Say): string {
  if (key === GROUP_SHARED) return t('graph.view.group.shared')
  if (key === GROUP_NONE) return t('graph.view.group.none')
  if (key === GROUP_REST) return t('graph.view.group.rest')
  if (key === GROUP_SINGLES) return t('graph.view.group.singles')
  if (key === GROUP_LOOSE) return t('graph.view.group.loose')
  if (key.startsWith(GROUP_TYPE_PREFIX)) {
    const type = key.slice(GROUP_TYPE_PREFIX.length) as GraphNodeType
    return NODE_TYPE_LABEL[type] ?? type
  }
  if (by === 'stage' && (STAGE_VALUES as readonly string[]).includes(key)) {
    return domain.stage(key as (typeof STAGE_VALUES)[number])
  }
  return key
}

/**
 * "a, b and c" in the language on screen. From the catalog rather than
 * `Intl.ListFormat`, which Hermes does not have.
 */
export function listJoiner(t: Say): (parts: readonly string[]) => string {
  const sep = t('graph.view.list.sep')
  return (parts) => {
    if (parts.length <= 1) return parts[0] ?? ''
    const last = parts[parts.length - 1] ?? ''
    if (parts.length === 2) return t('graph.view.list.two', { first: parts[0], last })
    return t('graph.view.list.many', { head: parts.slice(0, -1).join(sep), last })
  }
}

/** "2 timeline items and 1 file", from a `foldedSummary`. Empty when nothing is folded. */
export function foldedPhrase(
  summary: readonly { type: string; count: number }[],
  phrase: (type: string, count: number) => string,
  join: (parts: readonly string[]) => string,
): string {
  return join(summary.map(({ type, count }) => phrase(type, count)))
}
