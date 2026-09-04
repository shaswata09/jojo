/**
 * Every case here is a shape a real small model sent, and every one of them is
 * refused by jojo's own parsers without this module.
 *
 * Measured before the module existed, by pushing each `raw` below through the
 * tool's real `input.parse` (`core/schema.ts`, the same parser the forms use):
 * twelve of twelve were refused. The `ACCEPTED BY THE REAL PARSER` block at the
 * foot of this file is that probe, kept, so the claim is re-checked on every run
 * rather than remembered from a commit message.
 *
 * Two kinds of test, deliberately mixed:
 *
 *   - against REAL catalogue schemas (`entryFor(...).parameters`), because the
 *     interesting properties are ones the hand-written fixture would have got
 *     wrong — `application.update.deadline` is nullable and `memory.list.limit`
 *     is not, and no fixture invented for a test would have remembered that.
 *   - against tiny hand-written schemas, where the point is a rule rather than a
 *     tool, and a real schema would bury it.
 *
 * The negative tests are the load-bearing ones. Anyone can make a repair layer
 * that fixes `"3"`; the value of this one is that it refuses `"yes"`, refuses to
 * pick an enum member the model did not write, and refuses to fill in a required
 * field — so those get as much room as the repairs do.
 */

import { describe, expect, it } from 'vitest'
import { CATALOG, entryFor } from './catalog'
import type { JsonSchema } from './json-schema'
import { READS } from './queries'
import { TOOLS } from '../tools/index'
import { repairArgs, summarizeRepairs } from './repair'

/** Real ids. `core/ref.ts` requires a known prefix and a uuid-shaped tail. */
const APP = 'app:01234567-89ab-4cde-8123-456789abcdef'
const KW1 = 'kw:11111111-89ab-4cde-8123-456789abcdef'
const KW2 = 'kw:22222222-89ab-4cde-8123-456789abcdef'

const schemaOf = (tool: string): JsonSchema => {
  const entry = entryFor(tool)
  if (!entry) throw new Error(`no catalogue entry for ${tool}`)
  return entry.parameters
}

/** The repaired arguments, or a failure of the test rather than of the module. */
const repaired = (tool: string, raw: unknown): Record<string, unknown> => {
  const out = repairArgs(schemaOf(tool), raw)
  if (!out.ok) throw new Error(`expected a repair, got: ${out.reason}`)
  return out.args
}

const kinds = (tool: string, raw: unknown): string[] => {
  const out = repairArgs(schemaOf(tool), raw)
  return out.repairs.map((r) => r.kind)
}

/* --------------------------------------------------------------------------- */

describe('arguments that are already right', () => {
  /*
   * The commonest case by far, and the one a repair layer must not touch. A
   * module that "normalises" a correct call is a module that changes what the
   * user is shown to have done.
   */
  it('changes nothing and reports nothing', () => {
    const out = repairArgs(schemaOf('memory.list'), { type: 'application', limit: 5 })
    expect(out).toEqual({ ok: true, args: { type: 'application', limit: 5 }, repairs: [] })
  })

  it('leaves a string field that happens to contain a comma alone', () => {
    // `location` is a plain string. Splitting it is the failure mode the split
    // rule is narrowed to avoid: "Austin, TX" is one place.
    const args = repaired('application.update', { id: APP, location: 'Austin, TX' })
    expect(args['location']).toBe('Austin, TX')
  })
})

