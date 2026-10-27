import { describe, expect, it } from 'vitest'
import { fillPatch, unshout } from './fill-from-posting'

/** A draft as `scout.posting.promote` makes it from a CRA address alone. */
const fromLink = {
  org: 'CRA',
  role: 'Assistant professor manhattan kansas',
  roleTag: 'Assistant Professor',
  location: undefined,
  comp: undefined,
  postingId: undefined,
  source: 'Job board' as const,
}

/** What the page said, as the From-link reader returns it. */
const page = {
  org: 'Kansas State University',
  role: 'Assistant Professor, Computer Science',
  roleTag: 'Assistant Professor',
  location: 'Manhattan, KS',
  comp: '$95,000–$110,000',
  postingId: 'R0012345',
  deadline: '2026-12-01',
}

describe('filling a scouted draft from its posting', () => {
  it('writes what the page said over what the address guessed', () => {
    const { patch, filled } = fillPatch(fromLink, fromLink, page, ['kw:1'], false)
    expect(patch).toEqual({
      org: 'Kansas State University',
      role: 'Assistant Professor, Computer Science',
      location: 'Manhattan, KS',
      comp: '$95,000–$110,000',
      postingId: 'R0012345',
      deadline: '2026-12-01',
      keywords: ['kw:1'],
    })
    // The role type already matched, so it is not reported as filled.
    expect(filled).toEqual([
      'employer',
      'role',
      'location',
      'pay',
      'posting ID',
      'deadline',
      'keywords',
    ])
  })

  it('reports what the page confirmed, ignoring case', () => {
    const now = { ...fromLink, org: 'kansas state university' }
    const { patch, confirmed } = fillPatch(fromLink, now, page, [], false)
    expect(confirmed).toEqual(['employer', 'role type'])
    expect(patch.org).toBeUndefined()
  })

  it('leaves alone anything the person changed while the page was being read', () => {
    const edited = { ...fromLink, role: 'Assistant Professor (AI)', location: 'Remote' }
    const { patch, keptYours } = fillPatch(fromLink, edited, page, [], false)
    expect(keptYours).toEqual(['role', 'location'])
    expect(patch.role).toBeUndefined()
    expect(patch.location).toBeUndefined()
    expect(patch.org).toBe('Kansas State University')
  })

  it('does not replace a deadline or keywords the draft already has', () => {
    const { patch } = fillPatch(
      fromLink,
      { ...fromLink, keywords: ['kw:mine'] },
      page,
      ['kw:1'],
      true,
    )
    expect(patch.deadline).toBeUndefined()
    expect(patch.keywords).toBeUndefined()
  })

  it('ignores what the page left blank', () => {
    const { patch, filled } = fillPatch(fromLink, fromLink, { org: '  ', role: '' }, [], false)
    expect(patch).toEqual({})
    expect(filled).toEqual([])
  })
})

describe('a board’s capitals', () => {
  it('are put back into ordinary case, leaving acronyms alone', () => {
    expect(unshout('KANSAS STATE UNIVERSITY')).toBe('Kansas State University')
    expect(unshout('MANHATTAN, Kansas')).toBe('Manhattan, Kansas')
    expect(unshout('MIT')).toBe('MIT')
    expect(unshout('UCLA Health')).toBe('UCLA Health')
    expect(unshout('Austin, TX')).toBe('Austin, TX')
  })

  it('are fixed in the employer and location the page fills', () => {
    const shouted = {
      org: 'KANSAS STATE UNIVERSITY',
      location: 'MANHATTAN, Kansas',
      role: 'ASSISTANT PROFESSOR',
    }
    const { patch } = fillPatch(fromLink, fromLink, shouted, [], false)
    expect(patch.org).toBe('Kansas State University')
    expect(patch.location).toBe('Manhattan, Kansas')
    // A role is left as the page wrote it: capitals there can be the title.
    expect(patch.role).toBe('ASSISTANT PROFESSOR')
  })
})
