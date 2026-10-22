/**
 * L3.5 — the questions about records that are not questions about structure.
 *
 * `graph.query` answers "which applications HAVE a follow-up" and "how are these
 * two joined". It cannot answer "which application's deadline is furthest
 * away", "what did I submit first", "how many are at each stage" or "how long
 * do replies take", because those are about the VALUES on records — a date
 * compared with today, a field sorted, records counted by a field — and there
 * was no read that could filter, order, group or add anything up.
 *
 * So a model asked one of those listed every record of a kind and did the
 * arithmetic itself, which is the step a small model gets wrong. Measured, the
 * question that started this: asked "which application has the deadline
 * furthest in the future?", Gemma 4 listed the applications, found that no
 * application has a deadline field — a deadline is a timeline item joined by
 * `ABOUT` — and answered with the one date that looked like a deadline, Baylor's
 * offer respond-by. The real answer, UNT, was on a record it never saw.
 *
 * ## Two halves
 *
 * DERIVED FIELDS put the facts a person asks about onto the record they ask
 * about. An application carries its `deadline`, `employer`, `keywords`, how
 * many of its dates are `upcoming` and `overdue`, and how long a reply took; a
 * timeline item carries the application it is about and whether it is `done`
 * or `overdue`. These are computed on read and never stored, so they cannot
 * drift from the records they summarise — and because `render` shows them,
 * even a plain listing now has the answer in it.
 *
 * THE QUERY filters, orders, groups and aggregates over those fields, stored
 * and derived alike: conditions with comparison operators, dates relative to
 * today, a sort, a limit, counts per value, and min / max / average / sum. All
 * of it is a STRUCTURE the model fills in, parsed by the same schema as every
 * other tool input — there is no query string, so there is nothing to inject
 * and nothing for a bad generation to do except fail the parse and be told why.
 *
 * Pure, and `today` is an argument: nothing here may read a clock.
 */

import { addDays, daysBetween } from '../core/dates'
import { TAGGABLE } from '../core/model'
import type { ISODate, NodeType, Rel, StoredNode } from '../core/model'
import type { GraphSnapshot } from '../core/snapshot'

/* ------------------------------- the fields ------------------------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const isDate = (v: unknown): v is string => typeof v === 'string' && ISO_DATE.test(v.slice(0, 10))

/** The date part of a date or an instant — an instant's own day, as written. */
const dayPart = (v: string): string => v.slice(0, 10)

const isOpen = (item: StoredNode<'timelineItem'>) => item.props.completedOn === undefined

/**
 * The facts about a record that live on OTHER records, computed for one.
 *
 * Named for what a person says rather than for where the data is: nobody asks
 * for "the date of the open timeline item of kind deadline joined by ABOUT",
 * they ask for "the deadline". Absent rather than null when there is nothing,
 * so a record never claims a deadline of `null` and a filter for `exists`
 * means what it says.
 */
type Derived = {
  keywords?: string[]
  employer?: string
  employers?: string[]
  deadline?: ISODate
  upcoming?: number
  /** A count on an application, a yes/no on a timeline item. */
  overdue?: number | boolean
  daysToReply?: number
  application?: string
  done?: boolean
  daysAway?: number
}

