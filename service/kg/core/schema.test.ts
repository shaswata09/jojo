/**
 * The combinator library, and the two properties it exists for: it never
 * throws, and its shape is readable as data.
 */

import { describe, expect, it } from 'vitest'
import { newNodeId } from './ref'
import { formatIssues, s } from './schema'

const AT = Date.UTC(2026, 9, 12)

describe('primitives', () => {
  it('accepts the value and reports the path on a miss', () => {
    expect(s.string().parse('hi')).toEqual({ ok: true, value: 'hi' })
    const bad = s.string().parse(3, 'org')
    expect(bad.ok).toBe(false)
    expect(bad.ok === false && bad.issues).toEqual([{ path: 'org', message: 'Needs to be text.' }])
  })

  it('treats a blank string as blank, not as a string of length zero', () => {
    expect(s.string({ min: 1 }).parse('   ').ok).toBe(false)
  })

  // NaN and Infinity are numbers to `typeof` and to nobody else. Left in, a NaN
  // fit score renders as 'NaN% fit' and sorts nowhere.
  it('rejects NaN and Infinity', () => {
    expect(s.number().parse(Number.NaN).ok).toBe(false)
    expect(s.number().parse(Number.POSITIVE_INFINITY).ok).toBe(false)
    expect(s.number().parse(0).ok).toBe(true)
  })

  it('names the allowed values when an enum misses', () => {
    const stage = s.enum(['draft', 'closed'] as const)
    expect(stage.parse('draft')).toEqual({ ok: true, value: 'draft' })
    const bad = stage.parse('screen')
    expect(bad.ok === false && bad.issues[0]?.message).toBe('Needs to be one of: draft, closed.')
  })

  // The shape check alone accepts '2026-02-31', which every consumer then
  // renders as a real deadline while `daysBetween` counts to the 3rd of March.
  it('rejects a well-shaped date that is not a day', () => {
    expect(s.isoDate().parse('2026-10-12').ok).toBe(true)
    expect(s.isoDate().parse('2026-02-31').ok).toBe(false)
    expect(s.isoDate().parse('2026-13-01').ok).toBe(false)
    expect(s.isoDate().parse('12 Oct 2026').ok).toBe(false)
  })

  it('accepts only a type-prefixed id, and only of the type asked for', () => {
    const id = newNodeId('application', AT)
    expect(s.id('application').parse(id).ok).toBe(true)
    expect(s.id('keyword').parse(id).ok).toBe(false)
    expect(s.id().parse('stripe').ok).toBe(false)
  })
})

describe('composites', () => {
  it('collects every issue in a list rather than stopping at the first', () => {
    const parsed = s.array(s.number()).parse([1, 'x', 'y'], 'fits')
    expect(parsed.ok).toBe(false)
    expect(parsed.ok === false && parsed.issues.map((i) => i.path)).toEqual(['fits[1]', 'fits[2]'])
  })

  it('lets an absent optional key stay absent', () => {
    const schema = s.object({ title: s.string(), note: s.optional(s.string()) })
    const parsed = schema.parse({ title: 'Rice' })
    expect(parsed.ok).toBe(true)
    // `in` rather than a value check: an explicit `undefined` survives
    // structured clone, so a key written as undefined comes back
    // present-and-undefined after a reload and every `in` guard flips.
    expect(parsed.ok && 'note' in parsed.value).toBe(false)
  })

  it('drops an explicit undefined on an optional key rather than storing it', () => {
    const schema = s.object({ note: s.optional(s.string()) })
    const parsed = schema.parse({ note: undefined })
    expect(parsed.ok && 'note' in parsed.value).toBe(false)
  })

  /**
   * A field a newer build wrote has to survive a round trip through an older
   * one. A parser that rebuilt each object from the keys it recognised would
   * turn "open jojo in a stale tab" into silent, permanent data loss.
   */
  it('passes unknown keys through untouched', () => {
    const parsed = s.object({ title: s.string() }).parse({ title: 'Rice', futureField: 7 })
    expect(parsed.ok && parsed.value).toEqual({ title: 'Rice', futureField: 7 })
  })

  it('never lets a passthrough key shadow a validated one', () => {
    const parsed = s.object({ title: s.string() }).parse({ title: 'Rice' })
    expect(parsed.ok && parsed.value.title).toBe('Rice')
  })

  it('rejects an array and null where an object is wanted', () => {
    const schema = s.object({ title: s.string() })
    expect(schema.parse([]).ok).toBe(false)
    expect(schema.parse(null).ok).toBe(false)
  })

  it('reports a nested path in full', () => {
    const schema = s.object({ offer: s.object({ respondBy: s.isoDate() }) })
    const parsed = schema.parse({ offer: { respondBy: 'soon' } })
    expect(parsed.ok === false && formatIssues(parsed.issues)).toBe(
      'offer.respondBy: Needs to be a date.',
    )
  })
})

describe('meta', () => {
  /**
   * `FieldMeta` has to stay readable as data, because the command palette
   * generates a form from it. The moment a validator's shape is only knowable
   * by running it, every tool needs a hand-written form — which is the state
   * the app is in today, and why two of those forms disagree about whether a
   * URL is required.
   */
  it('describes the shape without running anything', () => {
    const schema = s.object({
      title: s.string({ label: 'Title', min: 1 }),
      stage: s.enum(['draft', 'closed'] as const, { label: 'Stage' }),
      note: s.optional(s.string({ multiline: true })),
      keywords: s.array(s.id('keyword')),
    })

    expect(schema.meta.kind).toBe('object')
    expect(schema.meta.fields?.['title']).toEqual({ kind: 'string', label: 'Title', min: 1 })
    expect(schema.meta.fields?.['stage']?.options).toEqual(['draft', 'closed'])
    expect(schema.meta.fields?.['note']?.optional).toBe(true)
    expect(schema.meta.fields?.['keywords']?.of?.nodeType).toBe('keyword')
  })

  // An absent option must be an absent key, not a key set to undefined:
  // `exactOptionalPropertyTypes` makes them different types, and a form reading
  // `'label' in meta` would answer yes to a field with no label.
  it('leaves an unset option off the meta entirely', () => {
    expect(s.string().meta).toEqual({ kind: 'string' })
  })
})

/**
 * A refusal that names what was actually sent.
 *
 * The largest single source of refused tool calls in the multi-turn benchmark:
 * GPT-OSS 120B sent `{"kind":"application"}` to `memory.list` eleven times out
 * of thirteen. The field is `type`; its LABEL is "Kind". Unknown keys pass
 * through by design, so nothing rejected `kind` — it was never read, and the
 * refusal said "type: Needs to be one of…" as though nothing had been supplied.
 */
describe('unread keys in a failed parse', () => {
  const shape = s.object({ type: s.string({ label: 'Kind' }), limit: s.optional(s.number()) })

  it('names them, and names the fields there actually are', () => {
    const out = shape.parse({ kind: 'application' }, '')
    expect(out.ok).toBe(false)
    if (out.ok) return
    const text = out.issues.map((i) => i.message).join(' ')
    expect(text).toContain('kind')
    expect(text).toContain('type')
  })

  it('says nothing when the call worked', () => {
    // Passthrough stays passthrough: a call that succeeded with an extra key is
    // not made to explain itself, which is what lets a newer client talk to an
    // older build.
    const out = shape.parse({ type: 'application', somethingNew: 1 }, '')
    expect(out.ok).toBe(true)
  })

  it('says nothing about unread keys when there are none', () => {
    const out = shape.parse({ type: 42 }, '')
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.issues.map((i) => i.message).join(' ')).not.toContain('not fields of this tool')
  })
})
