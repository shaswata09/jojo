/**
 * L3 — a record as a model reads it: its label, and its props flattened.
 *
 * A leaf on purpose. `queries.ts` and `graph-query.ts` both render records, and
 * when this lived in `queries.ts` the two files imported each other — see the
 * note where `queries.ts` re-exports it.
 */

import type { ISODate, NodeId, NodeType, StoredNode } from '../core/model'
import type { GraphSnapshot } from '../core/snapshot'
import { derivedFields } from './record-query'

/**
 * The one human-readable field, per type, in the order worth trying.
 *
 * Not a switch over eleven types: every one of them names itself with `name`,
 * `title` or `role`, and a list rather than a switch is what makes a new type
 * legible for free. `slug` is the last resort and is never nothing.
 */
const LABEL_KEYS = ['name', 'title', 'role', 'slug'] as const

export function labelOf(node: StoredNode, memory: GraphSnapshot): string {
  const props = node.props as Record<string, unknown>
  const own = LABEL_KEYS.map((k) => props[k]).find((v) => typeof v === 'string' && v.length > 0)
  const label = typeof own === 'string' ? own : node.id
  // An application's role means little without the organisation — "Assistant
  // professor" is four of the twelve seeded records. The org is one hop away and
  // is what a person would have said.
  if (node.type !== 'application') return label
  const org = memory.one(node.id, 'AT', 'organisation')
  return org ? `${label} — ${org.props.name}` : label
}

/**
 * A record, flattened for a model to read.
 *
 * `props` is spread rather than nested. A model asked to read
 * `result.props.stage` and then to pass `stage` to a write tool has to perform
 * one act of translation, and translation is where small models drop fields.
 * The three keys that are not props are prefixed so nothing can collide with a
 * prop of the same name.
 */
export type AgentRecord = { id: NodeId; type: NodeType; label: string } & Record<string, unknown>

/**
 * Props a model is not shown, by the type that carries them.
 *
 * The agent-side twin of `applicationFrom` dropping the same key. An
 * application's `noteFormat` is a list of offsets over its note: it costs
 * tokens on every read, it is meaningless to a model, and a model that tried to
 * reason about it would be reasoning about character positions in a string it
 * cannot see the formatting of. The note's TEXT is right there beside it.
 */
const HIDDEN_PROPS: Partial<Record<NodeType, readonly string[]>> = {
  application: ['noteFormat'],
}

/**
 * With `today`, the record also carries its derived fields — its deadline, its
 * employer, how many of its dates are overdue — the facts a person asks about
 * that live on OTHER records. See `record-query.ts`. Without it, props only:
 * `graph.query` renders rows for the canvas, which has no use for them.
 */
export const render = (node: StoredNode, memory: GraphSnapshot, today?: ISODate): AgentRecord => {
  const props = { ...(node.props as Record<string, unknown>) }
  for (const key of HIDDEN_PROPS[node.type] ?? []) delete props[key]
  return {
    id: node.id,
    type: node.type,
    label: labelOf(node, memory),
    ...props,
    ...(today === undefined ? {} : derivedFields(node, memory, today)),
  }
}