export function derivedFields(node: StoredNode, memory: GraphSnapshot, today: ISODate): Derived {
  const out: Derived = {}

  if ((TAGGABLE as readonly string[]).includes(node.type)) {
    const keywords = memory
      .many(node.id, 'TAGS', 'in', 'keyword')
      .map((k) => k.props.name)
    if (keywords.length > 0) out.keywords = keywords
  }

  if (node.type === 'application') {
    const org = memory.one(node.id, 'AT', 'organisation')
    if (org) out.employer = org.props.name

    const items = memory.many(node.id, 'ABOUT', 'in', 'timelineItem').filter(isOpen)
    const ahead = items
      .filter((i) => i.props.date >= today)
      .sort((a, b) => a.props.date.localeCompare(b.props.date))
    const deadline = ahead.find((i) => i.props.kind === 'deadline')
    // The NEXT open deadline, not the last: "when is it due" means the date
    // still in front of you, and a deadline already met is no longer one.
    if (deadline) out.deadline = deadline.props.date
    // Only what no other query reaches. Every field here is paid for on every
    // record of every listing, against `renderOutcome`'s 6,000-character cap,
    // and a twelve-application demo store went over it at 6,664 with the next
    // event's date and title, an offer's respond-by and days-since-sent on
    // board too. Each of those is one sort away: the next event is the open
    // timeline items in date order, the longest wait is `orderBy submittedOn`.
    out.upcoming = ahead.length
    out.overdue = items.filter((i) => i.props.date < today).length

    const p = (node as StoredNode<'application'>).props
    const sent = p.submittedOn ?? p.appliedOn
    if (isDate(sent) && isDate(p.firstReplyOn)) out.daysToReply = daysBetween(dayPart(sent), dayPart(p.firstReplyOn))
  }

  if (node.type === 'timelineItem') {
    const item = node as StoredNode<'timelineItem'>
    const apps = memory.many(node.id, 'ABOUT', 'out', 'application')
    const first = apps[0]
    if (first) {
      // "role — employer", the way an application is named everywhere else.
      // The bare role was measured ambiguous: grouped by it, GPT-OSS answered
      // "CS" and "ECE" for applications at three different universities.
      const org = memory.one(first.id, 'AT', 'organisation')
      out.application = org ? `${first.props.role} — ${org.props.name}` : first.props.role
      if (org) out.employer = org.props.name
    }
    out.done = !isOpen(item)
    out.overdue = isOpen(item) && item.props.date < today
    out.daysAway = daysBetween(today, item.props.date)
  }

  if (['link', 'file', 'snippet', 'person', 'thread'].includes(node.type)) {
    const apps = memory.many(node.id, 'FILED_UNDER', 'out', 'application')
    if (apps.length > 0) {
      out.employers = [
        ...new Set(
          apps
            .map((a) => memory.one(a.id, 'AT', 'organisation')?.props.name)
            .filter((n): n is string => typeof n === 'string'),
        ),
      ]
    }
  }

  return out
}

/** A record's stored and derived fields, flat, as the query reads them. */
export type FieldBag = Readonly<Record<string, unknown>>

/**
 * The parts of a date a question groups or filters by.
 *
 * "How many did I submit each month" is `groupBy submittedOn.month`; without
 * this the model has to list every record and bucket the dates itself, which
 * is the arithmetic this module exists to take off it. Written as strings that
 * sort the way they read — `2026-09`, `2026-W38` — so ordering a group by its
 * value is chronological.
 */
export const DATE_PARTS = ['year', 'month', 'week', 'weekday', 'day'] as const
type DatePart = (typeof DATE_PARTS)[number]

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
/** A known Monday, so a weekday is a remainder and no clock or `Date` is needed. */
const A_MONDAY = '2024-01-01'

