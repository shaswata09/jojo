/**
 * L3.5 — reading what a small model MEANT to send, without inventing any of it.
 *
 * ## Why this file exists
 *
 * `loop.ts` says in its own header that it does not repair malformed arguments,
 * and until now nothing did: a call whose arguments were not exactly right came
 * back as a refusal, and the model spent a turn — sometimes three — rediscovering
 * a field name it had already been told. Measured against this repo's own tools,
 * eleven argument shapes that a 14B–120B model emits routinely are refused today
 * (`test/_probe-repair` in the working notes; the cases are the `describe` blocks
 * of the sibling test file, one per real failure).
 *
 * The technique is the most-cited small-model fix in the survey that motivated
 * this work, and it is shipped independently by two harnesses: Cline (Zod unions
 * accepting aliases, number coercion, double-JSON unwrapping against the schema)
 * and OpenHands (alias table, JSON-in-string decoding, chunked-string joining,
 * trailing-garbage trimming). Both put it in front of validation rather than
 * inside it, which is the shape here too: `core/schema.ts` stays the single
 * parser and the single trust boundary, and this module only ever hands it
 * something the model plausibly already said.
 *
 * FORMAT IS A SEPARATE CHANNEL FROM CAPABILITY. That is the whole premise. Aider
 * publishes "percent well-formed" beside its pass rate because the two come
 * apart: QwQ complied 91.0% and scored 42.1%. A model that picked the right tool
 * and the right id and then wrote `"true"` instead of `true` did the task; the
 * only thing wrong with the call is its spelling, and spelling is repairable
 * without knowing anything about the task.
 *
 * ## The line: repair versus fabrication
 *
 * Every transformation here is INFORMATION-PRESERVING — the repaired value
 * carries exactly what the model wrote, in the shape the schema asked for.
 * Coercing `"3"` to `3` is repair. Guessing an id, a date, or an enum member is
 * fabrication, and it is precisely the failure jojo's grounding rules exist to
 * prevent: a fabricated `app:` id names a record that does not exist, and the
 * user is told their application moved when nothing moved.
 *
 * So, explicitly, this module NEVER:
 *
 *   - fills in a missing required field, however obvious;
 *   - picks an enum member that the model did not write (a difference of CASE is
 *     repaired, a difference of WORD is not);
 *   - reads a bare array as positional arguments — deciding which key `["app:1"]`
 *     belongs to is a guess wearing a repair's clothes;
 *   - turns a number into a string. `id: 123` becoming `"123"` manufactures an
 *     id, which is the one refusal in this codebase that must stay a refusal;
 *   - accepts `"yes"` for a boolean or `"3 items"` for a number. Lossless or not
 *     at all.
 *
 * And it reports what it did, per repair, because a silent edit to a tool call is
 * a lie to the trace: the user is about to be shown "moved to interview" and the
 * arguments that produced it have to be the arguments that ran. `Repair[]` is
 * what the loop logs and what the benchmark counts.
 *
 * ## Validation here is NOT the tool's validation
 *
 * `accepts` below is a conservative reader of the JSON Schema subset
 * `json-schema.ts` emits, and it exists for exactly one purpose: to decide
 * whether a candidate repair is safe to apply. It deliberately does NOT check
 * `format` — a malformed date is not repairable by this module anyway, so
 * claiming it is unacceptable would only turn "pass it through and let the tool
 * say why" into "refuse it here with a worse sentence". It also does not reject
 * unknown keys, because `core/schema.ts` passes them through by design (a field
 * written by a newer build has to survive a round trip through an older one) and
 * a repair layer stricter than the parser would refuse calls that work.
 *
 * Pure: no clock, no randomness, no I/O, no `node:` import. D26 and
 * `check-platform.mjs` both apply, and this file has nothing that would want a
 * clock anyway.
 */

import { NODE_TYPES } from '../core/model'
import type { JsonSchema } from './json-schema'

/* --------------------------------- result --------------------------------- */

/**
 * What was done, in the vocabulary the benchmark counts by.
 *
 * One kind per transformation rather than a free-text label, because the number
 * that matters is "how often did the harness have to fix a `string[]` sent as a
 * string" — that is the number that says whether a prompt change worked.
 */
