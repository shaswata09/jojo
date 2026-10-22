/**
 * What counts as a job, and what a board scan is allowed to return.
 *
 * The negative cases carry the weight here. A predicate that says yes to every
 * posting and also to the search page it was read from is worse than no
 * predicate, because the scout's first suggestion on every board would be the
 * board itself, filed as a job.
 */

import { describe, expect, it } from 'vitest'
import {
  BOARD_MAX_RESULTS,
  crawlBoard,
  isJobPostingUrl,
  onOneOf,
  pageLinks,
  parseSources,
  readListings,
} from './board'
import type { BoardScan } from './board'

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

/*
 * The academic boards, by the link shapes measured on them 2026-10-22. Every
 * HigherEdJobs posting was refused before the query rule existed — its jobs
 * live at `details.cfm?JobCode=…`, a path that names no job at all.
 */
describe('the academic boards', () => {
  it('keeps their postings', () => {
    for (const url of [
      'https://www.higheredjobs.com/faculty/details.cfm?JobCode=179575091&Title=Director%20of%20Institutional%20Research',
      'https://academicjobsonline.org/ajo/jobs/32236',
      'https://academiccareers.com/job/182527/canada-impact-emerging-leader/',
      'https://careercenter.cra.org/jobs/21587304/assistant-professor-computer-science',
    ]) {
      expect(isJobPostingUrl(url), url).toBe(true)
    }
  })

  it('refuses their search pages', () => {
    for (const url of [
      'https://www.higheredjobs.com/faculty/search.cfm?JobCat=31&Page=2',
      'https://www.higheredjobs.com/search/results.cfm?JobCode=179575091',
      'https://academiccareers.com/jobs/',
      'https://example.edu/news.php?id=12345',
    ]) {
      expect(isJobPostingUrl(url), url).toBe(false)
    }
  })
})

describe('one job, however a board spells its link', () => {
  it('folds AcademicJobsOnline’s Apply link into the posting it sits beside', () => {
    const out = readListings(
      [
        { url: '/ajo/jobs/32236', title: 'IOPF2026' },
        { url: 'https://academicjobsonline.org/ajo/jobs/32236/apply', title: 'Apply' },
      ],
      'https://academicjobsonline.org/ajo/jobs',
    )
    expect(out).toEqual([{ url: 'https://academicjobsonline.org/ajo/jobs/32236', title: 'IOPF2026' }])
  })

  it('reads a HigherEdJobs posting by its code, whatever its title parameter says', () => {
    const [a, b] = readListings(
      [
        { url: 'details.cfm?JobCode=179575091&Title=Director', title: 'Director' },
        { url: 'details.cfm?JobCode=179575091&Title=Director%20of%20IR', title: 'Director of IR' },
      ],
      'https://www.higheredjobs.com/faculty/search.cfm?JobCat=31',
    )
    expect(a?.url).toBe('https://www.higheredjobs.com/faculty/details.cfm?JobCode=179575091')
    expect(b).toBeUndefined()
  })
})

describe('which hosts are the board a person named', () => {
  it('admits the www spelling and the board’s own subdomains', () => {
    expect(onOneOf('https://careercenter.cra.org/jobs/', ['https://cra.org/ads'])).toBe(true)
    expect(onOneOf('https://www.higheredjobs.com/faculty/', ['https://higheredjobs.com/'])).toBe(true)
    expect(onOneOf('https://higheredjobs.com/faculty/', ['https://www.higheredjobs.com/'])).toBe(true)
  })

  it('still refuses look-alikes and the rest of a parent domain', () => {
    expect(onOneOf('https://cra.org.attacker.net/ads', ['https://cra.org/ads'])).toBe(false)
    expect(onOneOf('https://evil-cra.org/ads', ['https://cra.org/ads'])).toBe(false)
    expect(onOneOf('https://acme.com/admin', ['https://jobs.acme.com/'])).toBe(false)
  })
})

describe('finding the next pages of a board', () => {
  const HEJ = 'https://www.higheredjobs.com/faculty/search.cfm?JobCat=31'

  it('reads HigherEdJobs’ pager: next first, then the numbers, never page one or back', () => {
    const rows = [
      { url: '/faculty/search.cfm?JobCat=31&Page=1', title: '<', rel: 'prev' },
      { url: '/faculty/search.cfm?JobCat=31&Page=1', title: '1' },
      { url: '/faculty/search.cfm?JobCat=31&Page=3', title: '3' },
      { url: '/faculty/search.cfm?JobCat=31&Page=2', title: '2' },
      { url: '/faculty/search.cfm?JobCat=31&Page=2', title: '>', rel: 'next' },
      { url: 'details.cfm?JobCode=179575091', title: 'Director of Institutional Research' },
    ]
    expect(pageLinks(rows, HEJ)).toEqual([
      'https://www.higheredjobs.com/faculty/search.cfm?JobCat=31&Page=2',
      'https://www.higheredjobs.com/faculty/search.cfm?JobCat=31&Page=3',
    ])
  })

  it('trusts a link that says Next even when it leaves the path', () => {
    // AcademicJobsOnline's, verbatim.
    expect(
      pageLinks([{ url: '/ajo?joblst-0-0-0-0--40-40---', title: 'next...' }], 'https://academicjobsonline.org/ajo/jobs'),
    ).toEqual(['https://academicjobsonline.org/ajo?joblst-0-0-0-0--40-40---'])
  })

  it('follows WordPress-style /page/N and ignores numbers that are not pages', () => {
    const rows = [
      { url: 'https://cra.org/ads/page/2/', title: '2' },
      { url: 'https://cra.org/events/2026/10/', title: '22' },
      { url: 'https://cra.org/ads/#top', title: '1' },
      { url: 'https://elsewhere.org/ads/page/3/', title: 'Next »' },
    ]
    expect(pageLinks(rows, 'https://cra.org/ads/')).toEqual(['https://cra.org/ads/page/2/'])
  })

  it('takes an icon-only next link by its accessible name', () => {
    // The harvest falls back to aria-label when a link has no text.
    expect(pageLinks([{ url: '?page=2', title: 'Next page' }], 'https://jobs.example.edu/search')).toEqual([
      'https://jobs.example.edu/search?page=2',
    ])
  })
})