function datePart(iso: string, part: DatePart): string {
  const day = dayPart(iso)
  if (part === 'day') return day
  if (part === 'year') return day.slice(0, 4)
  if (part === 'month') return day.slice(0, 7)
  const index = (((daysBetween(A_MONDAY, day) % 7) + 7) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6
  if (part === 'weekday') return WEEKDAYS[index]
  // ISO 8601: a week belongs to the year its Thursday is in.
  const thursday = addDays(day, 3 - index)
  const year = thursday.slice(0, 4)
  const week = Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1
  return `${year}-W${String(week).padStart(2, '0')}`
}

/**
 * `days(submittedOn, firstReplyOn)`: the whole days between two date fields,
 * in either order.
 *
 * Unsigned, because "how long" has no direction in the question and the model
 * picks one anyway. Measured: asked for replies more than three weeks after
 * submitting, GPT-OSS wrote `days(firstReplyOn, submittedOn) gt 21`, every gap
 * came out negative, and it answered that there were none.
 */
const DAYS_BETWEEN = /^\s*days\(\s*([\w.]+)\s*,\s*([\w.]+)\s*\)\s*$/

/** `offer.respondBy` and the like: one level of dots, which is all any record nests. */
function pathOf(bag: FieldBag, field: string): unknown {
  if (field in bag) return bag[field]
  const [head, ...rest] = field.split('.')
  let v: unknown = head === undefined ? undefined : bag[head]
  for (const key of rest) {
    if (v === null || typeof v !== 'object') return undefined
    v = (v as Record<string, unknown>)[key]
  }
  return v
}

/**
 * A field's value: a stored or derived field, a dotted path into one, a part
 * of a date (`date.month`), or the days between two dates (`days(a, b)`).
 */
export function fieldOf(bag: FieldBag, field: string): unknown {
  const between = DAYS_BETWEEN.exec(field)
  if (between) {
    const from = pathOf(bag, between[1] ?? '')
    const to = pathOf(bag, between[2] ?? '')
    return isDate(from) && isDate(to) ? Math.abs(daysBetween(dayPart(from), dayPart(to))) : undefined
  }
  const direct = pathOf(bag, field)
  if (direct !== undefined) return direct
  const cut = field.lastIndexOf('.')
  const part = field.slice(cut + 1) as DatePart
  if (cut > 0 && DATE_PARTS.includes(part)) {
    const base = pathOf(bag, field.slice(0, cut))
    if (isDate(base)) return datePart(base, part)
  }
  return undefined
}

/** Whether a field name means something for records with these fields. */
function knownField(known: ReadonlySet<string>, field: string): boolean {
  if (known.has(field)) return true
  const between = DAYS_BETWEEN.exec(field)
  if (between) return knownField(known, between[1] ?? '') && knownField(known, between[2] ?? '')
  const cut = field.lastIndexOf('.')
  return cut > 0 && DATE_PARTS.includes(field.slice(cut + 1) as DatePart) && known.has(field.slice(0, cut))
}

/* ------------------------------ the conditions ---------------------------- */

export const OPS = ['eq', 'ne', 'in', 'contains', 'excludes', 'gt', 'gte', 'lt', 'lte', 'exists', 'missing'] as const
export type Op = (typeof OPS)[number]

export type Condition = { readonly field: string; readonly op: Op; readonly value?: unknown }

/**
 * `today`, `today+7`, `today-30` → a date; anything else, unchanged.
 *
 * Because "overdue" and "in the next week" are relative, and a model asked to
 * work out the date of "a week from now" before it can ask the question is a
 * model doing arithmetic it might get wrong, on a value it then cannot check.
 */
export function resolveValue(value: unknown, today: ISODate): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, today))
  if (typeof value !== 'string') return value
  const m = /^\s*today\s*(?:([+-])\s*(\d+)\s*d?(?:ays?)?)?\s*$/i.exec(value)
  if (!m) return value
  const n = m[2] === undefined ? 0 : Number(m[2]) * (m[1] === '-' ? -1 : 1)
  return addDays(today, n)
}

const fold = (v: unknown): unknown => (typeof v === 'string' ? v.trim().toLowerCase() : v)

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const

/**
 * A month number from what a person might write for one: 11, "11", "Nov",
 * "November". Null for anything else.
 */
function monthNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 12 ? v : null
  if (typeof v !== 'string') return null
  const t = v.trim().toLowerCase()
  if (/^\d{1,2}$/.test(t)) return monthNumber(Number(t))
  const at = MONTHS.indexOf(t.slice(0, 3) as (typeof MONTHS)[number])
  return at >= 0 && t.length >= 3 ? at + 1 : null
}

const YEAR_MONTH = /^\d{4}-\d{2}$/