export type RepairKind =
  /** A JSON document arrived as a JSON string. Decoded against the schema. */
  | 'unwrapped-json'
  /** …and had prose wrapped round it, which was cut away before decoding. */
  | 'trimmed-garbage'
  /** A near-miss key name mapped onto the property the schema actually declares. */
  | 'renamed-key'
  /** `"a, b"` read as `["a", "b"]` for a list of strings. */
  | 'split-list'
  /** A lone value wrapped, for a field whose schema wants a list of them. */
  | 'wrapped-list'
  /** A one-item list unwrapped, for a field whose schema wants the value itself. */
  | 'unwrapped-list'
  /** `"3"` read as `3`, losslessly. */
  | 'coerced-number'
  /** `"true"` read as `true`. */
  | 'coerced-boolean'
  /** `"Interview"` matched to the one enum member that differs only in case. */
  | 'matched-enum-case'
  /** An explicit `null` on an absent-able field dropped, so the key is absent. */
  | 'dropped-null'
  /** No arguments at all, for a tool that requires none. */
  | 'empty-args'

export type Repair = {
  readonly kind: RepairKind
  /**
   * Where, in the spelling `core/schema.ts`'s `Issue` already uses:
   * `''` for the whole argument object, `offer.respondBy`, `keywords[2]`.
   * One spelling for both halves of the round trip means a repair and the issue
   * it prevented can be read side by side.
   */
  readonly path: string
  /** One sentence naming what changed, for the trace and the run log. */
  readonly detail: string
}

/**
 * Repaired, or a reason it could not be.
 *
 * `ok: true` with an empty `repairs` means the arguments were already fine and
 * nothing was touched — the integrator should not log anything in that case, and
 * `repairs.length` is the flag to branch on rather than comparing objects.
 *
 * `reason` is written for a log line and a benchmark row, NOT for the model.
 * `loop.ts` owns every sentence a model reads and has measured wording for each
 * failure it reports (the truncation case in particular says "send fewer items",
 * which nothing here knows). A second author of model-facing text is how two
 * spellings of one refusal get shipped.
 */
export type RepairResult =
  | { readonly ok: true; readonly args: Record<string, unknown>; readonly repairs: readonly Repair[] }
  | { readonly ok: false; readonly reason: string; readonly repairs: readonly Repair[] }

/* --------------------------------- entry ---------------------------------- */

/**
 * The one export the loop calls.
 *
 * `raw` is `unknown` on purpose, and it is the reason this signature works at
 * both of the loop's call sites: arguments that parsed as JSON arrive as an
 * object, and arguments that did NOT parse — the trailing-garbage case, the
 * whole-object-as-a-string case — arrive as the raw string off the wire. A
 * signature that took `Record<string, unknown>` could only ever fix half of the
 * failures, and the half it could not fix is the half that costs a whole turn.
 */
export function repairArgs(schema: JsonSchema, raw: unknown): RepairResult {
  const repairs: Repair[] = []

  /*
   * No arguments at all, for a tool that requires none.
   *
   * `memory.overview` takes `s.object({})`, and a model calling it emits
   * `arguments: ""` or `null` about as often as it emits `{}` — the OpenAI
   * dialect leaves the field absent, Ollama's native path sends an empty string.
   * Reading that as `{}` invents nothing: an empty object IS "no arguments", and
   * the required check below still refuses it for any tool that wants a field.
   */
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    if ((schema.required ?? []).length === 0 && schema.type === 'object') {
      return { ok: true, args: {}, repairs: [{ kind: 'empty-args', path: '', detail: 'no arguments were sent, and this tool requires none' }] }
    }
    return { ok: false, reason: 'no arguments were sent at all', repairs }
  }

  /*
   * A bare list at the top level is REFUSED rather than read positionally.
   *
   * `["app:1"]` for a one-field tool looks like a free win and is not: the model
   * did not name the field, so assigning it is this module guessing which
   * argument it meant — the same class of guess as inventing the id itself, and
   * it fails silently rather than loudly because the resulting call is
   * well-formed. JSON Schema has no argument order to appeal to.
   */
  const value = repairValue(schema, raw, '', repairs)

  if (!isPlainObject(value)) {
    return { ok: false, reason: `the arguments were ${describeShape(value)}, not an object`, repairs }
  }

  const missing = (schema.required ?? []).filter((key) => !(key in value))
  if (missing.length > 0) {
    // Named, but never filled in. A required field this module could supply is a
    // field it would be inventing; the model is the only thing that knows what
    // belongs there, and `loop.ts` is what tells it so.
    return { ok: false, reason: `required ${missing.length === 1 ? 'field' : 'fields'} not sent: ${missing.join(', ')}`, repairs }
  }

  return { ok: true, args: value, repairs }
}

