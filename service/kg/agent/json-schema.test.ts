import { describe, expect, it } from 'vitest'
import { s } from '../core/schema'
import { toJsonSchema } from './json-schema'

/** The conversion is only ever fed a `meta`, so the tests speak in schemas. */
const of = (schema: { meta: Parameters<typeof toJsonSchema>[0] }) => toJsonSchema(schema.meta)

describe('primitives', () => {
  it('carries the label and the description, because they say different things', () => {
    // core/schema.ts: the label names the field, the description "says why, not
    // what". A model given only the key `respondBy` is guessing.
    expect(
      of(s.string({ label: 'Respond by', description: 'The date the offer lapses' })),
    ).toEqual({
      type: 'string',
      description: 'Respond by. The date the offer lapses.',
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