/**
 * Comparable forms of two values, or null when they cannot be ordered.
 *
 * Dates compare as dates — an instant against a day compares on its day, so
 * `lastActionAt gte today-7` works — numbers as numbers, and text without case.
 * A boolean may be compared with its spelling, because `"true"` is what a model
 * writes as often as `true`.
 */
function comparable(a: unknown, b: unknown): [number | string, number | string] | null {
  if (isDate(a) && isDate(b)) return [dayPart(a), dayPart(b)]
  // A year-month against a bare month compares the months — see `equal`.
  if (typeof a === 'string' && YEAR_MONTH.test(a) && !(typeof b === 'string' && YEAR_MONTH.test(b))) {
    const n = monthNumber(b)
    if (n !== null) return [Number(a.slice(5)), n]
  }
  const na = typeof a === 'number' ? a : typeof a === 'string' && a.trim() !== '' ? Number(a) : NaN
  const nb = typeof b === 'number' ? b : typeof b === 'string' && b.trim() !== '' ? Number(b) : NaN
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return [na, nb]
  if (typeof a === 'string' && typeof b === 'string') return [a.toLowerCase(), b.toLowerCase()]
  return null
}


function equal(a: unknown, b: unknown): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a).toLowerCase() === String(b).toLowerCase()
  /*
   * `date.month eq 11` is how a model writes "in November" — measured, Gemma
   * sent exactly that, against a field that reads "2026-11". The year is the
   * one in the record; the question named only the month.
   */
  for (const [ym, other] of [[a, b], [b, a]] as const) {
    if (typeof ym === 'string' && YEAR_MONTH.test(ym) && !(typeof other === 'string' && YEAR_MONTH.test(other))) {
      const n = monthNumber(other)
      if (n !== null) return Number(ym.slice(5)) === n
    }
  }
  const c = comparable(a, b)
  return c === null ? a === b : c[0] === c[1]
}

function contains(have: unknown, want: unknown): boolean {
  if (Array.isArray(have)) return have.some((h) => equal(h, want) || contains(h, want))
  if (typeof have === 'string' && typeof want === 'string') return have.toLowerCase().includes(want.toLowerCase())
  return false
}

export function test(bag: FieldBag, c: Condition, today: ISODate): boolean {
  const have = fieldOf(bag, c.field)
  const want = resolveValue(c.value, today)
  const present = have !== undefined && have !== null && !(Array.isArray(have) && have.length === 0)
  switch (c.op) {
    case 'exists':
      return present
    case 'missing':
      return !present
    case 'eq':
      return Array.isArray(have) ? have.some((h) => equal(h, want)) : equal(have, want)
    case 'ne':
      return Array.isArray(have) ? !have.some((h) => equal(h, want)) : !equal(have, want)
    case 'in': {
      const options = Array.isArray(want) ? want : [want]
      return Array.isArray(have)
        ? have.some((h) => options.some((o) => equal(h, o)))
        : options.some((o) => equal(have, o))
    }
    case 'contains':
      return contains(have, want)
    case 'excludes':
      // "Not located in TX" includes the record with no location at all.
      return !contains(have, want)
    default: {
      if (!present) return false
      const pair = comparable(have, want)
      if (pair === null) return false
      const [x, y] = pair
      if (c.op === 'gt') return x > y
      if (c.op === 'gte') return x >= y
      if (c.op === 'lt') return x < y
      return x <= y
    }
  }
}

/* -------------------------------- the query ------------------------------- */

export const AGGREGATES = ['count', 'min', 'max', 'avg', 'median', 'sum'] as const
export type Aggregate = (typeof AGGREGATES)[number]

/**
 * A test on the records JOINED to each record, not on the record itself.
 *
 * "Applications with an interview in November" is a question about one
 * timeline item's kind AND its date together. Two field conditions on the
 * application cannot say that — they would match an application with a
 * November deadline and a December interview — so the conditions here are
 * applied to each linked record, and the count of linked records that pass
 * is what is tested: at least one by default, `atMost: 0` for "none".
 */