/**
 * The repairs as one line, for the run log.
 *
 * Separate from `Repair` itself so the benchmark can count kinds without parsing
 * prose, and the trace can print prose without rebuilding it.
 */
export function summarizeRepairs(repairs: readonly Repair[]): string {
  return repairs.map((r) => r.detail).join('; ')
}

/* ------------------------------- the repairs ------------------------------ */

/**
 * One value against one schema, best effort, recording what it changed.
 *
 * Returns the value it ended up with — repaired or not. Acceptance is decided by
 * the caller with `accepts`, so a transformation that did not help can be thrown
 * away rather than recorded, which is what keeps `repairs` honest: every entry in
 * it is a change that made the call closer to callable.
 */
function repairValue(schema: JsonSchema, value: unknown, path: string, repairs: Repair[]): unknown {
  /*
   * Already acceptable: touch nothing. An enum member that is already a member,
   * a string that is already a string. This is the common case by a wide margin
   * and it must be the cheap one.
   *
   * AN OBJECT IS NOT LET OUT HERE, and the exclusion is the whole subtlety.
   * `accepts` is shallow about the keys it does not know: an argument object
   * whose required fields are all present and correct passes it whole, with
   * `Limit: "5"` sitting beside them unread. That is the commonest model there
   * is — the hard part right, the easy part wrong — so an object always goes on
   * to `repairObject` below.
   */
  if (accepts(schema, value) && !isPlainObject(value)) return value

  if (typeof value === 'string') {
    const fromText = repairText(schema, value, path, repairs)
    if (fromText !== NO_REPAIR) return fromText
  }

  /*
   * A one-item list where the schema wants the item.
   *
   * `{"id": ["app:0199…"]}` — the model formatted every argument as a list
   * because the previous one was a list. Unwrapping carries exactly the value it
   * wrote, and only from a list of ONE: a two-item list would force a choice
   * between them, which is a guess.
   */
  if (Array.isArray(value) && value.length === 1 && schema.type !== 'array' && schema.type !== undefined) {
    const nested: Repair[] = []
    const only = repairValue(schema, value[0], path, nested)
    if (accepts(schema, only)) {
      push(repairs, 'unwrapped-list', path, `${label(path)} was a list of one, and this field takes a single value`)
      repairs.push(...nested)
      return only
    }
  }

  /*
   * A lone value where the schema wants a list of them.
   *
   * The string form of this is handled in `repairText` (it may need splitting
   * first); this is the rest — `{"keywords": {"id": …}}` for an array of
   * objects, a lone number for an array of numbers.
   */
  if (schema.type === 'array' && !Array.isArray(value) && schema.items) {
    const items = schema.items
    const nested: Repair[] = []
    const item = repairValue(items, value, `${path}[0]`, nested)
    if (accepts(items, item)) {
      push(repairs, 'wrapped-list', path, `${label(path)} was a single value, and this field takes a list`)
      repairs.push(...nested)
      return [item]
    }
  }

  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    const items = schema.items
    return value.map((item, i) => repairValue(items, item, `${path}[${String(i)}]`, repairs))
  }

  if (schema.type === 'object' && isPlainObject(value)) return repairObject(schema, value, path, repairs)

  /*
   * An enum member that differs from a real one only in CASE or in punctuation.
   *
   * `"Application"` for `application`, `"at least"` for `atLeast`. This is the
   * one repair that touches an enum, and the guard is that the fold must match
   * EXACTLY ONE member: the value is then the member, written differently, which
   * is spelling. Anything looser — nearest neighbour, prefix match, a synonym
   * table — is choosing a member on the model's behalf, and choosing `closed`
   * when the model wrote `finished` is how an application gets closed by a
   * harness rather than by a person.
   */
  if (schema.enum && typeof value === 'string') {
    const hits = schema.enum.filter((o) => typeof o === 'string' && fold(o) === fold(value))
    if (hits.length === 1) {
      const only = hits[0] as string
      push(repairs, 'matched-enum-case', path, `${label(path)} "${value}" is ${only === value.trim() ? 'spelt' : 'written'} "${only}" in this tool`)
      return only
    }
  }

  return value
}