describe('double-JSON encoding', () => {
  /*
   * Both halves of the failure Cline and OpenHands each ship a decoder for. The
   * whole-object form is what a server without a tool template produces; the
   * one-field form is a model that has learned "arguments are JSON" a level too
   * deep and JSON-encodes a list inside them.
   */
  it('decodes the whole argument object when it arrives as a string', () => {
    expect(repaired('memory.list', '{"type":"application"}')).toEqual({ type: 'application' })
    expect(kinds('memory.list', '{"type":"application"}')).toEqual(['unwrapped-json'])
  })

  it('decodes one field that arrives as a string', () => {
    const args = repaired('application.update', { id: APP, keywords: `["${KW1}","${KW2}"]` })
    expect(args['keywords']).toEqual([KW1, KW2])
  })

  it('decodes a nested object and repairs inside it in the same pass', () => {
    // `offer` is an object of its own, so both failures compose: the object is a
    // string, and the key inside it is snake_case. One is no use without the other.
    const args = repaired('application.update', {
      id: APP,
      offer: '{"respond_by":"2026-09-30","note":"verbal"}',
    })
    expect(args['offer']).toEqual({ respondBy: '2026-09-30', note: 'verbal' })
    expect(kinds('application.update', { id: APP, offer: '{"respond_by":"2026-09-30","note":"verbal"}' })).toEqual([
      'unwrapped-json',
      'renamed-key',
    ])
  })

  it('survives a double encoding', () => {
    // Ollama's native path has been seen stringifying an already-stringified
    // argument list. Each unwrap is checked against the schema, so the depth
    // costs nothing extra in trust.
    expect(repaired('memory.list', JSON.stringify('{"type":"application"}'))).toEqual({
      type: 'application',
    })
  })

  /*
   * THE GUARD. A string field whose value parses as JSON is not a mistake.
   *
   * `note` takes free text, and a user who pasted `{"who":"HR"}` into a note
   * meant those characters. Decoding it would retype their text as structure and
   * the note would come back as `[object Object]`.
   */
  it('never decodes a string field, however JSON-shaped its value is', () => {
    const args = repaired('application.update', { id: APP, note: '{"who":"HR"}' })
    expect(args['note']).toBe('{"who":"HR"}')
  })

  it('will not decode into a string field even when the string is unacceptable', () => {
    /*
     * The same property, one layer down, and the one that pins the `accepts`
     * gate rather than the fast path above it.
     *
     * `keyword.create.name` caps at 40 characters, so this value is refused as a
     * string and DOES reach the decoder — where the only thing stopping it is
     * that a decoded document is an object and no string field accepts one.
     * Without that check the keyword would be created with an object for a name.
     */
    const long = '{"name":"a keyword name that runs past forty characters"}'
    const out = repairArgs(schemaOf('keyword.create'), { name: long })
    expect(out.repairs).toEqual([])
    expect(out.ok && out.args['name']).toBe(long)
  })

  it('never decodes into an unconstrained field', () => {
    // `s.unknown()` reaches the schema as `{}` — json-schema.ts refuses to guess
    // `object` there — so nothing says the string was meant to be anything else.
    const free: JsonSchema = { type: 'object', properties: { any: {} } }
    const out = repairArgs(free, { any: '{"a":1}' })
    expect(out).toEqual({ ok: true, args: { any: '{"a":1}' }, repairs: [] })
  })
})

describe('garbage around the JSON', () => {
  it('cuts prose off either side of the object', () => {
    expect(repaired('memory.list', '{"type":"application"} — hope that helps!')).toEqual({
      type: 'application',
    })
    expect(repaired('memory.list', 'Sure! {"type":"application"}')).toEqual({ type: 'application' })
    expect(kinds('memory.list', '{"type":"application"} hope that helps')).toEqual(['trimmed-garbage'])
  })

  it('does not close a brace that is inside a string', () => {
    // A `}` in a value ends the scan two characters early otherwise, and the
    // result either fails to parse or — worse — parses as a truncated object.
    const args = repaired('application.update', { id: APP, note: 'we discussed {salary} today' })
    expect(args['note']).toBe('we discussed {salary} today')
    expect(repaired('memory.search', '{"query":"a } b"}')).toEqual({ query: 'a } b' })
  })

  /*
   * TRUNCATION IS NOT REPAIRED, and that is a decision rather than a limitation.
   *
   * An `arguments` string cut off at the model's output limit is unterminated.
   * `loop.ts` has a measured, different sentence for it — "send the same call
   * again with FEWER items — a third of them" — because the model cannot see its
   * own output limit and "your JSON was malformed" invites the identical
   * oversized call. Guessing the closing braces here would hand the loop half an
   * argument list to RUN, and the loop would never say the thing that works.
   */
  it('refuses an unterminated object rather than closing it', () => {
    const out = repairArgs(schemaOf('application.create'), '{"org":"Rice","role":"Senior Eng')
    expect(out.ok).toBe(false)
  })
})