export type RelatedTest = {
  readonly type: NodeType
  readonly rel?: Rel
  readonly where?: readonly Condition[]
  readonly atLeast?: number
  readonly atMost?: number
}

export type RecordQuery = {
  readonly where?: readonly Condition[]
  /** At least one of these must pass, as well as every `where`. */
  readonly any?: readonly Condition[]
  readonly related?: readonly RelatedTest[]
  readonly orderBy?: string
  readonly order?: 'asc' | 'desc'
  readonly groupBy?: string
  readonly aggregate?: Aggregate
  /** The field `aggregate` works over. Not needed for `count`. */
  readonly of?: string
}

/**
 * One record as the query sees it, with what the caller will show for it, and
 * a way to reach the records joined to it (absent: it has none to reach).
 */
export type Row<R> = {
  readonly bag: FieldBag
  readonly shown: R
  readonly linked?: (type: NodeType, rel?: Rel) => readonly FieldBag[]
}

export type QueryAnswer<R> =
  | { readonly kind: 'rows'; readonly rows: readonly R[]; readonly hint?: string }
  | { readonly kind: 'groups'; readonly groups: readonly Group[] }
  | { readonly kind: 'value'; readonly value: AggregateValue }
  | { readonly kind: 'refused'; readonly hint: string }

export type Group = { readonly value: unknown; readonly count: number; readonly [k: string]: unknown }
export type AggregateValue = { readonly of?: string; readonly count: number; readonly [k: string]: unknown }

/** Missing values last, in BOTH directions — a record with no deadline is not the "furthest" one. */
function compareBy(field: string, order: 'asc' | 'desc') {
  return (a: FieldBag, b: FieldBag): number => {
    const x = fieldOf(a, field)
    const y = fieldOf(b, field)
    const xm = x === undefined || x === null
    const ym = y === undefined || y === null
    if (xm || ym) return xm === ym ? 0 : xm ? 1 : -1
    const pair = comparable(x, y)
    if (pair === null) return 0
    const d = pair[0] < pair[1] ? -1 : pair[0] > pair[1] ? 1 : 0
    return order === 'asc' ? d : -d
  }
}

/** A field's values as numbers (or dates, for min / max), skipping the ones that are not. */
function numbersOf(bags: readonly FieldBag[], field: string): { nums: number[]; dates: string[] } {
  const nums: number[] = []
  const dates: string[] = []
  for (const b of bags) {
    const v = fieldOf(b, field)
    if (typeof v === 'number' && Number.isFinite(v)) nums.push(v)
    else if (isDate(v)) dates.push(dayPart(v))
    else if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) nums.push(Number(v))
  }
  return { nums, dates }
}

const round = (n: number) => Math.round(n * 100) / 100

function aggregateOver(bags: readonly FieldBag[], fn: Aggregate, field: string | undefined): AggregateValue {
  if (fn === 'count' || field === undefined) return { count: bags.length }
  const { nums, dates } = numbersOf(bags, field)
  if (dates.length > 0 && nums.length === 0) {
    const sorted = [...dates].sort()
    return { of: field, count: dates.length, min: sorted[0], max: sorted[sorted.length - 1] }
  }
  if (nums.length === 0) return { of: field, count: 0 }
  const sum = nums.reduce((a, b) => a + b, 0)
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
  // Every figure at once, whichever was asked for: they cost a few tokens, and
  // "the average — and what was the longest?" is then one call, not two.
  return {
    of: field,
    count: nums.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: round(sum / nums.length),
    median: round(median),
    sum: round(sum),
  }
}

/** Every field any of these records has, for the refusal that names them. */
export function fieldsOf(bags: readonly FieldBag[]): string[] {
  const keys = new Set<string>()
  for (const b of bags) {
    for (const [k, v] of Object.entries(b)) {
      keys.add(k)
      if (v && typeof v === 'object' && !Array.isArray(v)) for (const sub of Object.keys(v)) keys.add(`${k}.${sub}`)
    }
  }
  return [...keys].sort()
}

