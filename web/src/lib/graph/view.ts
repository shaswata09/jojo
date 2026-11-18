/**
 * The /graph page's half of the calm overview: what the shared rules in
 * `kg/core/graph-view.ts` are told about THIS app's records, and how their keys
 * are put into words.
 *
 * The core module knows nothing about applications, stages or roles — it folds,
 * groups and places `{ id, type, label, groupKeys }`. This file decides:
 *
 *   - which records may fold (never an application, a role, or the person's
 *     own background and relations — those must not vanish into a count);
 *   - what each application is grouped by on each dimension — read off the
 *     graph's own edges (its role, its employer, its keywords) and its stage;
 *   - the order members sit in, centre outward: the hub a group is about first
 *     (a role diamond in its role's circle), then applications by stage, then
 *     by name;
 *   - the words: a group's name, and a folded count as a list of counted phrases
 *     ("2 timeline items and 1 file") from the catalog, never English fragments.
 */

import { intlLocale } from '@jojo/service/core/intl-locale'
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
import type { TFunction } from 'i18next'
import { domain } from '@/i18n/domain'
import { GRAPH_NODE_TYPES, NODE_TYPE_LABEL } from '@/lib/graph/model'
import type { Graph, GraphNodeType } from '@/lib/graph/model'

/** The dimensions the "Group by" control offers, Role first because it is the default. */
export const GROUP_DIMENSIONS = ['role', 'stage', 'organisation', 'keyword'] as const
export type GroupDimension = (typeof GROUP_DIMENSIONS)[number]

/**
 * The person's own records' group. A special key (it starts with '@'), so the
 * core never pools it into "Others" however few of them there are.
 */
export const GROUP_YOU = '@you'

/** Types that never fold: the picture is about them, or they are the person's own. */
const NEVER_FOLD: ReadonlySet<GraphNodeType> = new Set([
  'application',
  'role',
  'background',
  'claim',
])

export const canFold = (node: ViewNode) => !NEVER_FOLD.has(node.type as GraphNodeType)

/**
 * The graph in the core module's shape, with each application's group values.
 *
 * Read off the drawn edges rather than the store, so a type hidden from the
 * legend is hidden from the grouping too: hide keywords and every application
 * has no keyword, which is what the picture then shows.
 */
export function toViewGraph(graph: Graph): ViewGraph {
  const facets = new Map<string, { role: string[]; organisation: string[]; keyword: string[] }>()
  const facetOf = (id: string) => {
    let entry = facets.get(id)
    if (!entry) {
      entry = { role: [], organisation: [], keyword: [] }
      facets.set(id, entry)
    }
    return entry
  }
  for (const edge of graph.edges) {
    const from = graph.byId.get(edge.from)
    const to = graph.byId.get(edge.to)
    if (!from || !to) continue
    const [app, other] =
      from.type === 'application' ? [from, to] : to.type === 'application' ? [to, from] : []
    if (!app || !other) continue
    if (other.type === 'role') facetOf(app.id).role.push(other.label)
    else if (other.type === 'organisation') facetOf(app.id).organisation.push(other.label)
    else if (other.type === 'keyword') facetOf(app.id).keyword.push(other.label)
  }

  const you = [GROUP_YOU]
  const nodes: ViewNode[] = graph.nodes.map((node) => {
    if (node.type === 'application') {
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
    }
    if (node.type === 'background') {
      return {
        id: node.id,
        type: node.type,
        label: node.label,
        groupKeys: { role: you, stage: you, organisation: you, keyword: you },
      }
    }
    return { id: node.id, type: node.type, label: node.label }
  })
  return { nodes, edges: graph.edges }
}

/** `foldLeaves` with this app's rule about what may fold. */
export const foldGraph = (graph: ViewGraph): Folding => foldLeaves(graph, { canFold })

/**
 * Centre-outward order inside a group: the hubs a group is about, then the
 * person's own records, then applications by pipeline stage, then the rest;
 * names in plain code-point order so the seats are the same in every language.
 */
const TYPE_RANK: Readonly<Record<GraphNodeType, number>> = {
  role: 0,
  organisation: 1,
  keyword: 2,
  source: 3,
  background: 4,
  claim: 5,
  application: 6,
  posting: 7,
  match: 8,
  item: 9,
  link: 10,
  file: 11,
  snippet: 12,
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

/** Read off the record's own `stage` group value, so the order needs nothing but the view graph. */
const stageRank = (node: ViewNode) => {
  const stage = node.groupKeys?.['stage']?.[0]
  const at = stage === undefined ? -1 : (STAGE_VALUES as readonly string[]).indexOf(stage)
  return at === -1 ? STAGE_VALUES.length : at
}

/** Type order for folded counts that tie — the legend's. */
export const TYPE_ORDER: readonly string[] = GRAPH_NODE_TYPES

/**
 * Groups whose order means something, laid out in rows in that order rather
 * than packed by size: stages read draft → closed, the way the board does.
 */
export function groupOrderOf(by: GroupDimension): readonly string[] | undefined {
  return by === 'stage' ? STAGE_VALUES : undefined
}

/** A group's name as the person reads it. Special keys are worded; values are shown as stored. */
export function groupName(key: string, by: GroupDimension, t: TFunction<'graph'>): string {
  if (key === GROUP_SHARED) return t('view.group.shared')
  if (key === GROUP_NONE) return t('view.group.none')
  if (key === GROUP_REST) return t('view.group.rest')
  if (key === GROUP_SINGLES) return t('view.group.singles')
  if (key === GROUP_LOOSE) return t('view.group.loose')
  if (key === GROUP_YOU) return NODE_TYPE_LABEL.background
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
 * "a, b and c" in the language on screen — `listJoin`'s rule, with the
 * formatter built once rather than once per node: the overview names every
 * drawn record, and a fresh `Intl.ListFormat` per name is most of the cost of
 * naming three thousand of them.
 */
export function listJoiner(language: string): (parts: readonly string[]) => string {
  if (!language || language === 'en') {
    return (parts) =>
      parts.length <= 1
        ? (parts[0] ?? '')
        : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  }
  const format = new Intl.ListFormat(intlLocale(language), { style: 'long', type: 'conjunction' })
  return (parts) => (parts.length <= 1 ? (parts[0] ?? '') : format.format(parts))
}

/**
 * "2 timeline items and 1 file", from a `foldedSummary`. Empty when nothing is
 * folded. `phrase` words one counted type — `t('view.folded.<type>', { count })`
 * — and is a parameter so a caller naming thousands of records can cache it.
 */
export function foldedPhrase(
  summary: readonly { type: string; count: number }[],
  phrase: (type: string, count: number) => string,
  join: (parts: readonly string[]) => string,
): string {
  return join(summary.map(({ type, count }) => phrase(type, count)))
}