describe('a string where a list belongs', () => {
  it('splits on commas for a list of strings', () => {
    const args = repaired('keyword.record.set', { record: APP, keywords: `${KW1}, ${KW2}` })
    expect(args['keywords']).toEqual([KW1, KW2])
  })

  it('drops the empty piece a trailing comma leaves behind', () => {
    // `"kw:…, kw:…,"` is what a model writing a list one item at a time produces
    // when it stops. Kept, the empty piece reaches the tool as an id pointing at
    // no record, and the split is reported as a repair that broke the call.
    const args = repaired('keyword.record.set', { record: APP, keywords: `${KW1}, , ${KW2},` })
    expect(args['keywords']).toEqual([KW1, KW2])
  })

  it('wraps a single value rather than splitting nothing', () => {
    const args = repaired('keyword.record.set', { record: APP, keywords: KW1 })
    expect(args['keywords']).toEqual([KW1])
    expect(kinds('keyword.record.set', { record: APP, keywords: KW1 })).toEqual(['wrapped-list'])
  })

  it('unwraps a one-item list for a field that takes one value', () => {
    // The mirror image, and just as common: a model that formatted every
    // argument as a list because the one before it was.
    const args = repaired('keyword.rename', { id: [KW1], name: 'Systems' })
    expect(args['id']).toBe(KW1)
  })

  it('records a repair only when it makes the value acceptable', () => {
    /*
     * `org` needs at least one non-blank character — `s.string({min:1})` measures
     * `.trim().length`, and so does the acceptance check here, on purpose.
     * Unwrapping the list around a blank string would leave the tool refusing
     * anyway, and a `repairs` list carrying a change that fixed nothing is a
     * trace that says the harness helped when it did not.
     */
    const out = repairArgs(schemaOf('application.create'), {
      org: [' '],
      role: 'SWE',
      roleTag: 'Engineering',
      stage: 'draft',
    })
    expect(out.repairs).toEqual([])
    expect(out.ok && out.args['org']).toEqual([' '])
  })

  it('never picks one out of a list of two', () => {
    // Two ids for a field that takes one is the model having lost track, not a
    // formatting slip. Choosing between them is choosing which record to rename.
    const out = repairArgs(schemaOf('keyword.rename'), { id: [KW1, KW2], name: 'Systems' })
    expect(out.repairs).toEqual([])
    expect(out.ok && out.args['id']).toEqual([KW1, KW2])
  })

  /*
   * When the items are an enum, every piece has to land on a member.
   *
   * Otherwise the comma was inside one value rather than between two, and
   * splitting invents a second argument. The whole string is tried as one item
   * instead, which either works or leaves the tool to say why not.
   */
  it('will not split a list of enum values when a piece is not a member', () => {
    const stages: JsonSchema = {
      type: 'object',
      properties: { stages: { type: 'array', items: { type: 'string', enum: ['draft', 'offer'] } } },
    }
    expect(repairArgs(stages, { stages: 'draft, offer' })).toMatchObject({
      ok: true,
      args: { stages: ['draft', 'offer'] },
    })
    const out = repairArgs(stages, { stages: 'draft, sometime next week' })
    expect(out.repairs).toEqual([])
    expect(out.ok && out.args['stages']).toBe('draft, sometime next week')
  })
})