/**
 * Runs a query over rows already built for one record type.
 *
 * Unknown fields are REFUSED with the list of real ones rather than matching
 * nothing. A filter on `dueDate` that silently returned zero records would be
 * read as "nothing is due", which is a confident wrong answer; a refusal that
 * says the field is called `deadline` is a one-call recovery.
 */
export function runRecordQuery<R>(
  rows: readonly Row<R>[],
  q: RecordQuery,
  today: ISODate,
  type: NodeType,
  /**
   * The fields a kind of record DECLARES, whether or not any record has one.
   *
   * Without it, "known" meant "present on some record": measured, GPT-OSS
   * sorted by `appliedOn` — a real field that no demo application had filled
   * in — and was told no application has it. A sort on a field nobody filled
   * is an answer (every record goes last); a refusal is a false statement.
   */
  declared: (type: NodeType) => readonly string[] = () => [],
): QueryAnswer<R> {
  const bags = rows.map((r) => r.bag)
  const known = new Set([...fieldsOf(bags), ...declared(type)])
  const named = [
    ...(q.where ?? []).map((c) => c.field),
    ...(q.any ?? []).map((c) => c.field),
    ...(q.orderBy ? [q.orderBy] : []),
    ...(q.groupBy ? [q.groupBy] : []),
    ...(q.of ? [q.of] : []),
  ]
  // Only when there ARE records: with none, every field is unknown and the
  // honest answer is "there are none", not "no such field".
  const unknown = rows.length === 0 ? [] : named.filter((f) => !knownField(known, f))
  if (unknown.length > 0) {
    return {
      kind: 'refused',
      hint: `No ${type} has ${unknown.map((f) => `"${f}"`).join(' or ')}. The fields it has are: ${[...known].join(', ')}.`,
    }
  }
  if (q.aggregate !== undefined && q.aggregate !== 'count' && !q.of) {
    return { kind: 'refused', hint: `"${q.aggregate}" needs "of": the field to work it out over.` }
  }
  // The same refusal for the joined records, checked against the ones that
  // are actually joined — a field of a timeline item, not of an application.
  for (const t of q.related ?? []) {
    const linked = rows.flatMap((r) => r.linked?.(t.type, t.rel) ?? [])
    if (linked.length === 0) continue
    const theirs = new Set([...fieldsOf(linked), ...declared(t.type)])
    const bad = (t.where ?? []).map((c) => c.field).filter((f) => !knownField(theirs, f))
    if (bad.length > 0) {
      return {
        kind: 'refused',
        hint: `No linked ${t.type} has ${bad.map((f) => `"${f}"`).join(' or ')}. The fields it has are: ${[...theirs].join(', ')}.`,
      }
    }
  }

  const relatedOk = (r: Row<R>, t: RelatedTest): boolean => {
    const passing = (r.linked?.(t.type, t.rel) ?? []).filter((b) =>
      (t.where ?? []).every((c) => test(b, c, today)),
    ).length
    // `atMost` alone means "no more than", so it must not ALSO demand one.
    const floor = t.atLeast ?? (t.atMost === undefined ? 1 : 0)
    return passing >= floor && (t.atMost === undefined || passing <= t.atMost)
  }

  let kept = rows.filter(
    (r) =>
      (q.where ?? []).every((c) => test(r.bag, c, today)) &&
      (q.any === undefined || q.any.length === 0 || q.any.some((c) => test(r.bag, c, today))) &&
      (q.related ?? []).every((t) => relatedOk(r, t)),
  )

  if (q.groupBy) {
    const field = q.groupBy
    const groups = new Map<string, { value: unknown; bags: FieldBag[] }>()
    for (const r of kept) {
      const v = fieldOf(r.bag, field)
      // A record in two groups when the field is a list — a CV filed under two
      // keywords counts once under each, which is what "per keyword" means.
      const values = Array.isArray(v) ? (v.length > 0 ? v : [null]) : [v ?? null]
      for (const value of values) {
        const key = JSON.stringify(fold(value))
        const g = groups.get(key) ?? { value, bags: [] as FieldBag[] }
        g.bags.push(r.bag)
        groups.set(key, g)
      }
    }
    const out: Group[] = [...groups.values()].map((g) => {
      const agg = q.aggregate && q.aggregate !== 'count' ? aggregateOver(g.bags, q.aggregate, q.of) : null
      const { count: _count, of: _of, ...figures } = agg ?? { count: 0 }
      return { value: g.value, count: g.bags.length, ...figures }
    })
    // Biggest first, ties by value so the answer does not depend on which
    // record was edited last. `orderBy` naming the grouped field sorts by the
    // value instead — "per month, in order" is a timeline, not a ranking.
    const byValue = compareBy('value', q.order ?? 'asc')
    const ordered = [...out].sort((a, b) =>
      q.orderBy === field ? byValue(a, b) : b.count - a.count || byValue(a, b),
    )
    return { kind: 'groups', groups: ordered }
  }

  if (q.aggregate) return { kind: 'value', value: aggregateOver(kept.map((r) => r.bag), q.aggregate, q.of) }

  if (q.orderBy) {
    const by = compareBy(q.orderBy, q.order ?? 'asc')
    kept = [...kept].sort((a, b) => by(a.bag, b.bag))
  }
  const hint =
    kept.length === 0
      ? (unlinked(rows, q.related ?? []) ?? whyNothing(bags, [...(q.where ?? []), ...(q.any ?? [])]))
      : undefined
  return { kind: 'rows', rows: kept.map((r) => r.shown), ...(hint === undefined ? {} : { hint }) }
}

