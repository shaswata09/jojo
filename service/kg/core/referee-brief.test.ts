import { describe, expect, it } from 'vitest'
import {
  MAX_BRIEF_HIGHLIGHTS,
  MAX_BRIEF_HIGHLIGHT_TEXT,
  MAX_BRIEF_NOTE_TEXT,
  type RefereeBrief,
} from './model'
import {
  briefFor,
  briefsWithin,
  highlightsText,
  normaliseBrief,
  normaliseBriefs,
  parseHighlights,
} from './referee-brief'

describe('parseHighlights', () => {
  it('splits on commas, semicolons and line breaks', () => {
    expect(parseHighlights('teaching, NSF CAREER; causal inference\nmentoring')).toEqual([
      'teaching',
      'NSF CAREER',
      'causal inference',
      'mentoring',
    ])
  })

  it('tidies whitespace and drops empty pieces', () => {
    expect(parseHighlights('  big   data ,, ;  \n ')).toEqual(['big data'])
  })

  it('drops repeats ignoring case, keeping the first spelling', () => {
    expect(parseHighlights('Teaching, teaching, TEACHING, grants')).toEqual(['Teaching', 'grants'])
  })

  it('accepts a list too, and splits inside its items', () => {
    expect(parseHighlights(['teaching', 'grants, outreach'])).toEqual(['teaching', 'grants', 'outreach'])
  })

  it('caps the count and cuts an over-long phrase rather than refusing it', () => {
    const many = Array.from({ length: 30 }, (_, i) => `point ${i}`).join(',')
    expect(parseHighlights(many)).toHaveLength(MAX_BRIEF_HIGHLIGHTS)
    const [long] = parseHighlights('x'.repeat(500))
    expect(long).toHaveLength(MAX_BRIEF_HIGHLIGHT_TEXT)
  })

  it('round-trips through the editor text', () => {
    const list = parseHighlights('teaching, grants')
    expect(parseHighlights(highlightsText(list))).toEqual(list)
    expect(highlightsText(undefined)).toBe('')
  })
})

describe('normaliseBrief', () => {
  it('is null when nothing is left in it', () => {
    expect(normaliseBrief({ applicationId: 'a', highlights: [' , '], note: '   ' })).toBeNull()
    expect(normaliseBrief({ applicationId: 'a' })).toBeNull()
  })

  it('keeps only the fields with something in them', () => {
    expect(normaliseBrief({ applicationId: 'a', note: '  say hi  ' })).toEqual({
      applicationId: 'a',
      note: 'say hi',
    })
    expect(normaliseBrief({ applicationId: 'a', highlights: ['grants'], note: '' })).toEqual({
      applicationId: 'a',
      highlights: ['grants'],
    })
  })

  it('cuts an over-long note', () => {
    const brief = normaliseBrief({ applicationId: 'a', note: 'n'.repeat(MAX_BRIEF_NOTE_TEXT + 50) })
    expect(brief?.note).toHaveLength(MAX_BRIEF_NOTE_TEXT)
  })
})

describe('normaliseBriefs', () => {
  const filed = new Set(['a', 'b'])

  it('keeps only applications the person is filed under', () => {
    const out = normaliseBriefs(
      [
        { applicationId: 'a', note: 'one' },
        { applicationId: 'gone', note: 'stale' },
      ],
      filed,
    )
    expect(out.map((b) => b.applicationId)).toEqual(['a'])
  })

  it('keeps one per application, the last one written', () => {
    const out = normaliseBriefs(
      [
        { applicationId: 'a', note: 'first' },
        { applicationId: 'b', note: 'other' },
        { applicationId: 'a', note: 'second' },
      ],
      filed,
    )
    expect(out).toEqual([
      { applicationId: 'b', note: 'other' },
      { applicationId: 'a', note: 'second' },
    ])
  })

  it('treats a later empty brief as clearing an earlier one', () => {
    const out = normaliseBriefs(
      [
        { applicationId: 'a', note: 'first' },
        { applicationId: 'a', note: '' },
      ],
      filed,
    )
    expect(out).toEqual([])
  })
})

describe('briefsWithin and briefFor', () => {
  const stored: RefereeBrief[] = [
    { applicationId: 'a', highlights: ['teaching'] },
    { applicationId: 'old', note: 'unfiled since' },
  ]

  it('shows only briefs for applications still filed', () => {
    expect(briefsWithin(stored, new Set(['a']))).toEqual([{ applicationId: 'a', highlights: ['teaching'] }])
    expect(briefsWithin(undefined, new Set(['a']))).toEqual([])
  })

  it('copies, so editing the result cannot reach a stored record', () => {
    const [copy] = briefsWithin(stored, new Set(['a']))
    copy?.highlights?.push('mutated')
    expect(stored[0]?.highlights).toEqual(['teaching'])
  })

  it('finds one by application', () => {
    expect(briefFor(stored, 'a')?.highlights).toEqual(['teaching'])
    expect(briefFor(stored, 'missing')).toBeUndefined()
    expect(briefFor(undefined, 'a')).toBeUndefined()
  })
})