describe('a number or a boolean sent as a string', () => {
  it('reads "5" as 5', () => {
    expect(repaired('memory.list', { type: 'application', limit: '5' })).toEqual({
      type: 'application',
      limit: 5,
    })
  })

  it('reads "true" and "TRUE" as true, and "false" as false', () => {
    expect(repaired('application.update', { id: APP, flagged: 'true' })['flagged']).toBe(true)
    expect(repaired('application.update', { id: APP, flagged: 'TRUE' })['flagged']).toBe(true)
    expect(repaired('application.update', { id: APP, flagged: 'false' })['flagged']).toBe(false)
  })

  /*
   * LOSSLESS OR NOT AT ALL. `Number()` disagrees with that in every direction —
   * it reads `""` as 0, `"\n7 "` as 7 and `[]` as 0 — so the regex decides and
   * `Number()` only converts.
   */
  it.each([
    ['3abc', 'a number with a tail'],
    ['yes', 'a word'],
    ['', 'nothing at all'],
    ['1e3', 'an exponent no small model writes on purpose'],
    ['0x10', 'hex'],
    ['12345678901234567890', 'more digits than a double carries'],
    ['3.0000000000000001', 'a fraction that comes back as 3'],
  ])('refuses %s (%s)', (text) => {
    const out = repairArgs(schemaOf('memory.list'), { type: 'application', limit: text })
    expect(out.repairs).toEqual([])
    expect(out.ok && out.args['limit']).toBe(text)
  })

  it.each(['yes', '1', 'on', 'y'])('refuses %s for a boolean', (text) => {
    // The moment `"1"` is `true`, `"0"` is `false`, and a field that later
    // becomes optional-boolean flips meaning without anything changing.
    const out = repairArgs(schemaOf('application.update'), { id: APP, flagged: text })
    expect(out.repairs).toEqual([])
    expect(out.ok && out.args['flagged']).toBe(text)
  })

  it('never turns a number into a string', () => {
    /*
     * The one coercion that is banned in the direction that looks harmless.
     * `id: 123` becoming `"123"` manufactures an id — it names no record, and
     * `core/ref.ts` rejects a bare id precisely so the app never guesses between
     * the six records that answer to one. The tool's own message ("Needs to be an
     * id written as text") is the right outcome here.
     */
    const out = repairArgs(schemaOf('keyword.rename'), { id: 123, name: 'Systems' })
    expect(out.repairs).toEqual([])
    expect(out.ok && out.args['id']).toBe(123)
  })

  it('coerces even when the number is out of bounds, so the tool can say so', () => {
    // `limit` maxes at 200. Repairing `"500"` to `500` earns the message "Needs
    // to be at most 200"; leaving it a string earns "Needs to be a number",
    // which sends the model looking for the wrong mistake.
    expect(repaired('memory.list', { type: 'application', limit: '500' })['limit']).toBe(500)
  })
})

describe('key aliases', () => {
  it('folds case, underscores, hyphens and spaces onto the declared name', () => {
    for (const alias of ['role_tag', 'roletag', 'Role Tag', 'ROLE-TAG']) {
      const args = repaired('application.create', {
        org: 'Rice',
        role: 'SWE',
        [alias]: 'Engineering',
        stage: 'draft',
      })
      expect(args['roleTag']).toBe('Engineering')
      expect(args[alias]).toBeUndefined()
    }
  })

  it('matches singular to plural and a trailing Id to the bare name', () => {
    expect(repaired('keyword.record.set', { record: APP, keyword: [KW1] })['keywords']).toEqual([KW1])
    expect(repaired('keyword.record.set', { recordId: APP, keywords: [KW1] })['record']).toBe(APP)
  })

  /*
   * The label-for-key confusion, which is the largest measured class of refusals
   * in this app: `json-schema.ts` records 28 of 48 refused calls across three
   * models, and 170 of 339 schema fields carrying a label that differs from its
   * key. `memory.list` keys `type` and labels it "Kind"; `keyword.rename` keys
   * `id` and the model writes the noun for the record instead.
   */
  it('maps a label the model read as a name onto the real key', () => {
    expect(repaired('memory.list', { kind: 'application' })).toEqual({ type: 'application' })
    expect(repaired('keyword.rename', { keyword: KW1, name: 'Systems' })['id']).toBe(KW1)
    expect(repaired('application.update', { application: APP, note: 'x' })['id']).toBe(APP)
    // jojo spells it `organisation`; models overwhelmingly do not.
    expect(repaired('keyword.rename', { organization: KW1, name: 'Systems' })['id']).toBe(KW1)
  })

  it('refuses to move a key that two properties could take', () => {
    /*
     * `Keywords` against a schema declaring BOTH `keyword` and `keywords`: it
     * folds exactly onto one and pluralises onto the other, so there are two
     * readings and no way to choose. Left where it is — `core/schema.ts` passes
     * it through and, if anything else fails, names it as a key nobody read,
     * which is the correction that does not risk writing the wrong field.
     */
    const both: JsonSchema = {
      type: 'object',
      properties: { keyword: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } } },
    }
    const out = repairArgs(both, { Keywords: KW1 })
    expect(out.repairs).toEqual([])
    expect(out.ok && out.args).toEqual({ Keywords: KW1 })
  })

  it('never overwrites a value the model did send', () => {
    // `record` and `keyword` are both real fields of `keyword.attach`, so neither
    // moves; and a stray alias for a field already filled is left where it is.
    const args = repaired('keyword.attach', { record: APP, keyword: KW1 })
    expect(args).toEqual({ record: APP, keyword: KW1 })

    const out = repairArgs(schemaOf('keyword.rename'), { id: KW1, ID: KW2, name: 'Systems' })
    expect(out.ok && out.args['id']).toBe(KW1)
  })

  it('refuses when two stray keys claim the same property', () => {
    // The model sent the field twice under two wrong names. Picking one is a coin
    // toss with a user's record on the other side of it.
    const out = repairArgs(schemaOf('keyword.rename'), { keyword: KW1, record: KW2, name: 'Systems' })
    expect(out.repairs).toEqual([])
    expect(out.ok).toBe(false)
  })

  it('repairs a stray key on an argument object that was otherwise valid', () => {
    /*
     * The case a fast path is easy to get wrong on. Every REQUIRED field is
     * present and correct here, so the object passes a shallow acceptance check
     * whole — and the miscased optional key beside it would never be looked at.
     * A model that gets the hard part right and the easy part wrong is the
     * commonest model there is.
     */
    expect(repaired('memory.list', { type: 'application', Limit: '5' })).toEqual({
      type: 'application',
      limit: 5,
    })
  })

  it('leaves an unknown key in place rather than dropping it', () => {
    /*
     * `core/schema.ts` passes unknown keys through by design — "a field written
     * by a newer build has to survive a round trip through an older one" — and
     * reports them only when something else already failed. A repair layer
     * stricter than the parser it feeds would refuse calls that work today.
     */
    const args = repaired('memory.list', { type: 'application', somethingElse: 1 })
    expect(args['somethingElse']).toBe(1)
  })
})