/** Distinguishes "no repair applied" from a repair that produced `undefined`. */
const NO_REPAIR = Symbol('no-repair')

/**
 * The string repairs, in the order they have to be tried.
 *
 * JSON first: `"[\"kw:1\"]"` is both a decodable document AND a comma-free
 * string, so a splitter that ran first would produce `["[\"kw:1\"]"]` — one item
 * containing the punctuation. Decoding is strictly more information-preserving
 * than splitting, so it goes first and splitting only ever sees text that is not
 * JSON.
 */
function repairText(schema: JsonSchema, text: string, path: string, repairs: Repair[]): unknown {
  /*
   * DOUBLE-JSON ENCODING, unwrapped against the schema and never blindly.
   *
   * WHAT STOPS IT EATING A STRING FIELD is `accepts` below, not a type test up
   * here — and that is worth stating because a reader will look for the type
   * test. A `note` of `{"who":"HR"}` is a note the user pasted, and decoding it
   * would silently retype their text as structure; two things prevent that, and
   * a third would be untestable. `repairValue` returns before this function is
   * called at all when the string is already an acceptable string, which is the
   * `note` case exactly; and when it is NOT acceptable — too long for the field,
   * say — `decodeJson` only ever yields an object or an array, which no string
   * field accepts. The mutation test for the deleted type check could not be made
   * to fail, which is what says it was decoration.
   *
   * `type: undefined` (`s.unknown`, which json-schema.ts emits as `{}` rather
   * than guessing `object`) IS still excluded here, and that one is honest
   * decoration: `accepts` says yes to everything for an unconstrained field, so
   * the fast path in `repairValue` is the only thing standing in front of it
   * today and no mutant of this line can be killed. It costs one comparison, and
   * the failure it would prevent — a pasted document quietly becoming structure
   * — is invisible in a trace.
   */
  const wants = schema.type
  if (wants !== undefined) {
    const decoded = decodeJson(text)
    if (decoded) {
      // Repaired into a scratch list first: the decode is only worth recording if
      // what came out of it is callable, and a repair list that mentions fixes to
      // a document this module then threw away is a trace nobody can follow.
      const nested: Repair[] = []
      const inner = repairValue(schema, decoded.value, path, nested)
      if (accepts(schema, inner)) {
        const kind = decoded.trimmed ? 'trimmed-garbage' : 'unwrapped-json'
        const detail = decoded.trimmed
          ? `${label(path)} was JSON with prose around it, which was cut away`
          : `${label(path)} arrived as a JSON string and was decoded`
        push(repairs, kind, path, detail)
        repairs.push(...nested)
        return inner
      }
    }
  }

  /*
   * A STRING WHERE AN ARRAY BELONGS, split on commas — and only on commas, and
   * only when the schema says a list of strings.
   *
   * `keyword.record.set` takes `keywords: string[]` of ids and a model sends
   * `"kw:1, kw:2"` constantly. The narrowness is the safety: splitting a list of
   * OBJECTS on commas would be nonsense, and splitting a plain `string` field
   * would destroy "Austin, TX".
   *
   * When the items are an enum, every piece must land on a member — otherwise
   * the comma was inside a value rather than between two, and the whole string
   * is tried as one item instead.
   */
  if (wants === 'array' && schema.items?.type === 'string') {
    const items = schema.items
    if (text.includes(',')) {
      const nested: Repair[] = []
      const pieces = text.split(',').map((p) => p.trim()).filter((p) => p !== '')
      const repaired = pieces.map((p, i) => repairValue(items, p, `${path}[${String(i)}]`, nested))
      if (repaired.length > 0 && repaired.every((p) => accepts(items, p))) {
        push(repairs, 'split-list', path, `${label(path)} was one string and was read as a list of ${String(repaired.length)}`)
        repairs.push(...nested)
        return repaired
      }
    }
    const nested: Repair[] = []
    const one = repairValue(items, text.trim(), `${path}[0]`, nested)
    if (accepts(items, one)) {
      push(repairs, 'wrapped-list', path, `${label(path)} was one string, and this field takes a list`)
      repairs.push(...nested)
      return [one]
    }
  }

  /*
   * NUMBER AS STRING, coerced only when LOSSLESS.
   *
   * `"3"` is 3. `"3abc"`, `"three"`, `"1e3"`, `"0x10"` and `""` are not numbers
   * a caller can recover, and `Number()` disagrees with that in every direction
   * — it reads `""` as 0, `"\n7 "` as 7 and `[]` as 0. `losslessNumber` is a
   * regex first and a `Number()` second for exactly that reason.
   */
  if (wants === 'number' || wants === 'integer') {
    const n = losslessNumber(text)
    if (n !== undefined && (wants === 'number' || Number.isInteger(n))) {
      push(repairs, 'coerced-number', path, `${label(path)} "${text}" was read as the number ${String(n)}`)
      return n
    }
  }

  /*
   * BOOLEAN AS STRING. `"true"`/`"false"` only, case-insensitively.
   *
   * `"yes"`, `"1"`, `"on"` and `"y"` are deliberately refused. They are not the
   * word the model would have written if it had written a boolean, and the
   * moment `"1"` is a boolean, `"0"` is one too — at which point a `limit` of
   * `"0"` on a field that later becomes optional-boolean flips meaning silently.
   */
  if (wants === 'boolean') {
    const t = text.trim().toLowerCase()
    if (t === 'true' || t === 'false') {
      push(repairs, 'coerced-boolean', path, `${label(path)} "${text}" was read as ${t}`)
      return t === 'true'
    }
  }

  return NO_REPAIR
}

