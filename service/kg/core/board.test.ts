/**
 * What counts as a job, and what a board scan is allowed to return.
 *
 * The negative cases carry the weight here. A predicate that says yes to every
 * posting and also to the search page it was read from is worse than no
 * predicate, because the scout's first suggestion on every board would be the
 * board itself, filed as a job.
 */

import { describe, expect, it } from 'vitest'
import { BOARD_MAX_RESULTS, isJobPostingUrl, parseSources, readListings } from './board'

describe('telling a posting from a list of them', () => {
  it('recognises one posting on each board it knows', () => {
    expect(isJobPostingUrl('https://www.linkedin.com/jobs/view/4378357766')).toBe(true)
    expect(isJobPostingUrl('https://www.linkedin.com/jobs/view/engineer-at-nuvo-4378357766')).toBe(
      true,
    )
    expect(
      isJobPostingUrl('https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4378357766'),
    ).toBe(true)
    expect(isJobPostingUrl('https://job-boards.greenhouse.io/anthropic/jobs/5390799008')).toBe(true)
    expect(
      isJobPostingUrl('https://jobs.lever.co/matchgroup/1deea0b0-9f37-4f2a-b8c1-0d4e5f6a7b8c'),
    ).toBe(true)
    expect(
      isJobPostingUrl('https://jobs.ashbyhq.com/openai/6ba0a5e0-3a1f-4c2b-9d8e-1f2a3b4c5d6e'),
    ).toBe(true)
    expect(
      isJobPostingUrl(
        'https://nvidia.wd5.myworkdayjobs.com/en-US/Site/job/US-CA/Senior-Engineer_JR1988734',
      ),
    ).toBe(true)
  })

  /*
   * The whole reason this module exists. Every one of these is a page the scout
   * would otherwise have read and then proposed as a job — and `draftFromUrl`
   * cannot tell them apart, because `jobs.lever.co/matchgroup` and
   * `jobs.lever.co/matchgroup/<uuid>` both parse as "a job at Matchgroup".
   */
  it('refuses a board’s own index and search pages', () => {
    expect(isJobPostingUrl('https://jobs.lever.co/matchgroup')).toBe(false)
    expect(isJobPostingUrl('https://jobs.ashbyhq.com/openai')).toBe(false)
    expect(isJobPostingUrl('https://job-boards.greenhouse.io/anthropic')).toBe(false)
    expect(isJobPostingUrl('https://www.linkedin.com/jobs/search/?keywords=ml&location=Texas')).toBe(
      false,
    )
    expect(isJobPostingUrl('https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite')).toBe(
      false,
    )
  })

  /*
   * A deep link INTO a posting is still that posting's address — Lever's
   * `/apply` and Ashby's `/application` are the same job with the form open,
   * and `canonicalPostingUrl` folds them. Refusing them here would drop a real
   * job whose only crime is the link the user happened to have.
   */
  it('accepts a deep link into a posting, which dedupe then folds', () => {
    expect(
      isJobPostingUrl('https://jobs.lever.co/matchgroup/1deea0b0-9f37-4f2a-b8c1-0d4e5f6a7b8c/apply'),
    ).toBe(true)
  })

  it('refuses the rest of a board’s furniture', () => {
    expect(isJobPostingUrl('https://www.linkedin.com/feed/')).toBe(false)
    expect(isJobPostingUrl('not a url')).toBe(false)
    expect(isJobPostingUrl('javascript:alert(1)')).toBe(false)
    expect(isJobPostingUrl('')).toBe(false)
  })

  /*
   * An unrecognised board has to clear a real bar rather than a plausible one:
   * being wrong permissively puts a lie in the user's records, being wrong
   * strictly drops a job they can still reach themselves.
   */
  it('asks an unfamiliar board for both a job word and an id', () => {
    expect(isJobPostingUrl('https://acme.test/careers/senior-engineer-88213')).toBe(true)
    expect(isJobPostingUrl('https://acme.test/jobs/4021234567')).toBe(true)
    expect(isJobPostingUrl('https://acme.test/careers')).toBe(false)
    expect(isJobPostingUrl('https://acme.test/careers/all')).toBe(false)
    expect(isJobPostingUrl('https://acme.test/about/4021234567')).toBe(false)
    expect(isJobPostingUrl('https://acme.test/jobs/search')).toBe(false)
  })
})

