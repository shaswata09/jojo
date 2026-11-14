/**
 * `memory.list`: listing, filtering, sorting, counting and adding up, with the
 * schema pieces and the input repairs that only it uses.
 */

import { NODE_TYPES } from '../../core/model'
import type { ISODate, NodeId, NodeType, Rel, StoredNode } from '../../core/model'
import { s } from '../../core/schema'
import type { GraphSnapshot } from '../../core/snapshot'
import { NODE_PROP_SCHEMAS } from '../../core/validate'
import { AGGREGATES, OPS, fieldOf, fieldsOf, runRecordQuery } from '../record-query'
import type { Condition, RecordQuery, RelatedTest, Row } from '../record-query'
import { labelOf, render } from '../records'
import type { AgentRecord } from '../records'
import { defineRead } from './define'
import { limit, matched, nodeType } from './shared'

/**
 * One test on a field, for `memory.list`'s `where`.
 *
 * `value` is untyped on purpose: a date, a number, a stage, a list for `in` —
 * the field decides, and `record-query.ts` compares each kind as itself.
 */
const condition = s.object({
  field: s.string({ label: 'Field', description: 'e.g. stage, deadline, date.month, offer.respondBy.', min: 1 }),
  op: s.enum(OPS, { label: 'Test' }),
  value: s.optional(s.unknown({ label: 'Value', description: '"today", "today+7" work for dates; a list for "in".' })),
})

/**
 * A test on the records joined to each one — see `RelatedTest`.
 *
 * Its own `where` is plain conditions, one level deep and no further: a model
 * fills this in, and a recursive schema is one a small model cannot finish.
 *
 * Cut to the bone because every byte of it is in every request. The first
 * version spelled the seventeen record kinds out again, offered `rel` with its
 * nine relationships, and repeated the long field note in a third copy of the
 * condition: `memory.list` came to 1,425 tokens and the request grew by ~900.
 * The kind is text checked on read (a refusal lists the real ones), `rel` is
 * left to the engine — the linked kind already says which link is meant — and
 * the field note is said once, in the summary.
 */
const relatedTest = s.object({
  type: s.string({ label: 'Linked kind', description: 'e.g. timelineItem.', min: 1 }),
  where: s.optional(s.array(condition, { label: 'Where' })),
  atLeast: s.optional(s.number({ label: 'At least', description: 'Default 1.', min: 0 })),
  atMost: s.optional(s.number({ label: 'At most', description: '0 means none.', min: 0 })),
})

type ListInput = {
  type: NodeType
  limit?: number
  offset?: number
  fields?: readonly string[]
  match?: 'all' | 'any'
  where?: RecordQuery['where']
  related?: readonly (Omit<RelatedTest, 'type'> & { type: string })[]
} & Omit<RecordQuery, 'where' | 'any' | 'related'>

/**
 * A related test written flat — `{type, field, op, value}` — read as the one
 * condition it plainly is.
 *
 * Measured: Gemma wrote exactly that for "an interview in November", twice.
 * The schema lets unknown keys through (stored records need it to), so the
 * condition was silently dropped and the test became "has any timeline item",
 * which every application with a date passes.
 */
function liftCondition(t: Omit<RelatedTest, 'type'> & { type: string }): RelatedTest {
  const flat = t as typeof t & { field?: unknown; op?: unknown; value?: unknown }
  const lifted =
    t.where === undefined && typeof flat.field === 'string' && (OPS as readonly unknown[]).includes(flat.op)
      ? [{ field: flat.field, op: flat.op as Condition['op'], ...(flat.value === undefined ? {} : { value: flat.value }) }]
      : t.where
  return {
    type: t.type as NodeType,
    ...(t.rel === undefined ? {} : { rel: t.rel }),
    ...(lifted === undefined ? {} : { where: lifted }),
    ...(t.atLeast === undefined ? {} : { atLeast: t.atLeast }),
    ...(t.atMost === undefined ? {} : { atMost: t.atMost }),
  }
}

/** Every prop a kind of record declares, and one level into the objects among them. */
const declaredFields = (type: NodeType): readonly string[] => {
  const fields = NODE_PROP_SCHEMAS[type].meta.fields ?? {}
  return Object.entries(fields).flatMap(([key, meta]) => [
    key,
    ...Object.keys(meta.fields ?? {}).map((sub) => `${key}.${sub}`),
  ])
}

