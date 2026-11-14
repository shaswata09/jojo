/**
 * Helpers more than one read uses: following a record's links, the text a
 * search matches against, the kind and limit fields, and the list shape that
 * reports what a limit cut off.
 */

import { NODE_TYPES } from '../../core/model'
import type { NodeId, Rel, StoredNode } from '../../core/model'
import { s } from '../../core/schema'
import type { GraphSnapshot } from '../../core/snapshot'
import { labelOf } from '../records'

/** Everything joined to a record, in both directions, because a person would. */
export function relatedTo(id: NodeId, memory: GraphSnapshot, rel?: Rel) {
  return memory
    .incident(id, rel)
    .map((edge) => {
      const otherId = edge.from === id ? edge.to : edge.from
      const other = memory.node(otherId)
      if (!other) return null
      return {
        rel: edge.rel,
        // Which way the edge points, in words. "An application is AT an
        // organisation" reads one way and not the other, and a model told only
        // `AT` will invent the direction it needs.
        direction: edge.from === id ? ('out' as const) : ('in' as const),
        id: other.id,
        type: other.type,
        label: labelOf(other, memory),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
}

/**
 * Every string in a record, folded, for a substring match — plus its label.
 *
 * The label is the half that was missing, and a real model found it. Asked to
 * flag "my UT Austin application", gemma's first and most natural call was
 * `memory.search {query: 'UT Austin', type: 'application'}`, which returned
 * NOTHING: an application's props hold the role and the stage, and the
 * employer's name is a prop of the organisation one hop away. It recovered —
 * searched again without the type, found the organisation, tried `related`,
 * then listed every application and matched by eye — but that is four round
 * trips to answer a question the first one asked correctly.
 *
 * `labelOf` already crosses that hop for display, so searching what is
 * displayed costs one edge lookup and makes the obvious query work. The
 * alternative — telling the model in prose that employers are separate records
 * — is asking it to know our schema, which is exactly what a search tool is for
 * not needing.
 */
export const haystack = (node: StoredNode, memory: GraphSnapshot): string =>
  [...Object.values(node.props as Record<string, unknown>), labelOf(node, memory)]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase()

export const nodeType = (label: string, description: string) =>
  s.enum(NODE_TYPES, { label, description })

/**
 * The same list plus `any`, for the places where "all kinds" is a real answer.
 *
 * `graph.query`'s facets already accept `'any'` (see `ITEM_FACETS`), and
 * `memory.search` did not — it used "omit the field" for the same idea. A model
 * that learned the convention from one tool tried it on the other and was
 * refused: measured, GPT-OSS 120B sent `{"query":"Rice","type":"any"}` and got
 * "Needs to be one of: claim, application, …", which is a list that does not
 * mention the word it just used.
 *
 * Two spellings of "everything" in one registry is the tool surface teaching a
 * rule and then breaking it. This makes them agree; `read` treats `any` as
 * absent, which is what the model meant.
 */
export const ANY = 'any' as const
export const nodeTypeOrAny = (label: string, description: string) =>
  s.enum([ANY, ...NODE_TYPES], { label, description })

/** A ceiling on every list, so one call cannot spend the whole context window. */
const LIMIT_MAX = 200
export const limit = s.optional(
  s.number({
    label: 'Limit',
    // Says what the answer carries, because the number a model picks here decides
    // what it can SEE. One is the dangerous choice — it turns "which of these
    // two?" into "here is the one" — so the reply reports `total` either way and
    // this says so.
    description: `How many records at most. Defaults to 50, never more than ${String(LIMIT_MAX)}. The reply always reports the total number of matches, so a limit hides records from you but never hides that they exist.`,
    min: 1,
    max: LIMIT_MAX,
  }),
)

const capped = (n: number | undefined) => Math.min(n ?? 50, LIMIT_MAX)

/**
 * A list of matches, with what was cut off it.
 *
 * ## The failure this exists to stop
 *
 * `memory.search` returned a bare array sliced to `limit`, and said nothing
 * about a slice having happened. Measured, and reproducible twice: told "move my
 * Rice application to interview" with TWO Rice applications in the store, Qwen3
 * 14B searched with `limit: 1`, got back one record, and moved it — confidently,
 * and with no way to know it had been handed one of two.
 *
 * The system prompt tells the model to name both and ask when several records
 * match. It cannot follow that instruction about a second record it was never
 * shown. So this is not a model failure to be prompted around: the tool answered
 * an ambiguous question as though it were a clear one.
 *
 * `total` is the count BEFORE the limit. A model that reads `shown: 1, total: 2`
 * has what it needs; one that reads an array of length 1 has nothing.
 */
export type Matches<T> = { readonly matches: readonly T[]; readonly shown: number; readonly total: number }

export const matched = <T>(all: readonly T[], limit: number | undefined): Matches<T> => {
  const matches = all.slice(0, capped(limit))
  /*
   * Counts first, records second, and the order is load-bearing.
   *
   * `renderOutcome` serialises this and cuts it at a character budget, so
   * anything after a long `matches` array is what gets lost — and `total` is
   * the field this whole shape exists to deliver. Putting the two numbers in
   * front costs nothing and survives the cut.
   *
   * The dangerous case survives either way: a model asking for `limit: 1` gets
   * an answer far under the budget, and that is exactly the call that hides an
   * ambiguity. This is for the other end, where fifty records are cut short and
   * the model should still learn that there were eighty.
   */
  return { total: all.length, shown: matches.length, matches }
}

/** What a read says when the run was stopped under it. */
export const STOPPED = 'Stopped by the person before this finished.'
