/**
 * L2 — `FieldMeta` to JSON Schema, so a model can call what a form can draw.
 *
 * `core/schema.ts` says why `FieldMeta` is data and never a closure: "the moment
 * a validator's shape is only knowable by running it, the palette can no longer
 * draw a field for it and every tool needs a hand-written form". That decision
 * was made for the command palette and it is the whole reason this file is
 * ninety lines instead of a rewrite of fifty-nine tools. A model choosing
 * arguments and a palette drawing inputs need exactly the same thing: the shape,
 * ahead of time, without running anything.
 *
 * WHAT THIS IS NOT. It is not validation. The schema produced here tells the
 * model what to send; `runtime.check` is still what decides whether what arrived
 * is acceptable, and it is the same parser the forms use. A model that ignores
 * the schema gets the same refusal a user typing nonsense into the palette gets,
 * with the same message. Nothing downstream trusts this output.
 *
 * The subset is deliberate — `type`, `description`, `enum`, `items`,
 * `properties`, `required`, `minimum`/`maximum`, `minLength`/`maxLength`. It is
 * what OpenAI's function-calling and MCP's `inputSchema` both read, and every
 * keyword beyond it is one more thing a small local model can misread. This app
 * points at whatever the user is running on their own machine, which is
 * frequently a 7B, so the schema is kept boring on purpose.
 */

import type { FieldKind, FieldMeta } from '../core/schema'

/** The subset of JSON Schema draft 2020-12 that tool callers actually read. */
export type JsonSchema = {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null'
  description?: string
  enum?: readonly (string | number | boolean)[]
  const?: string | number | boolean
  items?: JsonSchema
  properties?: Record<string, JsonSchema>
  required?: readonly string[]
  additionalProperties?: boolean | JsonSchema
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  format?: string
}

/** The primitives that map straight across, with nothing else to say. */
const PLAIN: Partial<Record<FieldKind, JsonSchema>> = {
  string: { type: 'string' },
  number: { type: 'number' },
  boolean: { type: 'boolean' },
  // `unknown` is genuinely unconstrained: the schema says nothing rather than
  // guessing `object`, because a caller told `object` will send `{}` for a
  // field that wanted a string.
  unknown: {},
}

/**
 * The three string kinds that carry a format a model has to get exactly right.
 *
 * Spelled out in `description` as well as `format`, because `format` is
 * advisory in JSON Schema and small models routinely ignore it. The example is
 * doing more work than the keyword is.
 */
const FORMATTED: Partial<Record<FieldKind, JsonSchema>> = {
  date: { type: 'string', format: 'date', description: 'A calendar day, as 2026-08-22.' },
  instant: {
    type: 'string',
    format: 'date-time',
    description: 'An exact time, ISO 8601, as 2026-08-22T14:30:00.000Z.',
  },
  id: {
    type: 'string',
    description: 'The id of an existing record, exactly as a read tool returned it.',
  },
}

/**
 * One field, converted.
 *
 * `optional` and `nullable` are NOT expressed here — optionality belongs to the
 * parent's `required` list, and a nullable field would need a union that half
 * the small models will not parse. `describeMeta` says "may be omitted" in prose
 * instead, which is the form that survives.
 */
export function toJsonSchema(meta: FieldMeta, key?: string): JsonSchema {
  const base = fieldBody(meta, key)
  const description = describeMeta(meta, base.description)
  return description ? { ...base, description } : base
}

function fieldBody(meta: FieldMeta, key?: string): JsonSchema {
  if (meta.kind === 'enum') {
    return meta.options ? { type: enumType(meta.options), enum: meta.options } : { type: 'string' }
  }
  if (meta.kind === 'literal') {
    const only = meta.options?.[0]
    return only === undefined ? {} : { type: enumType([only]), const: only }
  }
  if (meta.kind === 'array') {
    // The key travels into the items too: an item labelled "Expression" under a
    // key `expressions` is a singular/plural pair, not a different field name.
    const body: JsonSchema = { type: 'array', items: meta.of ? toJsonSchema(meta.of, key) : {} }
    // `minItems`, not `minLength` — an array's bound has a different keyword
    // from a string's, and the wrong one is silently ignored rather than
    // rejected, which is how "at least one keyword" becomes no constraint.
    if (meta.min !== undefined) body.minItems = meta.min
    if (meta.max !== undefined) body.maxItems = meta.max
    return body
  }
  if (meta.kind === 'record') {
    // A record is an object with unknown keys, so `properties` cannot be
    // written and `additionalProperties` carries the value shape instead.
    return { type: 'object', additionalProperties: meta.of ? toJsonSchema(meta.of) : true }
  }
  if (meta.kind === 'object') return objectBody(meta)
  const formatted = FORMATTED[meta.kind]
  if (formatted) return { ...formatted }
  return withBounds({ ...PLAIN[meta.kind] }, meta)
}