describe('reading the boards a pipeline watches', () => {
  /*
   * The first reader of a field users have been filling in for a while: both
   * dialogs have always promised "Separate several with commas" and nothing
   * split on one.
   */
  it('splits on commas, as both dialogs have always promised', () => {
    expect(parseSources('https://a.test/jobs, https://b.test/careers')).toEqual([
      'https://a.test/jobs',
      'https://b.test/careers',
    ])
  })

  it('accepts the bare hostname both placeholders show', () => {
    expect(parseSources('cra.org/ads')).toEqual(['https://cra.org/ads'])
  })

  it('drops the em dash that means "nothing here"', () => {
    expect(parseSources('—')).toEqual([])
    expect(parseSources('')).toEqual([])
  })

  /*
   * Inventing an address for prose would send the scout somewhere real by
   * accident, which is worse than fetching nothing.
   */
  it('drops prose rather than guessing an address out of it', () => {
    expect(parseSources('the CRA job board')).toEqual([])
    expect(parseSources('anywhere in Texas')).toEqual([])
  })

  it('keeps localhost, which is a real host and not prose', () => {
    expect(parseSources('http://localhost:8877/jobs')).toEqual(['http://localhost:8877/jobs'])
    expect(parseSources('linkedin')).toEqual([])
  })

  it('does not list the same board twice', () => {
    expect(parseSources('a.test/jobs, a.test/jobs')).toEqual(['https://a.test/jobs'])
  })
})

describe('vetting what a scan returned', () => {
  const from = 'https://job-boards.greenhouse.io/anthropic'

  it('keeps the postings and drops everything else on the page', () => {
    const rows = readListings(
      [
        { url: '/anthropic/jobs/5390799008', title: 'Research Engineer' },
        { url: '/anthropic', title: 'All openings' },
        { url: 'https://twitter.com/anthropicai', title: 'Follow us' },
        { url: '/privacy', title: 'Privacy' },
      ],
      from,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('Research Engineer')
    expect(rows[0]?.url).toBe('https://job-boards.greenhouse.io/anthropic/jobs/5390799008')
  })

  /*
   * Most boards link their rows relatively, so dropping relative hrefs would
   * return nothing from exactly the boards that work best.
   */
  it('resolves a relative row against the board it was read from', () => {
    const rows = readListings([{ url: 'jobs/5390799008', title: 'Engineer' }], from + '/')
    expect(rows[0]?.url).toContain('/jobs/5390799008')
  })

  it('folds two spellings of one job into one row', () => {
    const rows = readListings(
      [
        { url: 'https://boards.greenhouse.io/anthropic/jobs/5390799008', title: 'Engineer' },
        { url: 'https://job-boards.greenhouse.io/anthropic/jobs/5390799008?gh_src=x', title: 'Engineer' },
      ],
      from,
    )
    expect(rows).toHaveLength(1)
  })

  it('carries the employer and location when the row said so', () => {
    const rows = readListings(
      [{ url: '/anthropic/jobs/1234567', title: 'Engineer', org: ' Anthropic ', location: 'London' }],
      from,
    )
    expect(rows[0]?.org).toBe('Anthropic')
    expect(rows[0]?.location).toBe('London')
  })

  it('leaves the optional fields off rather than empty', () => {
    const rows = readListings([{ url: '/anthropic/jobs/1234567', title: 'E', org: '   ' }], from)
    expect(rows[0]).not.toHaveProperty('org')
  })

  it('caps what one read hands the model', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      url: `/anthropic/jobs/${String(1000000 + i)}`,
      title: `Role ${String(i)}`,
    }))
    expect(readListings(many, from)).toHaveLength(BOARD_MAX_RESULTS)
  })

  /*
   * Everything here crossed postMessage from a content script relaying an
   * extension, and every field was read off a page somebody else wrote.
   */
  it('survives anything at all coming back', () => {
    expect(readListings(null, from)).toEqual([])
    expect(readListings('nope', from)).toEqual([])
    expect(readListings([null, 42, {}, { url: 5 }, { title: 'x' }], from)).toEqual([])
    expect(readListings([{ url: '/anthropic/jobs/1234567', title: '   ' }], from)).toEqual([])
  })

  it('truncates a title long enough to be an attack on the trace', () => {
    const rows = readListings(
      [{ url: '/anthropic/jobs/1234567', title: 'x'.repeat(500) }],
      from,
    )
    expect(rows[0]!.title.length).toBeLessThanOrEqual(160)
  })
})