describe('reading a board page by page', () => {
  /** A board of `pages` pages, `per` jobs each, linked by Next. */
  const board = (pages: number, per: number): { scan: BoardScan; opened: string[] } => {
    const opened: string[] = []
    const scan: BoardScan = async (url) => {
      opened.push(url)
      const n = Number(new URL(url).searchParams.get('page') ?? '1')
      const rows: unknown[] = Array.from({ length: per }, (_, i) => ({
        url: `/jobs/${String(n * 1000 + i)}`,
        title: `Job ${String(n)}.${String(i)}`,
      }))
      // Page two links back to page one under another spelling, as boards do.
      rows.push({ url: '/search?page=1', title: '1' })
      if (n < pages) rows.push({ url: `/search?page=${String(n + 1)}`, title: 'Next' })
      return { ok: true, rows }
    }
    return { scan, opened }
  }
  const everywhere = () => true
  const nothingKnown = () => false

  it('reads every page, once each', async () => {
    const { scan, opened } = board(4, 5)
    const out = await crawlBoard({ start: 'https://a.test/search', scan, allowed: everywhere, known: nothingKnown })
    expect(out.ok && out.pages.length).toBe(4)
    expect(out.ok && out.listings.length).toBe(20)
    expect(out.ok && out.next).toBeUndefined()
    // Page one was not read twice under its `?page=1` spelling.
    expect(opened).toHaveLength(4)
  })

  /*
   * The bug, as a test: a first page full of jobs already seen used to be the
   * whole answer, and an empty answer twice running offers to switch off.
   */
  it('finds the new jobs behind a first page the person has already seen', async () => {
    const { scan } = board(3, 5)
    const out = await crawlBoard({
      start: 'https://a.test/search',
      scan,
      allowed: everywhere,
      known: (url) => /\/jobs\/1\d{3}$/.test(url),
    })
    expect(out.ok && out.alreadySeen).toBe(5)
    expect(out.ok && out.listings.map((l) => l.title)[0]).toBe('Job 2.0')
    expect(out.ok && out.listings.length).toBe(10)
  })

  it('stops when the answer is full, and says where to carry on', async () => {
    const { scan } = board(10, 30)
    const out = await crawlBoard({ start: 'https://a.test/search', scan, allowed: everywhere, known: nothingKnown })
    expect(out.ok && out.listings.length).toBe(BOARD_MAX_RESULTS)
    expect(out.ok && out.pages.length).toBe(2)
    expect(out.ok && out.next).toBe('https://a.test/search?page=3')
  })

  it('stops at the page budget', async () => {
    const { scan } = board(50, 1)
    const out = await crawlBoard({ start: 'https://a.test/search', scan, allowed: everywhere, known: nothingKnown, maxPages: 3 })
    expect(out.ok && out.pages.length).toBe(3)
    expect(out.ok && out.next).toBe('https://a.test/search?page=4')
  })

  it('opens no page the guard refuses', async () => {
    const { scan, opened } = board(3, 1)
    await crawlBoard({
      start: 'https://a.test/search',
      scan,
      allowed: (url) => !url.includes('page=2'),
      known: nothingKnown,
    })
    expect(opened).toEqual(['https://a.test/search'])
  })

  it('keeps the pages it read when a later one fails', async () => {
    const { scan: good } = board(3, 2)
    const scan: BoardScan = async (url) =>
      url.includes('page=3') ? { ok: false, reason: 'That board took too long to load.' } : good(url)
    const out = await crawlBoard({ start: 'https://a.test/search', scan, allowed: everywhere, known: nothingKnown })
    expect(out.ok && out.listings.length).toBe(4)
    expect(out.ok && out.stopped).toBe('That board took too long to load.')
    expect(out.ok && out.next).toBe('https://a.test/search?page=3')
  })

  it('reports the board failing when the first page does', async () => {
    const scan: BoardScan = async () => ({ ok: false, reason: 'That board wants a sign-in.' })
    const out = await crawlBoard({ start: 'https://a.test/search', scan, allowed: everywhere, known: nothingKnown })
    expect(out).toEqual({ ok: false, reason: 'That board wants a sign-in.' })
  })

  it('resolves rows against where a redirected board landed', async () => {
    const scan: BoardScan = async () => ({
      ok: true,
      landed: 'https://careercenter.cra.org/jobs/',
      rows: [{ url: '21587304/assistant-professor', title: 'Assistant Professor' }],
    })
    const out = await crawlBoard({ start: 'https://cra.org/ads/', scan, allowed: everywhere, known: nothingKnown })
    expect(out.ok && out.listings[0]?.url).toBe('https://careercenter.cra.org/jobs/21587304/assistant-professor')
  })
})