describe('null on an optional field', () => {
  it('drops it, so the key is absent rather than explicitly null', () => {
    /*
     * `exactOptionalPropertyTypes` is why this is not a no-op: absent and
     * present-and-null are different types here, and `core/schema.ts` proves it
     * downstream — a key that survives structured clone as `undefined` makes
     * every `in` check that guarded the field answer the opposite way.
     */
    const out = repairArgs(schemaOf('memory.list'), { type: 'application', limit: null })
    expect(out.ok && out.args).toEqual({ type: 'application' })
    expect(out.repairs.map((r) => r.kind)).toEqual(['dropped-null'])
  })

  /*
   * THE FIELD WHERE NULL MEANS SOMETHING, and the reason this rule reads prose.
   *
   * `application.update`'s `deadline`, `source`, `flagged` and `outcome` are
   * `s.nullable`: null CLEARS them. `json-schema.ts` deliberately does not
   * express that in `type` — "a nullable field would need a union that half the
   * small models will not parse" — so `describeMeta`'s sentence "May be null to
   * clear it." is the only signal a generated schema carries. Dropping the null
   * would turn "clear the deadline" into "leave the deadline alone", and the user
   * would be told the deadline was cleared.
   */
  it('keeps a null that CLEARS the field', () => {
    const out = repairArgs(schemaOf('application.update'), { id: APP, deadline: null })
    expect(out.ok && out.args).toEqual({ id: APP, deadline: null })
    expect(out.repairs).toEqual([])
  })

  it('keeps a null on a required field, so the tool refuses it by name', () => {
    // Dropping it would turn "you sent null" into "you sent nothing", which is a
    // different mistake with a different fix.
    const out = repairArgs(schemaOf('keyword.rename'), { id: KW1, name: null })
    expect(out.ok && out.args['name']).toBeNull()
  })
})

describe('enum members', () => {
  it('matches the one member that differs only in case or punctuation', () => {
    expect(repaired('memory.list', { type: 'Application' })['type']).toBe('application')
    expect(repaired('graph.query', { kind: 'pattern', quantifier: 'at least' })['quantifier']).toBe(
      'atLeast',
    )
  })

  it('never picks a member the model did not write', () => {
    /*
     * The fabrication line, at its sharpest. "finished" is not "closed" however
     * plainly a person can see what was meant — and a harness that closes an
     * application on that reading has made a decision the user never made. The
     * tool's refusal lists every member, which is the correction that works.
     */
    for (const wrong of ['finished', 'interviewing!', 'app', 'applications']) {
      expect(repairArgs(schemaOf('memory.list'), { type: wrong }).repairs).toEqual([])
    }
    const out = repairArgs(schemaOf('application.create'), {
      org: 'Rice',
      role: 'SWE',
      roleTag: 'Engineering',
      stage: 'nearly done',
    })
    expect(out.repairs).toEqual([])
  })

  it('does repair surrounding whitespace, which is spelling and nothing else', () => {
    expect(repaired('memory.list', { type: ' application ' })['type']).toBe('application')
  })

  it('refuses when the fold is ambiguous', () => {
    // Two members that differ only by the punctuation the fold removes. Neither
    // is "the" member, so neither is chosen.
    const ambiguous: JsonSchema = {
      type: 'object',
      properties: { pick: { type: 'string', enum: ['at-least', 'atleast'] } },
    }
    const out = repairArgs(ambiguous, { pick: 'At Least' })
    expect(out.repairs).toEqual([])
  })
})