/**
 * An object: keys first, then values, then the nulls.
 *
 * Order matters. A value cannot be repaired against the right property schema
 * until the key names that property, so renaming comes first; and a null cannot
 * be judged optional until it is under the key it belongs to.
 */
function repairObject(
  schema: JsonSchema,
  value: Record<string, unknown>,
  path: string,
  repairs: Repair[],
): Record<string, unknown> {
  const props = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const renames = keyRenames(props, value)

  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    /*
     * `__proto__` is dropped, for the reason `put` in `core/schema.ts` gives at
     * length: it is an accessor on `Object.prototype`, so a plain assignment sets
     * the prototype rather than writing a property, and everything downstream
     * then reads the attacker's defaults for every field the record left out.
     * This module builds a NEW object out of model-controlled keys, which is
     * exactly the shape that bug had.
     */
    if (key === '__proto__') continue

    const name = renames.get(key) ?? key
    if (name !== key) {
      push(repairs, 'renamed-key', join(path, name), `"${key}" is called "${name}" in this tool`)
    }

    const field = props[name]
    const at = join(path, name)
    const raw = value[key]

    /*
     * NULL FOR AN ABSENT OPTIONAL, dropped rather than passed on.
     *
     * `exactOptionalPropertyTypes` is the reason this is not a no-op: an explicit
     * null is a different thing from an absent key, and `core/schema.ts` proves
     * it downstream — a key present-and-undefined survives structured clone and
     * every `in` check that guarded the field then answers the opposite way. A
     * model padding out every optional field with nulls is refused today for
     * fields it never meant to set.
     *
     * NOT for a NULLABLE field, and that distinction is load-bearing. jojo has
     * fields where null MEANS something: `application.update`'s `source`,
     * `deadline`, `flagged` and `outcome` are `s.nullable`, and null on them
     * clears the value. `json-schema.ts` deliberately does not express
     * nullability in `type` — "a nullable field would need a union that half the
     * small models will not parse" — so the only signal in the schema is the
     * sentence `describeMeta` writes, "May be null to clear it." Dropping a null
     * there would turn "clear the deadline" into "leave the deadline alone", and
     * the user would be told the deadline was cleared.
     */
    if (raw === null && field && !required.has(name) && !allowsNull(field)) {
      push(repairs, 'dropped-null', at, `${name} was null, which this field reads as "not sent"`)
      continue
    }

    if (field) {
      out[name] = repairValue(field, raw, at, repairs)
      continue
    }

    /*
     * A key this schema does not declare is PASSED THROUGH untouched, matching
     * `core/schema.ts`, which lets unknown keys through by design and reports
     * them only when something else already failed. A repair layer that dropped
     * them would be stricter than the parser it feeds, which means refusing calls
     * that work today.
     */
    const extra = typeof schema.additionalProperties === 'object' ? schema.additionalProperties : undefined
    out[name] = extra ? repairValue(extra, raw, at, repairs) : raw
  }
  return out
}

