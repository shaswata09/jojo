/**
 * L1 — the s.* combinators, Schema<T>, FieldMeta, Parsed<T>.
 *
 * Hand-rolled rather than zod, ~130 lines of machinery. This app has written
 * input validation twice already (`validate` in
 * `components/applications/dialog/form-state.ts`, and
 * `normalizeUrl`/`parseUrl` in `components/vault/links/url.ts`), and
 * `FieldMeta` has to stay introspectable so the
 * command palette can generate a form from a tool's input schema.
 *
 * `FieldMeta` is therefore data, never a closure. The moment a validator's
 * shape is only knowable by running it, the palette can no longer draw a field
 * for it and every tool needs a hand-written form — which is the state the app
 * is in today, and the reason two of those forms disagree about whether a URL
 * is required.
 *
 * Unknown keys pass through rather than being dropped. A field written by a
 * newer build has to survive a round trip through an older one; a parser that
 * quietly rebuilt each object from the keys it recognised would turn "open the
 * app in a stale tab" into silent, permanent data loss, which is exactly the
 * failure R-1 ranks first. `put` below holds the single exception, and says
 * what was measured to earn it.
 */

import type { NodeType } from './model'
import { isNodeId, TYPE_PREFIX } from './ref'

/* ---------------------------------- meta ---------------------------------- */

export type FieldKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'literal'
  | 'array'
  | 'object'
  | 'record'
  | 'id'
  | 'date'
  | 'instant'
  | 'unknown'

/**
 * Everything a generated form needs and nothing it does not.
 *
 * No `default`, no `transform`, no refinement callback: each of those is a
 * behaviour the form would have to replicate to stay honest, and a form that
 * disagrees with the tool it submits to is worse than no form.
 */
export type FieldMeta = {
  kind: FieldKind
  /** Field label. Sentence case, no trailing colon. */
  label?: string
  /** One line under the field. Says why, not what. */
  description?: string
  optional?: boolean
  nullable?: boolean
  /** enum and literal. */
  options?: readonly (string | number | boolean)[]
  /** array and record element. */
  of?: FieldMeta
  /** object. */
  fields?: { readonly [key: string]: FieldMeta }
  /** id — which kind of record this points at, so the picker can be scoped. */
  nodeType?: NodeType
  /** string length, number value, array length. */
  min?: number
  max?: number
  multiline?: boolean
  placeholder?: string
}

/* --------------------------------- result --------------------------------- */

/** `path` is 'offer.respondBy' or 'keywords[2]', or '' for the root. */
export type Issue = { path: string; message: string }

export type Parsed<T> = { ok: true; value: T } | { ok: false; issues: readonly Issue[] }

export type Schema<T> = {
  readonly meta: FieldMeta
  /** Never throws. `path` is the caller's position, for nested messages. */
  parse(input: unknown, path?: string): Parsed<T>
}

export type Infer<S> = S extends Schema<infer T> ? T : never

const good = <T>(value: T): Parsed<T> => ({ ok: true, value })

const bad = <T>(path: string, message: string): Parsed<T> => ({
  ok: false,
  issues: [{ path, message }],
})

/**
 * Messages are addressed to the person who typed the value, not to the
 * developer: they surface under a field in the palette's generated form, where
 * "Expected string, received number" is a sentence about TypeScript rather than
 * about the thing they got wrong.
 */
function define<T>(meta: FieldMeta, parse: (input: unknown, path: string) => Parsed<T>): Schema<T> {
  return { meta, parse: (input, path = '') => parse(input, path) }
}

/* ------------------------------- primitives ------------------------------- */

type TextOptions = {
  label?: string
  description?: string
  min?: number
  max?: number
  multiline?: boolean
  placeholder?: string
}

/** Metadata is copied key by key: `exactOptionalPropertyTypes` makes an
 *  explicit `label: undefined` a different type from an absent one, and a
 *  spread of a partial options bag carries every absent key through as one. */
function metaOf(kind: FieldKind, o: TextOptions = {}): FieldMeta {
  const meta: FieldMeta = { kind }
  if (o.label !== undefined) meta.label = o.label
  if (o.description !== undefined) meta.description = o.description
  if (o.min !== undefined) meta.min = o.min
  if (o.max !== undefined) meta.max = o.max
  if (o.multiline !== undefined) meta.multiline = o.multiline
  if (o.placeholder !== undefined) meta.placeholder = o.placeholder
  return meta
}

function string(o: TextOptions = {}): Schema<string> {
  return define(metaOf('string', o), (input, path) => {
    if (typeof input !== 'string') return bad(path, 'Needs to be text.')
    if (o.min !== undefined && input.trim().length < o.min) {
      return bad(path, o.min === 1 ? 'Cannot be blank.' : `Needs at least ${o.min} characters.`)
    }
    if (o.max !== undefined && input.length > o.max) {
      return bad(path, `Needs to be ${o.max} characters or fewer.`)
    }
    return good(input)
  })
}