describe('what it refuses to do at all', () => {
  it('never fills in a missing required field', () => {
    const out = repairArgs(schemaOf('keyword.rename'), { name: 'Systems' })
    expect(out.ok).toBe(false)
    expect(!out.ok && out.reason).toContain('id')
  })

  it('never reads a bare list as positional arguments', () => {
    // `["kw:…", "Systems"]` for a two-field tool. JSON Schema has no argument
    // order to appeal to, so assigning them is this module inventing the mapping.
    const out = repairArgs(schemaOf('keyword.rename'), [KW1, 'Systems'])
    expect(out.ok).toBe(false)
    expect(!out.ok && out.reason).toContain('list')
  })

  it('reads no arguments as {} only for a tool that requires none', () => {
    expect(repairArgs(schemaOf('memory.overview'), '')).toMatchObject({ ok: true, args: {} })
    expect(repairArgs(schemaOf('memory.overview'), null)).toMatchObject({ ok: true, args: {} })
    expect(repairArgs(schemaOf('memory.list'), '').ok).toBe(false)
  })

  it('drops __proto__ rather than assigning it', () => {
    /*
     * `put` in `core/schema.ts` documents the measurement: `__proto__` is an
     * accessor on `Object.prototype`, so a plain assignment sets the prototype
     * and every declared-optional field the object leaves out then reads back off
     * the attacker's defaults. This module builds a NEW object out of
     * model-controlled keys, which is exactly the shape that bug had.
     */
    const out = repaired('memory.list', JSON.parse('{"type":"application","__proto__":{"limit":9}}'))
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect((out as { limit?: number }).limit).toBeUndefined()
    expect(Object.keys(out)).toEqual(['type'])
  })

  it('never adds a field, for any tool in the catalogue', () => {
    /*
     * The invariant the whole module rests on, asserted over all 91 tools rather
     * than the handful this file names: a repair maps keys the model sent onto
     * keys the schema declares, and can therefore never produce more keys than it
     * was given. A rule that ever invented one would fail here without anybody
     * having to think of the tool it would fail on.
     */
    const sent = { kind: 'application', id: APP, name: 'x', keyword: KW1, limit: '5', nonsense: 1 }
    for (const entry of CATALOG) {
      const out = repairArgs(entry.parameters, sent)
      if (!out.ok) continue
      expect(Object.keys(out.args).length).toBeLessThanOrEqual(Object.keys(sent).length)
      for (const key of Object.keys(out.args)) {
        // Every surviving key is either one that was sent, or a declared property
        // that something sent was renamed onto — never a third thing.
        const declared = Object.keys(entry.parameters.properties ?? {})
        expect(key in sent || declared.includes(key)).toBe(true)
      }
    }
  })
})