/* --------------------------------- aliases -------------------------------- */

/**
 * The near-miss key names, derived from the schema's own property names.
 *
 * DERIVED, not tabulated, wherever it can be: `norm` folds away case and every
 * separator, so `role_tag`, `Role Tag`, `role-tag` and `ROLETAG` all reach
 * `roleTag` through one rule rather than four table rows, and the rule keeps
 * working for a property added tomorrow. Singular/plural and a trailing `Id`
 * are the other two shapes small models produce (`keyword` for `keywords`,
 * `recordId` for `record`), and both are equally derivable.
 *
 * TWO GUARDS, and they are what stop a rename from becoming a guess:
 *
 *   - a stray key that matches more than one property is left alone. `keyword`
 *     against a schema declaring both `keyword` and `keywords` must not move.
 *   - a property that is already present, or that two stray keys both claim, is
 *     never written. Overwriting a value the model DID send is not repair.
 */
function keyRenames(
  props: Record<string, JsonSchema>,
  value: Record<string, unknown>,
): Map<string, string> {
  const names = Object.keys(props)
  const present = new Set(Object.keys(value))
  const claims = new Map<string, string[]>()

  for (const key of Object.keys(value)) {
    if (key === '__proto__') continue
    if (names.includes(key)) continue // already the real name

    const hits = names.filter((name) => !present.has(name) && aliasOf(key, name))
    if (hits.length !== 1) continue // ambiguous, or nothing to move it to
    const target = hits[0] as string
    claims.set(target, [...(claims.get(target) ?? []), key])
  }

  const renames = new Map<string, string>()
  for (const [target, keys] of claims) {
    // Two strays claiming one property is the model having sent the field twice
    // under two wrong names. Picking one is a coin toss with a user's data on it.
    if (keys.length === 1) renames.set(keys[0] as string, target)
  }
  return renames
}

/**
 * The recurring label-for-key confusions, which no folding rule can derive.
 *
 * `json-schema.ts` documents the measurement these come from: 170 of 339 schema
 * fields carry a label that differs from its key, and a model reads the label as
 * the name. `memory.list` keys a field `type` and labels it "Kind", and GPT-OSS
 * 120B sent `{"kind":"application"}` eleven times out of thirteen;
 * `application.offer.decide` keys `id` and labels it "Application", and the model
 * sent `{"Application":"app:…"}`. Across three models on the 36-conversation
 * suite that class was 28 of 48 tool-call refusals.
 *
 * The record nouns are read from `NODE_TYPES` rather than typed out, so a node
 * type added to the graph is covered here on the same day. `organization` is the
 * one hand-written entry: jojo spells it `organisation` and models overwhelmingly
 * do not.
 */
const RECORD_NOUNS: ReadonlySet<string> = new Set([
  ...NODE_TYPES.map((t) => norm(t)),
  'organization',
  'record',
  'app',
])

function aliasOf(key: string, name: string): boolean {
  const k = norm(key)
  const n = norm(name)
  if (k === n) return true

  // `recordId` for `record`, `keywordId` for `keyword`. Only in that direction:
  // a model that wrote `record` for a property named `recordId` wrote a shorter
  // word, which is far likelier to be a different field than the same one.
  if (k.endsWith('id') && k.slice(0, -2) === n) return true

  if (plural(k, n) || plural(n, k)) return true

  // The label confusions. Scoped to this schema by the caller — a noun is only
  // ever moved onto a property the model did not otherwise fill — so a tool that
  // really does declare `record` (`keyword.attach`) never sees this rule fire.
  if (n === 'id' && RECORD_NOUNS.has(k)) return true
  if (n === 'record' && k === 'id') return true
  if (n === 'type' && k === 'kind') return true
  return false
}