function number(o: TextOptions & { int?: boolean } = {}): Schema<number> {
  return define(metaOf('number', o), (input, path) => {
    // NaN and Infinity are numbers to `typeof` and are not numbers to anyone
    // else. Left in, a NaN fit score renders as 'NaN% fit' and sorts nowhere.
    if (typeof input !== 'number' || !Number.isFinite(input))
      return bad(path, 'Needs to be a number.')
    if (o.int && !Number.isInteger(input)) return bad(path, 'Needs to be a whole number.')
    if (o.min !== undefined && input < o.min) return bad(path, `Needs to be at least ${o.min}.`)
    if (o.max !== undefined && input > o.max) return bad(path, `Needs to be at most ${o.max}.`)
    return good(input)
  })
}

function boolean(o: TextOptions = {}): Schema<boolean> {
  return define(metaOf('boolean', o), (input, path) =>
    typeof input === 'boolean' ? good(input) : bad(path, 'Needs to be yes or no.'),
  )
}

function unknownValue(o: TextOptions = {}): Schema<unknown> {
  return define(metaOf('unknown', o), (input) => good(input))
}

function enumOf<V extends string>(values: readonly V[], o: TextOptions = {}): Schema<V> {
  const meta = { ...metaOf('enum', o), options: values }
  const allowed: ReadonlySet<string> = new Set(values)
  return define(meta, (input, path) =>
    typeof input === 'string' && allowed.has(input)
      ? good(input as V)
      : bad(path, `Needs to be one of: ${values.join(', ')}.`),
  )
}

function literal<V extends string | number | boolean>(value: V, o: TextOptions = {}): Schema<V> {
  const meta = { ...metaOf('literal', o), options: [value] }
  return define(meta, (input, path) =>
    input === value ? good(value) : bad(path, `Needs to be ${String(value)}.`),
  )
}

/* --------------------------------- dates ---------------------------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 'YYYY-MM-DD', and a day that exists.
 *
 * The shape check alone accepts '2026-02-31', which every consumer then renders
 * as a real deadline while `daysBetween` counts to the 3rd of March. Rebuilt
 * through UTC rather than a local Date for the reason the date-handling header
 * above `isoOf` in `core/dates.ts` gives: a local parse of a date-only string
 * shifts west of Greenwich.
 */
