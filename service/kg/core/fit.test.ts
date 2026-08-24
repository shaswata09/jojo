import { describe, expect, it } from 'vitest'
import { fitOf } from './fit'
import type { Profile } from './model'

/**
 * The scorer's contract, and mostly its refusals.
 *
 * The interesting assertions here are the ones about *not* scoring. The thing
 * this replaced was a set of fixture percentages that looked computed and were
 * not, so the failure mode worth guarding is a number appearing where nothing
 * was known — a confident 50% over an empty profile is worse than the fixtures
 * were, because at least those were labelled.
 */

const profile = (over: Partial<Profile['text']> = {}, terms: string[] = []): Profile =>
  ({
    text: {
      fullName: '',
      position: '',
      location: '',
      email: '',
      website: '',
      scholar: '',
      github: '',
      linkedin: '',
      targetRoles: '',
      regions: '',
      ...over,
    },
    matchTerms: terms,
    includeAcademia: true,
    includeIndustry: true,
  }) as Profile

describe('fitOf', () => {
  it('refuses to score against a profile that says nothing', () => {
    const fit = fitOf(profile(), 'Assistant Professor, Rice University')
    expect(fit.score).toBeNull()
    expect(fit.reason).toMatch(/match terms|target roles/i)
  })

  it('scores every term hit as full marks', () => {
    const fit = fitOf(
      profile({}, ['graph inference', 'distributed training']),
      'Postdoc in graph inference and distributed training',
    )
    expect(fit.score).toBe(100)
    expect(fit.matched).toContain('graph inference')
  })

  it('scores nothing hit as zero rather than as unknown', () => {
    const fit = fitOf(profile({}, ['graph inference']), 'Lecturer in medieval history')
    expect(fit.score).toBe(0)
    expect(fit.matched).toEqual([])
  })

  it('matches a role phrase inside a longer title', () => {
    const fit = fitOf(
      profile({ targetRoles: 'assistant professor' }),
      'Assistant Professor of Computer Science, tenure track',
    )
    expect(fit.score).toBe(100)
  })

  it('is accent- and case-insensitive on both sides', () => {
    const fit = fitOf(profile({}, ['Muñoz']), 'Working with A. MUNOZ')
    expect(fit.score).toBe(100)
  })

  it('weights match terms above roles, so the field built for this dominates', () => {
    const both = profile({ targetRoles: 'lecturer' }, ['graph inference'])
    const onlyTerms = fitOf(both, 'Postdoc in graph inference')
    const onlyRole = fitOf(both, 'Lecturer in medieval history')
    expect(onlyTerms.score).toBeGreaterThan(onlyRole.score ?? 0)
  })

  it('treats regions as a bonus, not a filter', () => {
    const p = profile({ regions: 'Texas' }, ['graph inference'])
    const elsewhere = fitOf(p, 'Postdoc in graph inference, Toronto')
    // Everything that was asked for is there except the region, so it must still
    // rank well — somewhere you did not list is not disqualifying.
    expect(elsewhere.score).toBeGreaterThanOrEqual(80)
  })

  it('does not let one loose word carry a multi-word term', () => {
    // 'professor' alone must not satisfy 'assistant professor', or every
    // academic posting scores full marks and the ranking says nothing.
    const fit = fitOf(profile({ targetRoles: 'assistant professor' }), 'Professor of Music')
    expect(fit.score).toBe(0)
  })

  it('splits on the interpunct the profile placeholders ask for', () => {
    // Both Profile screens suggest `Assistant professor (TT) · Research
    // scientist`. Splitting on commas alone made that one unmatchable phrase,
    // so a user who typed what they were shown scored zero on the field.
    const fit = fitOf(
      profile({ targetRoles: 'Assistant professor · Research scientist' }),
      'Assistant Professor of Computer Science, tenure track',
    )
    expect(fit.score).toBe(50)
    expect(fit.matched).toEqual(['assistant professor'])
  })

  it('will not find a two-letter region in the middle of a word', () => {
    // The seeded profile's region is 'US'. As a substring it is inside Austin,
    // focus, campus and industry, which awarded the region bonus to nearly
    // every posting and printed `matched: us` under it.
    const fit = fitOf(
      profile({ regions: 'US' }, ['graph inference']),
      'Postdoc, Austin — focus on graph inference',
    )
    expect(fit.matched).not.toContain('us')
    expect(fit.score).toBe(86)
  })

  it('still finds a short term standing on its own', () => {
    const fit = fitOf(
      profile({ regions: 'US' }, ['graph inference']),
      'Postdoc in graph inference — US, remote',
    )
    expect(fit.matched).toContain('us')
    expect(fit.score).toBe(100)
  })

  it('keeps the substring test for terms long enough to be safe', () => {
    // 'inference' matching 'inferences' is the whole reason the loose test is
    // there; the short-term rule must not cost it.
    expect(fitOf(profile({}, ['inference']), 'Work on inferences at scale').score).toBe(100)
  })

  it('survives a term made of punctuation', () => {
    // 'c++' is short enough for the whole-word rule, and a trailing boundary
    // after a plus sign would never match.
    expect(fitOf(profile({}, ['c++']), 'Systems work in C++ and Rust').score).toBe(100)
  })
})