/** `keyword` for `keywords`, `entry` for `entries`. One direction; called twice. */
function plural(one: string, many: string): boolean {
  if (`${one}s` === many || `${one}es` === many) return true
  return one.endsWith('y') && `${one.slice(0, -1)}ies` === many
}

/** Case and every separator folded away: `Role Tag`, `role_tag`, `ROLETAG`. */
function norm(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** The same fold, for enum members. Kept separate because its rule may diverge. */
function fold(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]/g, '')
}

/* -------------------------------- decoding -------------------------------- */

/**
 * The first complete JSON object or array in a string, and whether anything else
 * was there.
 *
 * `JSON.parse` alone cannot do this: it fails on the whole string the moment a
 * model writes `{"type":"application"} — hope that helps!`, which is one of the
 * commonest shapes on a server without a tool template. Scanning for the
 * BALANCED end of the first `{`/`[` recovers the document and reports the prose.
 *
 * An UNTERMINATED document returns null on purpose. That is the truncation case
 * — a reply cut off at the model's output limit — and `loop.ts` has a measured,
 * different sentence for it ("send the same call again with FEWER items"). A
 * repair layer that guessed the closing braces would hand the loop a
 * half-argument list to run, and the loop would never say the thing that works.
 */
function decodeJson(text: string, depth = 0): { value: unknown; trimmed: boolean } | null {
  /*
   * A JSON string holding a JSON string holding the document.
   *
   * Seen on Ollama's native path, where an already-stringified argument list is
   * stringified again by the caller, and the whole thing arrives quoted. Peeled
   * one layer at a time rather than by regex, because each layer is real JSON and
   * `JSON.parse` is the only thing that knows where its escapes end. Bounded:
   * three layers is past any observed failure and past any depth a recursion
   * here should be allowed to explore on model-controlled input.
   */
  if (depth < 3 && text.trim().startsWith('"')) {
    try {
      const once: unknown = JSON.parse(text.trim())
      if (typeof once === 'string') return decodeJson(once, depth + 1)
    } catch {
      // Not a complete JSON string. Fall through to the brace scan, which is
      // what recovers a document that merely STARTS with a quoted key.
    }
  }

  const start = firstOf(text, '{', '[')
  if (start < 0) return null
  const end = balancedEnd(text, start)
  if (end < 0) return null

  try {
    const value: unknown = JSON.parse(text.slice(start, end))
    const trimmed = text.slice(0, start).trim() !== '' || text.slice(end).trim() !== ''
    return { value, trimmed }
  } catch {
    return null
  }
}

function firstOf(text: string, ...chars: readonly string[]): number {
  const found = chars.map((c) => text.indexOf(c)).filter((i) => i >= 0)
  return found.length === 0 ? -1 : Math.min(...found)
}

/**
 * The index just past the closing brace of the document that opens at `from`.
 *
 * String-aware, because a brace inside a value is not a brace: a `note` reading
 * `"we discussed {salary}"` closes the object two characters early otherwise, and
 * the resulting parse either fails or — worse — succeeds on a truncated object.
 */
