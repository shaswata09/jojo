import { describe, expect, it } from 'vitest'
import { CATALOG } from './catalog'
import { s } from '../core/schema'
import { toJsonSchema } from './json-schema'

/** The conversion is only ever fed a `meta`, so the tests speak in schemas. */
const of = (schema: { meta: Parameters<typeof toJsonSchema>[0] }) => toJsonSchema(schema.meta)

describe('primitives', () => {
  it('carries the DESCRIPTION only, because the key already names the field', () => {
    /*
     * This used to assert the opposite — "Respond by. The date the offer
     * lapses." — on the reasoning that a model given only the key `respondBy`
     * is guessing. Measured, the label did more harm than that guess:
     *
     * `memory.list` keys a field `type` and labels it `Kind`, so the model read
     * "Kind. Which kind of record to list." and sent `{"kind": "application"}`.
     * `application.offer.decide` keys `id` and labels it `Application`, and the
     * model sent `{"Application": "app:…"}`. Across three models on the
     * 36-conversation suite, **28 of 48 tool-call refusals were this** — 58% of
     * every argument the tools rejected, taught by the schema itself.
     *
     * A short capitalised phrase at the head of a description is
     * indistinguishable from a field name. The key names the field; the
     * description explains it; the label is form copy and stays on the form.
     */
    expect(
      of(s.string({ label: 'Respond by', description: 'The date the offer lapses' })),
    ).toEqual({
      type: 'string',
      description: 'The date the offer lapses.',
    })
  })

  it('falls back to the label as PROSE when there is no description', () => {
    // An article, so the one remaining case cannot be read as a name either.
    expect(of(s.string({ label: 'Employer' }))).toEqual({
      type: 'string',
      description: 'The employer.',
    })
  })

  it('turns string and number bounds into the right keywords', () => {
    expect(of(s.string({ min: 1, max: 80 }))).toMatchObject({ minLength: 1, maxLength: 80 })
    expect(of(s.number({ min: 0, max: 5 }))).toMatchObject({ minimum: 0, maximum: 5 })
  })

  it('says nothing at all for unknown rather than guessing a type', () => {
    // A caller told `object` will send `{}` for a field that wanted a string.
    expect(of(s.unknown())).toEqual({})
  })
})

describe('enums and literals', () => {
  it('lists the options and types them from what is in the list', () => {
    expect(of(s.enum(['applied', 'interviewing'] as const))).toMatchObject({
      type: 'string',
      enum: ['applied', 'interviewing'],
    })
  })

  it('pins a literal with const', () => {
    expect(of(s.literal('offer'))).toMatchObject({ const: 'offer', type: 'string' })
  })
})

describe('objects', () => {
  it('requires every field that is not optional, and no others', () => {
    const schema = s.object({
      org: s.string({ label: 'Organisation' }),
      note: s.optional(s.string()),
    })
    const json = of(schema)
    expect(json.required).toEqual(['org'])
    expect(json.properties?.['note']?.description).toContain('May be omitted')
  })

  it('forbids extra keys, unlike the parser it describes', () => {
    // The parser lets unknown keys THROUGH so a record written by a newer build
    // survives an older one. That argument is about stored records; this schema
    // describes an argument list a model is inventing, and telling it extra keys
    // are welcome is an invitation to hallucinate one.
    expect(of(s.object({ org: s.string() })).additionalProperties).toBe(false)
  })

  it('nests', () => {
    const json = of(
      s.object({ offer: s.object({ salary: s.number(), respondBy: s.isoDate() }) }),
    )
    expect(json.properties?.['offer']?.properties?.['respondBy']).toMatchObject({ format: 'date' })
  })
})

describe('the kinds a model gets wrong without help', () => {
  it('spells out the date format in prose, not only in `format`', () => {
    // `format` is advisory and small models ignore it; the example is doing more
    // work than the keyword.
    expect(of(s.isoDate()).description).toContain('2026-08-22')
    expect(of(s.instant()).description).toContain('T14:30')
  })

  it('names which kind of record an id must point at', () => {
    // Without this, `id` is an opaque string and the model will pass an
    // application id where a keyword id belongs.
    expect(of(s.id('keyword')).description).toContain('keyword')
  })
})

describe('collections', () => {
  it('uses minItems for an array, not minLength', () => {
    // The wrong keyword is silently ignored rather than rejected, which is how
    // "at least one keyword" becomes no constraint at all.
    const json = of(s.array(s.string(), { min: 1 }))
    expect(json).toMatchObject({ type: 'array', minItems: 1 })
    expect(json.minLength).toBeUndefined()
  })

  it('describes a record through additionalProperties, having no key names', () => {
    expect(of(s.record(s.string()))).toMatchObject({
      type: 'object',
      additionalProperties: { type: 'string' },
    })
  })
})

/**
 * A field's description must not open with a name that is not its key.
 *
 * `describeMeta` used to lead every description with the field's LABEL, which is
 * form copy. `memory.list` keys a field `type` and labels it `Kind`, so the
 * model read "Kind. Which kind of record to list." — the word "kind" twice, the
 * word "type" never — and sent `{"kind": "application"}`.
 * `application.offer.decide` keys a field `id` and labels it `Application`, and
 * the model sent `{"Application": "app:…"}`.
 *
 * Measured over Gemma 3 31B, Qwen3 14B and GPT-OSS 120B on the 36-conversation
 * suite: **28 of 48 tool-call refusals — 58% of every argument the tools
 * rejected — were this one mistake**, taught by the schema itself.
 *
 * A short capitalised phrase at the head of a description is indistinguishable
 * from a field name, so this refuses one whenever it disagrees with the key.
 */
describe('a description must not name a different field', () => {
  /** The opening phrase, when it reads like a name rather than a sentence. */
  const leadingName = (description: string): string | null => {
    const first = description.split('.')[0]?.trim() ?? ''
    // One or two words. Three or more is a sentence fragment, not a plausible
    // field name — "Only for timelineItem and match records" misleads nobody.
    if (first.length === 0 || first.split(/\s+/).length > 2) return null
    if (!/^[A-Z]/.test(first)) return null
    // "The employer", "A note" — an article makes it a sentence, which is the
    // whole point of the fix. Only a bare noun phrase can be read as a key.
    if (/^(The|A|An)\s/.test(first)) return null
    // A sentence that merely starts with a capital is not a name.
    return /^[A-Z][a-z]*(\s[A-Za-z]+)?$/.test(first) ? first : null
  }

  const offenders: string[] = []
  const walk = (schema: unknown, tool: string, key: string): void => {
    if (typeof schema !== 'object' || schema === null) return
    const node = schema as { properties?: Record<string, unknown>; items?: unknown; description?: string }
    if (typeof node.description === 'string' && key !== '') {
      const name = leadingName(node.description)
      if (name !== null && name.toLowerCase().replace(/\s+/g, '') !== key.toLowerCase()) {
        offenders.push(`${tool}.${key} opens with "${name}"`)
      }
    }
    if (node.items) walk(node.items, tool, key)
    for (const [k, v] of Object.entries(node.properties ?? {})) walk(v, tool, k)
  }

  for (const entry of CATALOG) walk(entry.parameters, entry.name, '')

  it('never opens a field description with a name other than its key', () => {
    expect(offenders, offenders.slice(0, 12).join('\n')).toEqual([])
  })
})