function isoDate(o: TextOptions = {}): Schema<string> {
  return define(metaOf('date', o), (input, path) => {
    if (typeof input !== 'string' || !ISO_DATE.test(input)) {
      return bad(path, 'Needs to be a date.')
    }
    const parts = input.split('-')
    const y = Number(parts[0])
    const m = Number(parts[1])
    const d = Number(parts[2])
    const at = new Date(Date.UTC(y, m - 1, d))
    const same = at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d
    return same ? good(input) : bad(path, 'That day does not exist.')
  })
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

/**
 * RFC3339, as `new Date().toISOString()` writes it, and an instant that exists.
 *
 * `Date.parse` on its own is not a format check, it is a guess: it reads '5' as
 * the 1st of May 2001, 'Mar 5 2026' as a real time and '2026' as new year's
 * day, and it rolls '2026-02-31T00:00:00.000Z' silently forward to the 3rd of
 * March — the same hole `isoDate` above already had to close for date-only
 * strings, and the reason this now gets the same shape-then-round-trip
 * treatment.
 *
 * The damage is not theoretical. A `lastActionAt` of '5' out of a hand-edited
 * or truncated backup is dated 2001 by `dayOf`, and the dashboard card renders
 * '9,246 days ago'; an `updatedAt` Date.parse merely tolerates comes out of
 * `agoLabel(u.slice(0, 10), today)` in the thread list as the literal string
 * 'undefined NaN', because `partsOf` splits it on '-' and gets NaN.
 *
 * A non-'Z' offset is allowed. Everything jojo mints is `toISOString()`, but a
 * page capture or a tool call can legitimately carry '+05:30', and rejecting a
 * real instant would be the worse of the two bugs.
 */
function instant(o: TextOptions = {}): Schema<string> {
  return define(metaOf('instant', o), (input, path) => {
    if (typeof input !== 'string') return bad(path, 'Needs to be a time.')
    const parts = RFC3339.exec(input)
    // `Date.parse` still earns its place next to the regex: given a string this
    // strictly shaped it is the strict-ISO parser, and it is what rejects
    // minute 60, second 60 and an offset of '+25:00' without a rule each.
    if (!parts || Number.isNaN(Date.parse(input))) return bad(path, 'Needs to be a time.')

    // Hour 24 parses — it means midnight the following day — so it is a
    // timestamp that changes its own date the moment anything reads it back.
    if (Number(parts[4]) > 23) return bad(path, 'That time does not exist.')

    const y = Number(parts[1])
    const m = Number(parts[2])
    const d = Number(parts[3])
    const at = new Date(Date.UTC(y, m - 1, d))
    const same = at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d
    return same ? good(input) : bad(path, 'That day does not exist.')
  })
}

function id(nodeType?: NodeType, o: TextOptions = {}): Schema<string> {
  const meta = metaOf('id', o)
  if (nodeType !== undefined) meta.nodeType = nodeType
  return define(meta, (input, path) =>
    // A bare id is never a valid key — see ref.ts. Accepting one here would
    // reintroduce the guess between the six records that answer to 'stripe'.
    /*
     * Six distinct failures wore one sentence, and the commonest was a lie.
     *
     * An ABSENT required key reaches here as `undefined` — `parseObject` only
     * skips a missing key when the field is optional — so a model that forgot a
     * field was told "Points at no record", which sends it looking for a record
     * when the fault is a key it never sent. Measured across three models, the
     * id class was the second-largest refusal bucket after the label bug, and
     * `application_123` / `keyword/67890` placeholders sit in it too.
     *
     * The empty and absent branches keep the plainest wording because
     * `core/validate.ts` reuses `formatIssues` for store-health diagnostics a
     * PERSON reads. Nothing here names a tool: `tool-form.ts` renders every id
     * field a human sees as a picker, so the other branches are model-only.
     */
    input === undefined
      ? bad(path, 'Required. Send this field.')
      : typeof input !== 'string'
        ? bad(path, 'Needs to be an id written as text.')
        : input.trim() === ''
          ? bad(path, 'Points at no record.')
          : isNodeId(input, nodeType)
            ? good(input)
            : bad(
                path,
                nodeType === undefined
                  ? 'Not an id. Send one exactly as a read tool returned it — not a name, a slug, or a placeholder.'
                  : // `TYPE_PREFIX`, not the type NAME: an application id begins
                    // `app:`, not `application:`. An example the model copies has
                    // to be one that parses.
                    `Not the id of a ${nodeType} record. Send one exactly as a read tool returned it, beginning "${TYPE_PREFIX[nodeType]}:" — not a name, a slug, or a placeholder.`,
              ),
  )
}

/* ------------------------------- composites ------------------------------- */

function optional<T>(inner: Schema<T>): Schema<T | undefined> {
  return define({ ...inner.meta, optional: true }, (input, path) =>
    input === undefined ? good(undefined) : inner.parse(input, path),
  )
}

function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return define({ ...inner.meta, nullable: true }, (input, path) =>
    input === null ? good(null) : inner.parse(input, path),
  )
}

function array<T>(of: Schema<T>, o: TextOptions = {}): Schema<T[]> {
  const meta = { ...metaOf('array', o), of: of.meta }
  return define(meta, (input, path) => {
    if (!Array.isArray(input)) return bad(path, 'Needs to be a list.')
    if (o.min !== undefined && input.length < o.min) return bad(path, `Needs at least ${o.min}.`)
    if (o.max !== undefined && input.length > o.max) return bad(path, `Needs at most ${o.max}.`)

    const value: T[] = []
    const issues: Issue[] = []
    for (let i = 0; i < input.length; i += 1) {
      const parsed = of.parse(input[i], `${path}[${i}]`)
      if (parsed.ok) value.push(parsed.value)
      else issues.push(...parsed.issues)
    }
    return issues.length > 0 ? { ok: false, issues } : good(value)
  })
}

function record<T>(of: Schema<T>, o: TextOptions = {}): Schema<Record<string, T>> {
  const meta = { ...metaOf('record', o), of: of.meta }
  return define(meta, (input, path) => {
    if (!isPlainObject(input)) return bad(path, 'Needs to be a set of values.')

    const value: Record<string, T> = {}
    const issues: Issue[] = []
    for (const key of Object.keys(input)) {
      const parsed = of.parse(input[key], path ? `${path}.${key}` : key)
      if (parsed.ok) put(value, key, parsed.value)
      else issues.push(...parsed.issues)
    }
    return issues.length > 0 ? { ok: false, issues } : good(value)
  })
}

export type ObjectShape = { readonly [key: string]: Schema<unknown> }

type Prettify<T> = { [K in keyof T]: T[K] } & {}

type OptionalKeys<S extends ObjectShape> = {
  [K in keyof S]-?: undefined extends Infer<S[K]> ? K : never
}[keyof S]

