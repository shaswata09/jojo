/**
 * The URL guesser, pinned at the cases the comments in it argue about.
 *
 * These are guesses and they are wrong often enough to matter, so nothing here
 * saves anything — the output is a prefill for a form the user still looks at.
 * The tests that matter are the ones where the RIGHT answer is to guess nothing:
 * a wrong employer wearing a right employer's clothes never gets corrected.
 */

import { describe, expect, it } from 'vitest'
import { draftFromText, draftFromUrl, roleFromTitle } from './parse-posting'

describe('draftFromText', () => {
  it('splits on the first separator only', () => {
    expect(draftFromText('Stripe — ML engineer')).toEqual({ org: 'Stripe', role: 'ML engineer' })
    expect(draftFromText('UNT — Assistant professor — remote')).toEqual({
      org: 'UNT',
      role: 'Assistant professor — remote',
    })
  })

  it('accepts an en dash and a spaced hyphen and keeps a hyphenated employer whole', () => {
    expect(draftFromText('Rice – Statistics')).toEqual({ org: 'Rice', role: 'Statistics' })
    expect(draftFromText('Texas A&M-Commerce')).toEqual({ org: 'Texas A&M-Commerce' })
  })

  // The employer is the half worth keeping: a record filed under the right
  // employer with a blank role is findable, and the reverse is not.
  it('keeps the whole string as the employer when there is no separator to trust', () => {
    expect(draftFromText('Stripe')).toEqual({ org: 'Stripe' })
    expect(draftFromText('— Assistant professor')).toEqual({ org: '— Assistant professor' })
    expect(draftFromText('   ')).toEqual({})
  })
})

describe('draftFromUrl', () => {
  it('reads the employer off a careers hostname and the job off the path', () => {
    expect(draftFromUrl('https://jobs.rice.edu/postings/statistics-tt')).toEqual({
      source: 'Careers page',
      url: 'https://jobs.rice.edu/postings/statistics-tt',
      org: 'Rice',
      role: 'Statistics tt',
    })
  })

  // Walks in past the public suffix rather than taking a fixed position: the
  // interesting label is second-to-last on a .com and third-to-last on a .co.uk.
  it('finds the employer past a multi-part suffix', () => {
    expect(draftFromUrl('https://careers.google.co.uk/jobs/ml-engineer')?.org).toBe('Google')
  })

  it('uppercases short names, because UNT is a name where Unt is a typo', () => {
    expect(draftFromUrl('https://jobs.unt.edu/postings/cs-faculty')?.org).toBe('UNT')
  })

  /**
   * The aggregators do not carry the employer in the URL at all — it is text on
   * the page. Blank is a question the user answers; 'LinkedIn' is a wrong answer
   * that looks like a right one and is never corrected.
   */
  it('guesses no employer on an aggregator', () => {
    const draft = draftFromUrl('https://www.linkedin.com/jobs/view/3812345678')
    expect(draft.org).toBeUndefined()
    expect(draft.source).toBe('Job board')
  })

  it('takes the tenant out of a board path and out of a board hostname', () => {
    expect(draftFromUrl('https://boards.greenhouse.io/acme/jobs/4567')?.org).toBe('Acme')
    expect(draftFromUrl('https://acme.wd1.myworkdayjobs.com/careers/job/ML-Engineer')?.org).toBe(
      'Acme',
    )
  })

  // The employer's own segment can never also be the role, or a Greenhouse link
  // comes back as 'Acme — Acme'.
  it('never reuses the employer segment as the role', () => {
    const draft = draftFromUrl('https://boards.greenhouse.io/acme/jobs/4567')
    expect(draft.role).toBeUndefined()
  })

  // A role of '3812345678' is worse than no role, because it looks deliberate.
  it('drops id-shaped segments but keeps a title carrying a requisition number', () => {
    expect(draftFromUrl('https://jobs.acmecorp.com/postings/4482')?.role).toBeUndefined()
    expect(draftFromUrl('https://jobs.acmecorp.com/Data-Scientist_R-12345')?.role).toBe(
      'Data scientist',
    )
  })

  // 'Stripe' is a perfectly valid URL once a scheme is bolted on, and saving it
  // as this application's posting link is how a search box becomes a bad link.
  it('falls back to the text parser for anything that is not really a URL', () => {
    expect(draftFromUrl('Stripe — ML engineer')).toEqual({ org: 'Stripe', role: 'ML engineer' })
    expect(draftFromUrl('Stripe')).toEqual({ org: 'Stripe' })
  })

  it('accepts a scheme-less URL and keeps the one it was given', () => {
    expect(draftFromUrl('boards.greenhouse.io/acme/jobs/4567').url).toBe(
      'https://boards.greenhouse.io/acme/jobs/4567',
    )
  })

  // A `javascript:` or `data:` string parses happily and must never reach an
  // anchor.
  it('refuses a scheme that is not http or https', () => {
    expect(draftFromUrl('javascript:alert(1)').url).toBeUndefined()
    expect(draftFromUrl('data:text/html,<b>x</b>').url).toBeUndefined()
  })
})

/**
 * The half `draftFromUrl` cannot answer.
 *
 * A posting's URL often names the employer and nothing else, and the job is
 * only written down in the title line. The two title spellings in circulation
 * disagree about which half comes first, so these pin both orders.
 */
describe('roleFromTitle', () => {
  // The bug: 'jobs.rice.edu/postings/29411' names Rice and no job, so promoting
  // the seeded posting produced an application displayed as bare 'Rice'.
  it('reads the job out of a title that puts the employer last', () => {
    expect(roleFromTitle('Assistant Professor of Computer Science — Rice University', 'Rice')).toBe(
      'Assistant Professor of Computer Science',
    )
  })

  // What the Save-a-posting field writes, because that is what draftFromUrl
  // guessed: employer first.
  it('reads the job out of a title that puts the employer first', () => {
    expect(roleFromTitle('Rice — Assistant professor', 'Rice')).toBe('Assistant professor')
    expect(roleFromTitle('ML Engineer, Payments — Stripe', 'Stripe')).toBe('ML Engineer, Payments')
  })

  // 'UNT — Assistant professor — remote' is one employer and one long role, the
  // same reading draftFromText takes of the same string.
  it('keeps everything that is not the employer, rejoined', () => {
    expect(roleFromTitle('UNT — Assistant professor — remote', 'UNT')).toBe(
      'Assistant professor — remote',
    )
  })

  // Blank is the honest answer, and the important one: a role reading
  // 'jobs.rice.edu/postings/29411' would look deliberate.
  it('returns nothing when the title names only the employer or is the URL', () => {
    expect(roleFromTitle('Rice University', 'Rice')).toBe('')
    expect(roleFromTitle('Rice', 'Rice University')).toBe('')
    expect(roleFromTitle('jobs.rice.edu/postings/29411', 'jobs.rice.edu/postings/29411')).toBe('')
  })

  // With no employer to drop there is nothing to identify, so the whole line is
  // the job rather than nothing at all.
  it('keeps the whole title when no employer is known', () => {
    expect(roleFromTitle('Assistant Professor of Computer Science', '')).toBe(
      'Assistant Professor of Computer Science',
    )
  })
})