/**
 * An object, with `required` naming every field that is not optional.
 *
 * `additionalProperties: false` is deliberate and is the one strict thing here.
 * `core/schema.ts` lets unknown keys THROUGH — a field written by a newer build
 * has to survive a round trip through an older one — but that argument is about
 * stored records, and this schema describes an argument list a model is
 * inventing right now. Telling it extra keys are allowed is an invitation to
 * hallucinate one, and OpenAI-compatible servers use exactly this flag to
 * constrain their sampling.
 */
function objectBody(meta: FieldMeta): JsonSchema {
  const fields = meta.fields ?? {}
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const [key, field] of Object.entries(fields)) {
    // The key travels with the field, so a label that would masquerade as a
    // different name can be recognised and dropped. See `describeMeta`.
    properties[key] = toJsonSchema(field, key)
    if (!field.optional) required.push(key)
  }
  const body: JsonSchema = { type: 'object', properties, additionalProperties: false }
  if (required.length > 0) body.required = required
  return body
}

function withBounds(body: JsonSchema, meta: FieldMeta): JsonSchema {
  if (meta.min === undefined && meta.max === undefined) return body
  if (body.type === 'number') {
    if (meta.min !== undefined) body.minimum = meta.min
    if (meta.max !== undefined) body.maximum = meta.max
    return body
  }
  if (body.type === 'string') {
    if (meta.min !== undefined) body.minLength = meta.min
    if (meta.max !== undefined) body.maxLength = meta.max
  }
  return body
}

/**
 * `true`/`false` in an enum are still booleans; mixed lists fall back to string.
 *
 * Returns the non-optional union rather than `JsonSchema['type']`, which under
 * `exactOptionalPropertyTypes` includes `undefined` and so cannot be written
 * into a `type` field at all.
 */
type JsonType = NonNullable<JsonSchema['type']>

function enumType(options: readonly (string | number | boolean)[]): JsonType {
  const kinds = new Set(options.map((o) => typeof o))
  if (kinds.size !== 1) return 'string'
  const only = [...kinds][0]
  return only === 'number' ? 'number' : only === 'boolean' ? 'boolean' : 'string'
}

/**
 * The prose a model reads, assembled from the parts a form would have shown.
 *
 * `label` is included as well as `description` because the two say different
 * things — `core/schema.ts`: the label names the field and the description "says
 * why, not what". A model given only the key `respondBy` and no label is
 * guessing; given "Respond by" and "The date the offer lapses" it is not.
 *
 * `nodeType` is the one that changes outcomes most. Without it, `id` is an
 * opaque string and the model will happily pass an application id where a
 * keyword id belongs — the tool refuses, the turn is wasted, and the model has
 * no idea which of its arguments was wrong.
 */
function describeMeta(meta: FieldMeta, inherited?: string): string | undefined {
  const parts: string[] = []
  /*
   * The LABEL is form copy, and leading a description with it teaches the model
   * the wrong field name.
   *
   * `memory.list` keys a field `type` and labels it `Kind`, so the model read
   * `"description": "Kind. Which kind of record to list."` — the word "kind"
   * twice and the word "type" never — and sent `{"kind": "application"}`.
   * `application.offer.decide` keys a field `id` and labels it `Application`,
   * and the model sent `{"Application": "app:…"}`. A short capitalised phrase at
   * the head of a description is indistinguishable from a name.
   *
   * Measured over three models on the 36-conversation suite: 28 of 48 tool-call
   * refusals — 58% of every argument the tools rejected — were this, and 170 of
   * 339 schema fields carry a label that differs from its key.
   *
   * So the label is used only when it is the ONLY thing there is to say (83
   * fields), and dropped whenever a real description exists. The key names the
   * field; the description explains it. `nodeType` below already carries "must
   * be the id of a X record", which is what the label was standing in for.
   */
  const describes = meta.description ?? inherited
  if (meta.label && describes === undefined) {
    /*
     * The label is all there is, so it has to carry the meaning — but as PROSE.
     * A bare "Employer." on a field keyed `org` is the same trap one step down:
     * a capitalised noun alone reads as a name. An article turns it into a
     * sentence, which no model mistakes for a key.
     *
     * Only for the short ones. "Only for timelineItem and match records" is
     * already a sentence and "The only for timelineItem…" would be nonsense.
     */
    const short = meta.label.trim().split(/\s+/).length <= 2
    parts.push(short ? `The ${meta.label.trim().toLowerCase()}` : meta.label)
  }
  // When there IS a description, the label never appears. The key names the
  // field and the description explains it; the label is form copy, and
  // prepending it either misleads ("Kind." on `type`) or restates the key
  // ("Expression." on `expressions`) — noise in both cases, across 339 fields.
  if (describes !== undefined) parts.push(describes)
  if (meta.nodeType) parts.push(`Must be the id of a ${meta.nodeType} record.`)
  if (meta.optional) parts.push('May be omitted.')
  if (meta.nullable) parts.push('May be null to clear it.')
  if (parts.length === 0) return undefined
  // Sentence-joined rather than newline-joined: this lands inside a JSON string
  // in a system prompt, and a literal newline there costs two tokens and buys
  // nothing a full stop does not.
  return parts.map((p) => (p.endsWith('.') ? p : `${p}.`)).join(' ')
}