export type InferObject<S extends ObjectShape> = Prettify<
  { [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & {
    [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined>
  }
>

/** Rejects arrays and null, both of which are `typeof 'object'`. */
function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

/**
 * `target[key] = value`, for a key that came out of the input.
 *
 * `__proto__` is an accessor on `Object.prototype`, so a plain assignment does
 * not write a property, it sets the object's PROTOTYPE. Measured on a restored
 * backup whose JSON carried `{"title":"Acme","__proto__":{"archived":true,
 * "notes":"pwned"}}`: `parse` returned ok, `Object.keys` showed only `title`,
 * and every DECLARED-OPTIONAL field the record left out then read back off the
 * prototype instead — `archived` came out as the string `"not-a-boolean"`
 * through a `s.boolean()` field, past the file that calls itself the single
 * trust boundary. `'archived' in value` answered true, so the guards that
 * decide whether a field was set answer the attacker's way too.
 *
 * Dropped, and it is the one exception to the passthrough this file argues for
 * at the top. `__proto__` cannot be a field written by a newer build: measured
 * on the same object, `JSON.stringify` of the parsed record already omits it,
 * so no build could have round-tripped it through a backup anyway — and
 * keeping it as an own property would only hand the same assignment to the
 * next `Object.assign` or naive merge that touched the record.
 *
 * Every write into a parsed object goes through here, including the ones keyed
 * off a declared shape. A shape COULD declare `__proto__` and would lose it
 * silently; that is the right answer for a field no storage layer in this app
 * can carry, and one write path is easier to keep honest than three.
 */
function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') return
  target[key] = value
}

function object<S extends ObjectShape>(shape: S, o: TextOptions = {}): Schema<InferObject<S>> {
  const fields: Record<string, FieldMeta> = {}
  for (const key of Object.keys(shape)) {
    const field = shape[key]
    if (field) fields[key] = field.meta
  }
  const meta = { ...metaOf('object', o), fields }

  return define(meta, (input, path) => {
    if (!isPlainObject(input)) return bad(path, 'Needs to be a record.')

    // Unknown keys first, so a field this build does not know survives. The
    // known keys below overwrite them, so passthrough can never shadow a
    // validated value with an unvalidated one.
    const out: Record<string, unknown> = {}
    const known = new Set(Object.keys(shape))
    for (const key of Object.keys(input)) if (!known.has(key)) put(out, key, input[key])

    const issues: Issue[] = []
    for (const key of Object.keys(shape)) {
      const field = shape[key]
      if (!field) continue

      const at = path ? `${path}.${key}` : key
      // An absent optional key stays absent rather than being written as an
      // explicit `undefined`: structured clone preserves the difference, so a
      // key set to undefined comes back present-and-undefined after a reload
      // and every `in` check that guarded the field answers the opposite way.
      if (!(key in input) && field.meta.optional) continue

      const parsed = field.parse(input[key], at)
      if (!parsed.ok) {
        issues.push(...parsed.issues)
        continue
      }
      if (parsed.value === undefined && field.meta.optional) continue
      put(out, key, parsed.value)
    }

    /*
     * A missing field, next to a key nobody read that looks like it.
     *
     * Measured, and it was the single largest source of refused tool calls in
     * the whole multi-turn benchmark: GPT-OSS 120B sent `{"kind":"application"}`
     * to `memory.list` eleven times out of thirteen. The field is `type` and its
     * LABEL is "Kind" — the model took the human word for the machine one, which
     * is a reasonable mistake and one the refusal did nothing to correct.
     *
     * Unknown keys are deliberately passed through (see above), so nothing
     * rejected `kind`; it was simply never read, and the reply said "type:
     * Needs to be one of…" as though nothing had been supplied. Naming what WAS
     * supplied turns several round trips into one.
     *
     * Only when something already failed, and only for keys this shape does not
     * know: a call that worked is not made to explain itself, and passthrough
     * stays passthrough.
     */
    if (issues.length > 0) {
      const unread = Object.keys(input).filter((key) => !known.has(key))
      if (unread.length > 0) {
        issues.push({
          path,
          message: `These were sent and are not fields of this tool: ${unread.join(', ')}. Its fields are: ${[...known].join(', ')}.`,
        })
      }
      return { ok: false, issues }
    }
    // The one cast in this file, over an object this function built key by key
    // from values it has just checked. It is not a cast over stored bytes —
    // that lives in validate.ts and is the only one of those in the codebase.
    return good(out as InferObject<S>)
  })
}

/* ------------------------------- the export ------------------------------- */

export const s = {
  string,
  number,
  boolean,
  enum: enumOf,
  literal,
  isoDate,
  instant,
  id,
  unknown: unknownValue,
  optional,
  nullable,
  array,
  record,
  object,
}

/** 'org: Cannot be blank' — one line, for a log or a compact error list. */
export function formatIssues(issues: readonly Issue[]): string {
  return issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ')
}