describe('purity and reporting', () => {
  it('does not mutate the arguments it was given', () => {
    const input = { type: 'application', limit: '5', extra: null }
    const before = JSON.stringify(input)
    repairArgs(schemaOf('memory.list'), input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('is deterministic — no clock, no randomness', () => {
    const raw = { kind: 'Application', limit: '5' }
    expect(repairArgs(schemaOf('memory.list'), raw)).toEqual(repairArgs(schemaOf('memory.list'), raw))
  })

  it('names every repair, with a path the trace can line up against an issue', () => {
    const out = repairArgs(schemaOf('application.update'), {
      id: APP,
      offer: '{"respond_by":"2026-09-30","note":"verbal"}',
      flagged: 'true',
    })
    expect(out.repairs.map((r) => [r.kind, r.path])).toEqual([
      ['unwrapped-json', 'offer'],
      ['renamed-key', 'offer.respondBy'],
      ['coerced-boolean', 'flagged'],
    ])
    expect(summarizeRepairs(out.repairs)).toBe(
      'offer arrived as a JSON string and was decoded; "respond_by" is called "respondBy" in this tool; flagged "true" was read as true',
    )
  })

  it('reports what it managed even when it gives up', () => {
    // A partial repair is still worth logging: it says the loop's refusal was
    // about the missing field and not about the three things that were fine.
    const out = repairArgs(schemaOf('keyword.rename'), { name: ['Systems'] })
    expect(out.ok).toBe(false)
    expect(out.repairs.map((r) => r.kind)).toEqual(['unwrapped-list'])
  })
})

/* --------------------------------------------------------------------------- */

/*
 * TWO MUTANTS THAT SURVIVE, both equivalent, recorded rather than hidden.
 *
 * Every guard in `repair.ts` was mutation-tested — the bug re-introduced, the
 * suite run, the failure read, the line reverted — and 25 of 27 mutants died on a
 * named test above. The two that live produce identical behaviour, and the reason
 * is worth writing down because this project has shipped tests that could not fail
 * before:
 *
 *   - `wants !== undefined` in the double-JSON decode. An unconstrained field
 *     (`s.unknown()`, emitted as `{}`) accepts every value, so the fast path at
 *     the top of `repairValue` returns before the decoder is ever reached. The
 *     line is defence in depth, is documented as such at its site, and no test
 *     can pin it while the fast path stands in front of it.
 *   - `return -1` for an unterminated document in `balancedEnd`. The alternative
 *     is to slice to the end of the string, where `JSON.parse` throws and the
 *     catch returns null — the same answer, one parse later.
 *
 * That is the blind spot mutation testing has by construction: it cannot see a
 * guard that is missing, and it cannot see two correct guards composing. Where
 * two guards defend one property here, the tests assert the JOINED behaviour —
 * `never decodes a string field` for the fast path, `will not decode into a
 * string field even when the string is unacceptable` for the schema check —
 * rather than either line alone.
 */

/**
 * ACCEPTED BY THE REAL PARSER.
 *
 * Everything above asserts what this module returns. This asserts the only thing
 * that matters about it: that what it returns is a call jojo will actually run.
 * Each row was REFUSED by the same parser before the module existed — that probe
 * is what motivated the file, and inverting it here keeps the claim honest as the
 * tools change underneath.
 */
describe('the repaired call is one the real tool accepts', () => {
  const parse = (name: string, input: unknown) => {
    const tool =
      (READS as Record<string, { input: { parse: (i: unknown) => { ok: boolean } } }>)[name] ??
      (TOOLS as Record<string, { input: { parse: (i: unknown) => { ok: boolean } } }>)[name]
    if (!tool) throw new Error(`no tool ${name}`)
    return tool.input.parse(input)
  }

  const CASES: readonly [string, string, unknown][] = [
    ['the whole object as a JSON string', 'memory.list', '{"type":"application"}'],
    ['one field as a JSON string', 'application.update', { id: APP, keywords: `["${KW1}"]` }],
    ['a string where a list belongs', 'keyword.record.set', { record: APP, keywords: `${KW1}, ${KW2}` }],
    ['a lone id where a list belongs', 'keyword.record.set', { record: APP, keywords: KW1 }],
    ['a number as a string', 'memory.list', { type: 'application', limit: '5' }],
    ['a boolean as a string', 'application.update', { id: APP, flagged: 'true' }],
    ['a label read as a key', 'keyword.rename', { keyword: KW1, name: 'Systems' }],
    [
      'a snake_case key',
      'application.create',
      { org: 'Rice', role: 'SWE', role_tag: 'Engineering', stage: 'draft' },
    ],
    ['prose after the object', 'memory.list', '{"type":"application"} — hope that helps!'],
    ['a null on an absent optional', 'memory.list', { type: 'application', limit: null }],
    ['an enum member miscased', 'memory.list', { type: 'Application' }],
    [
      'a nested object, encoded and snake_cased',
      'application.update',
      { id: APP, offer: '{"respond_by":"2026-09-30","note":"verbal"}' },
    ],
  ]

  it.each(CASES)('%s', (_label, tool, raw) => {
    // Refused as sent — if this ever stops being true the case has stopped
    // testing anything, and the row should be replaced rather than deleted.
    expect(parse(tool, raw).ok).toBe(false)

    const out = repairArgs(schemaOf(tool), raw)
    expect(out.ok).toBe(true)
    expect(out.ok && parse(tool, out.args).ok).toBe(true)
  })
})