function balancedEnd(text: string, from: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = from; i < text.length; i += 1) {
    const c = text[i] as string
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{' || c === '[') depth += 1
    else if (c === '}' || c === ']') {
      depth -= 1
      if (depth === 0) return i + 1
      if (depth < 0) return -1
    }
  }
  /*
   * Unterminated: the document never closes. `-1` rather than `text.length`, and
   * the difference is only ever speed — the slice would fail `JSON.parse` and the
   * catch would return null anyway — but a truncated argument list is the one
   * input this module is guaranteed to be handed under load, and running the
   * parser over it to learn what the counter already knows is work for nothing.
   */
  return -1
}

/**
 * A number that survives the round trip, or nothing.
 *
 * The digit cap is not decoration: a double carries about 15–17 significant
 * digits, so `"12345678901234567890"` comes back as `12345678901234567000` and
 * `"3.0000000000000001"` comes back as `3`. Both are `Number.isFinite`, both look
 * repaired, and both are a value the model did not write. Sixteen digits is the
 * point past which that starts, and past it this returns nothing so the tool can
 * refuse the string the model actually sent.
 */
function losslessNumber(text: string): number | undefined {
  const t = text.trim()
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(t)) return undefined
  const digits = t.replace(/[+\-.]/g, '').replace(/^0+/, '')
  if (digits.length > 15) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/* ------------------------------- acceptance ------------------------------- */

/**
 * Would the schema take this value? Conservatively, and never more strictly than
 * `core/schema.ts` would.
 *
 * Used only to decide whether a candidate repair is worth applying. Anything it
 * cannot judge it accepts, because a false "no" here suppresses a real repair
 * while a false "yes" merely hands the tool the same value it was going to get
 * anyway and lets the real parser write the refusal.
 */
function accepts(schema: JsonSchema, value: unknown): boolean {
  if (schema.const !== undefined) return value === schema.const
  if (schema.enum) return schema.enum.some((o) => o === value)

  switch (schema.type) {
    case undefined:
      // `s.unknown()` — json-schema.ts emits `{}` rather than guessing `object`,
      // and the parser accepts anything. So does this.
      return true
    case 'string': {
      if (typeof value !== 'string') return false
      // `.trim().length` for the minimum, because that is what `s.string` checks
      // — a whitespace-only value fails there and must fail here, or a repair
      // that produced one would be recorded as a success.
      if (schema.minLength !== undefined && value.trim().length < schema.minLength) return false
      return schema.maxLength === undefined || value.length <= schema.maxLength
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return false
      if (schema.type === 'integer' && !Number.isInteger(value)) return false
      if (schema.minimum !== undefined && value < schema.minimum) return false
      return schema.maximum === undefined || value <= schema.maximum
    }
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    case 'array': {
      if (!Array.isArray(value)) return false
      if (schema.minItems !== undefined && value.length < schema.minItems) return false
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return false
      const items = schema.items
      return items === undefined || value.every((v) => accepts(items, v))
    }
    case 'object': {
      if (!isPlainObject(value)) return false
      const props = schema.properties ?? {}
      for (const key of schema.required ?? []) {
        if (!(key in value)) return false
      }
      for (const [key, field] of Object.entries(props)) {
        if (key in value && !accepts(field, value[key])) return false
      }
      /*
       * `additionalProperties: false` is NOT enforced, and that is deliberate.
       * `json-schema.ts` emits it to constrain a server's sampling; the parser
       * that actually runs passes unknown keys through untouched. Enforcing it
       * here would make this module refuse calls the tool accepts.
       */
      const extra = typeof schema.additionalProperties === 'object' ? schema.additionalProperties : undefined
      if (!extra) return true
      return Object.entries(value).every(([key, v]) => key in props || accepts(extra, v))
    }
  }
  /*
   * Unreachable today — the switch covers every member of `JsonSchema['type']`
   * — and `true` rather than `false` if a keyword is ever added to that union.
   * The asymmetry is the same one the header states: a false "no" here silently
   * suppresses a repair that was safe, while a false "yes" hands the tool the
   * value it was going to get anyway and lets the real parser write the refusal.
   */
  return true
}

/**
 * Does this field read `null` as a value rather than as an absence?
 *
 * The prose IS the signal. `json-schema.ts` refuses to express nullability in
 * `type` — a union half the small models will not parse — so `describeMeta`'s
 * "May be null to clear it." is the only thing in a generated schema that says a
 * null means something. The `type: 'null'` arm covers a schema written by hand or
 * arriving from an MCP server.
 */
function allowsNull(schema: JsonSchema): boolean {
  if (schema.type === 'null') return true
  return /may be null/i.test(schema.description ?? '')
}

/* --------------------------------- shared --------------------------------- */

/** Rejects arrays and null, both of which are `typeof 'object'`. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function join(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`
}

/**
 * `keywords` reads better than a pronoun in a detail line, when there is one.
 *
 * "the argument object" rather than "the arguments" so every detail this file
 * writes agrees with a singular verb: these lines are concatenated into one log
 * sentence by `summarizeRepairs`, and "the arguments was decoded" is the kind of
 * thing that makes a reader distrust the rest of the trace.
 */
function label(path: string): string {
  return path === '' ? 'the argument object' : path
}

function describeShape(value: unknown): string {
  if (Array.isArray(value)) return 'a list'
  if (value === null) return 'null'
  return `a ${typeof value}`
}

function push(repairs: Repair[], kind: RepairKind, path: string, detail: string): void {
  repairs.push({ kind, path, detail })
}