/**
 * Condition values that are record ids, read as those records' names.
 *
 * Measured: Gemma found the keyword with `memory.search`, then filtered on
 * `keywords contains "kw:01a1…"` — the id it had just been handed — against a
 * field that holds keyword NAMES, and matched nothing. Ids are what every
 * other tool takes, so a model carrying one into a filter is doing the
 * expected thing. Left alone where the field really holds that id (`id`
 * itself), so an id filter still means the id.
 */
function byName<R>(q: RecordQuery, rows: readonly Row<R>[], memory: GraphSnapshot): RecordQuery {
  const named = (c: Condition): Condition => {
    const one = (v: unknown): unknown => {
      if (typeof v !== 'string') return v
      const node = memory.node(v as NodeId)
      if (!node) return v
      const held = rows.some((r) => {
        const have = fieldOf(r.bag, c.field)
        return Array.isArray(have) ? have.includes(v) : have === v
      })
      return held ? v : labelOf(node, memory)
    }
    if (c.value === undefined) return c
    return { ...c, value: Array.isArray(c.value) ? c.value.map(one) : one(c.value) }
  }
  return {
    ...q,
    ...(q.where === undefined ? {} : { where: q.where.map(named) }),
    ...(q.any === undefined ? {} : { any: q.any.map(named) }),
  }
}

/** Always kept by `fields`, because a record a model cannot name or act on is no answer. */
const ALWAYS_SHOWN = ['id', 'type', 'label'] as const

/**
 * Listing, filtering, sorting, counting and adding up — one tool, not five.
 *
 * ## Why here and not a new tool
 *
 * Every schema in the catalogue is paid for in every request. A separate
 * `records.query` would repeat `type` and `limit` and still need this tool
 * beside it; the extra fields here are optional, so a plain listing is the
 * call it always was. And `memory.list` is where a model already goes for
 * these questions — measured, it is the FIRST call both Gemma and GPT-OSS
 * made for "which deadline is furthest away" — so the capability is where
 * the attempt is, rather than in a tool it would have to discover.
 *
 * Records here always carry their derived fields (`render` with `today`), so
 * even the unfiltered list shows each application's deadline.
 */
export const memoryList = defineRead({
  name: 'memory.list',
  title: 'List records',
  summary:
    'Records of one kind, newest first — or filtered (where), filtered by linked records (related), sorted (orderBy), counted per value (groupBy), or summed up (aggregate). Any field may be a date part (submittedOn.month, .year, .week, .weekday) or days(a, b), the days between two date fields. Applications also show: deadline, employer, keywords, upcoming, overdue, daysToReply. Timeline items: application, employer, done, overdue, daysAway.',
  effect: 'read',
  input: s.object({
    type: nodeType('Kind', 'Which kind of record to list.'),
    where: s.optional(s.array(condition, { label: 'Where', description: 'Keep records passing these tests.' })),
    match: s.optional(s.enum(['all', 'any'] as const, { label: 'Match', description: 'all tests (default) or any one.' })),
    related: s.optional(
      s.array(relatedTest, {
        label: 'Related',
        description: 'Keep records by their linked records, e.g. applications with an interview in November, or none.',
      }),
    ),
    orderBy: s.optional(s.string({ label: 'Order by', description: 'A field to sort on. Records without it go last.' })),
    order: s.optional(s.enum(['asc', 'desc'] as const, { label: 'Order', description: 'asc (earliest, smallest first; the default) or desc.' })),
    groupBy: s.optional(s.string({ label: 'Group by', description: 'Count records per value of this field instead of listing them.' })),
    aggregate: s.optional(s.enum(AGGREGATES, { label: 'Aggregate', description: 'Figures over the records (per group, with groupBy).' })),
    of: s.optional(s.string({ label: 'Of', description: 'The field the aggregate works over.' })),
    fields: s.optional(s.array(s.string({ min: 1 }), { label: 'Fields', description: 'Show only these fields, to fit more records.' })),
    offset: s.optional(s.number({ label: 'Offset', description: 'Skip this many, to page on.', min: 0 })),
    limit,
  }),
  read: (memory, input: ListInput, ctx) => {
    const { view, linkedTo } = viewsOf(memory, ctx.today)

    const rows = [...memory.ofType(input.type)]
      // Newest first: a person asking "what did I add" means the recent end,
      // and a truncated list should keep the half they meant. `orderBy` sorts
      // stably over this, so ties keep it too.
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((n) => {
        const r = view(n)
        return { bag: r, shown: r, linked: linkedTo(n.id) }
      })

    const fields = input.fields ?? []
    const refused = refusalFor(input, fields, rows)
    if (refused !== undefined) return refused
    // `match: any` turns the one list into an OR; the engine keeps both lists,
    // so AND and OR together stay possible to anyone calling it directly.
    const { where, match, related, ...rest } = input
    const query: RecordQuery = {
      ...rest,
      ...(where === undefined ? {} : match === 'any' ? { any: where } : { where }),
      ...(related === undefined ? {} : { related: related.map(liftCondition) }),
    }
    const answer = runRecordQuery(rows, byName(query, rows, memory), ctx.today, input.type, declaredFields)
    if (answer.kind === 'refused') return { ok: false, hint: answer.hint }
    if (answer.kind === 'groups') return { total: answer.groups.length, groups: answer.groups }
    if (answer.kind === 'value') return answer.value

    const offset = Math.max(0, Math.floor(input.offset ?? 0))
    const page = matched(onlyFields(answer.rows, fields).slice(offset), input.limit)
    return {
      // `total` is every match, not what is left after the offset: "12 of 40,
      // starting at 20" is what a model paging through needs to know.
      ...page,
      total: answer.rows.length,
      ...(offset > 0 ? { offset } : {}),
      ...(answer.hint === undefined ? {} : { hint: answer.hint }),
    }
  },
})