/**
 * A `related` test over a kind nothing here is linked to.
 *
 * Measured: Gemma listed timeline items with `related: [{type: 'timelineItem',
 * …}]` — the conditions it meant for the items themselves — got zero records
 * because a timeline item is not linked to other timeline items, and answered
 * that there were no interviews. The empty list could not tell it the test was
 * aimed at nothing.
 */
function unlinked<R>(rows: readonly Row<R>[], related: readonly RelatedTest[]): string | undefined {
  if (rows.length === 0) return undefined
  const none = related.filter((t) => rows.every((r) => (r.linked?.(t.type, t.rel) ?? []).length === 0))
  if (none.length === 0) return undefined
  const kinds = [...new Set(none.map((t) => t.type))].join(', ')
  return `Nothing matched: none of these records is linked to any ${kinds}. To test the records themselves, put those conditions in "where" instead.`
}

/**
 * What the tested fields actually hold, when a filter matched nothing.
 *
 * Measured: asked "which applications are located in Houston?", GPT-OSS 120B
 * sent `location eq "Houston"`, got zero records — every location is
 * "Houston, TX" — and answered that there are none, twice. An empty list is
 * indistinguishable from an empty store, so the values are named, and so is
 * the operator that matches part of one.
 */
function whyNothing(bags: readonly FieldBag[], where: readonly Condition[]): string | undefined {
  if (bags.length === 0) return undefined
  const parts: string[] = []
  for (const c of where) {
    if (c.op !== 'eq' && c.op !== 'in' && c.op !== 'contains') continue
    const seen = new Set<string>()
    for (const b of bags) {
      const v = fieldOf(b, c.field)
      for (const x of Array.isArray(v) ? v : [v]) {
        if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') seen.add(String(x))
      }
    }
    if (seen.size === 0) continue
    const sample = [...seen].slice(0, 8).map((v) => `"${v}"`).join(', ')
    parts.push(`"${c.field}" holds ${sample}${seen.size > 8 ? ', …' : ''}.`)
  }
  if (parts.length === 0) return undefined
  return `Nothing matched. ${parts.join(' ')} "eq" matches a whole value; "contains" matches part of one.`
}