/**
 * Rendered once per record per call, whoever asks: a record reached as a
 * row and again as a linked record of twenty others is one render, not
 * twenty-one — derived fields cross edges, so they are not free.
 */
function viewsOf(memory: GraphSnapshot, today: ISODate) {
  const rendered = new Map<NodeId, AgentRecord>()
  const view = (n: StoredNode): AgentRecord => {
    const hit = rendered.get(n.id)
    if (hit) return hit
    const r = render(n, memory, today)
    rendered.set(n.id, r)
    return r
  }
  const linkedTo = (id: NodeId) => (type: NodeType, rel?: Rel) =>
    memory
      .incident(id, rel)
      .map((e) => memory.node(e.from === id ? e.to : e.from))
      .filter((n): n is StoredNode => n !== undefined && n.type === type)
      .map(view)
  return { view, linkedTo }
}

/** A `fields` entry no record of the kind has, or a `related` kind that is not one. */
function refusalFor(
  input: ListInput,
  fields: readonly string[],
  rows: readonly Row<AgentRecord>[],
): { ok: false; hint: string } | undefined {
  if (fields.length > 0 && rows.length > 0) {
    const known = new Set([...fieldsOf(rows.map((r) => r.bag)), ...declaredFields(input.type)])
    const bad = fields.filter((f) => !known.has(f) && !known.has(f.split('.')[0] ?? f))
    if (bad.length > 0) {
      return {
        ok: false,
        hint: `No ${input.type} has ${bad.map((f) => `"${f}"`).join(' or ')}. The fields it has are: ${[...known].join(', ')}.`,
      }
    }
  }

  const strange = (input.related ?? []).map((t) => t.type).filter((t) => !(NODE_TYPES as readonly string[]).includes(t))
  if (strange.length > 0) {
    return { ok: false, hint: `"${strange.join('", "')}" is not a kind of record. The kinds are: ${NODE_TYPES.join(', ')}.` }
  }
  return undefined
}

/** The rows cut down to `fields`, plus `ALWAYS_SHOWN`; untouched when no fields were asked for. */
function onlyFields(rows: readonly AgentRecord[], fields: readonly string[]) {
  return fields.length === 0
    ? rows
    : rows.map((r) =>
        Object.fromEntries(
          [...ALWAYS_SHOWN, ...fields].filter((k) => r[k] !== undefined).map((k) => [k, r[k]]),
        ),
      )
}
