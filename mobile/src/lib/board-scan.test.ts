/**
 * The phone's board reader, over a stubbed `fetch`.
 *
 * What matters here is the honesty of the failures rather than the parsing.
 * This path cannot reach a board that needs a browser, and the difference
 * between "no jobs" and "I could not see the jobs" is the difference between a
 * model moving on and a model concluding the search is exhausted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18next } from '@/i18n/i18n'
import { resetBoardPacing, scanBoard } from './board-scan'

const html = (body: string) => ({
  ok: true,
  status: 200,
  text: async () => body,
})

const stubFetch = (value: unknown) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => value),
  )
}

// Each test is a fresh launch: no robots.txt remembered, no host recently read.
beforeEach(() => {
  resetBoardPacing()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('what the phone can read', () => {
  it('pulls the anchors out of a server-rendered board', async () => {
    stubFetch(
      html(`<ul>
        <li><a href="/jobs/4021234567"><h3>Senior Engineer</h3></a></li>
        <li><a href='/jobs/4021234568'>ML Scientist</a></li>
      </ul>`),
    )
    const out = await scanBoard('https://acme.test/jobs')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const rows = out.rows as { url: string; title: string }[]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ url: '/jobs/4021234567', title: 'Senior Engineer' })
    expect(rows[1]?.title).toBe('ML Scientist')
  })

  it('reads the text through the tags inside a link', async () => {
    stubFetch(html('<a href="/jobs/1234567"><span>Senior</span> <b>Engineer</b></a>'))
    const out = await scanBoard('https://acme.test/jobs')
    expect((out as { rows: { title: string }[] }).rows[0]?.title).toBe('Senior Engineer')
  })

  /*
   * HigherEdJobs' pager, as served. Left encoded, `&amp;Page=2` is a different
   * address and every "next page" would be page one again.
   */
  it('decodes the links themselves, and says which one is next', async () => {
    stubFetch({
      ...html(
        '<a href="/faculty/search.cfm?JobCat=31&amp;Page=2" rel="next">&gt;</a>' +
          '<a href="?page=3" aria-label="Next page"><svg></svg></a>',
      ),
      url: 'https://www.higheredjobs.com/faculty/search.cfm?JobCat=31',
    })
    const out = await scanBoard('https://higheredjobs.com/faculty/search.cfm?JobCat=31')
    if (!out.ok) throw new Error(out.reason)
    expect(out.rows).toEqual([
      { url: '/faculty/search.cfm?JobCat=31&Page=2', title: '>', rel: 'next' },
      { url: '?page=3', title: 'Next page' },
    ])
    // Where the redirect landed, so the relative links above resolve there.
    expect(out.landed).toBe('https://www.higheredjobs.com/faculty/search.cfm?JobCat=31')
  })

  it('turns the entities a board writes back into characters', async () => {
    stubFetch(html('<a href="/jobs/1234567">R&amp;D&nbsp;Engineer</a>'))
    const out = await scanBoard('https://acme.test/jobs')
    expect((out as { rows: { title: string }[] }).rows[0]?.title).toBe('R&D Engineer')
  })

  /*
   * Named up front rather than discovered by fetching — not even their
   * robots.txt is asked. Their terms forbid automated reading, and that is
   * the reason now (it used to be the empty shell they serve a phone), shared
   * with the web through `noAutomatedAccess` in core.
   */
  it('refuses the sites whose terms forbid automated reading, before asking', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    for (const [host, site] of [
      ['linkedin.com', 'linkedin.com'],
      ['www.linkedin.com', 'linkedin.com'],
      ['indeed.com', 'indeed.com'],
      ['uk.indeed.com', 'indeed.com'],
      ['www.glassdoor.com', 'glassdoor.com'],
      ['www.ziprecruiter.com', 'ziprecruiter.com'],
    ] as const) {
      const out = await scanBoard(`https://${host}/jobs/search?q=ml`)
      expect(out.ok).toBe(false)
      if (!out.ok) {
        expect(out.reason).toBe(i18next.t('messages:boardScan.noAutomatedAccess', { host: site }))
      }
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not mistake a lookalike hostname for LinkedIn', async () => {
    stubFetch(html('<a href="/jobs/1234567">Engineer</a>'))
    const out = await scanBoard('https://notlinkedin.com/jobs')
    expect(out.ok).toBe(true)
  })

  it('says what a board answered when it refused', async () => {
    stubFetch({ ok: false, status: 403, text: async () => '' })
    const out = await scanBoard('https://acme.test/jobs')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('403')
  })

  it('reports a timeout as a timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        throw error
      }),
    )
    const out = await scanBoard('https://acme.test/jobs')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('too long')
  })

  it('refuses something that is not an address at all', async () => {
    const out = await scanBoard('the CRA job board')
    expect(out.ok).toBe(false)
  })

  /*
   * Deliberately unfiltered. `readListings` in core decides what a job is, so
   * this returns the footer and the nav too — the split is what keeps the rule
   * from being transcribed into two places.
   */
  it('returns everything it saw, judging none of it', async () => {
    stubFetch(html('<a href="/about">About</a><a href="/jobs/1234567">Engineer</a>'))
    const out = await scanBoard('https://acme.test/jobs')
    expect((out as { rows: unknown[] }).rows).toHaveLength(2)
  })
})

describe('a Stop while the phone reads a board (leaks-2)', () => {
  it('gives up the fetch at once instead of waiting out the timeout', async () => {
    let listener: (() => void) | undefined
    const signal = {
      aborted: false,
      onAbort: (fn: () => void) => {
        listener = fn
      },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              const error = new Error('Aborted')
              error.name = 'AbortError'
              reject(error)
            })
          }),
      ),
    )
    const scanning = scanBoard('https://acme.test/jobs', signal)
    signal.aborted = true
    listener?.()
    const out = await scanning
    expect(out).toEqual({ ok: false, reason: 'The read was cancelled.' })
  })

  it('does not fetch at all once already stopped', async () => {
    const fetching = vi.fn()
    vi.stubGlobal('fetch', fetching)
    const out = await scanBoard('https://acme.test/jobs', { aborted: true })
    expect(out.ok).toBe(false)
    expect(fetching).not.toHaveBeenCalled()
  })
})

/** A fetch that answers robots.txt with `robots` and every other address with `page`. */
const sites = (robots: { ok: boolean; status: number; text: () => Promise<string> }, page: unknown) => {
  const asked: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      asked.push(url)
      return url.endsWith('/robots.txt') ? robots : page
    }),
  )
  return asked
}

describe('reading a board politely', () => {
  it('does not fetch an address the site’s robots.txt disallows', async () => {
    const asked = sites(
      html('User-agent: *\nDisallow: /search/\nDisallow: /search?*\n'),
      html('<a href="/jobs/1234567">Engineer</a>'),
    )
    const out = await scanBoard('https://careercenter.cra.org/search?keywords=ml')
    expect(out).toEqual({
      ok: false,
      reason: i18next.t('messages:boardScan.robots', { host: 'careercenter.cra.org' }),
    })
    expect(asked).toEqual(['https://careercenter.cra.org/robots.txt'])
  })

  it('reads a site with no robots.txt, and asks for it once', async () => {
    vi.useFakeTimers()
    const asked = sites({ ok: false, status: 404, text: async () => '' }, html('<a href="/jobs/1234567">Engineer</a>'))
    expect((await scanBoard('https://acme.test/jobs')).ok).toBe(true)
    const second = scanBoard('https://acme.test/jobs?page=2')
    await vi.advanceTimersByTimeAsync(5000)
    expect((await second).ok).toBe(true)
    expect(asked.filter((u) => u.endsWith('/robots.txt'))).toHaveLength(1)
  })

  /*
   * Five seconds at least between two pages of one host. The second page is
   * not fetched until the gap has passed.
   */
  it('keeps a gap between two pages of one host', async () => {
    vi.useFakeTimers()
    const asked = sites({ ok: false, status: 404, text: async () => '' }, html('<a href="/jobs/1234567">Engineer</a>'))
    await scanBoard('https://acme.test/jobs')
    const second = scanBoard('https://acme.test/jobs?page=2')
    await vi.advanceTimersByTimeAsync(4000)
    expect(asked).not.toContain('https://acme.test/jobs?page=2')
    await vi.advanceTimersByTimeAsync(1100)
    await second
    expect(asked).toContain('https://acme.test/jobs?page=2')
  })

  it('stops rather than waiting a minute when a site asks for one', async () => {
    sites(html('User-agent: *\nCrawl-delay: 60\n'), html('<a href="/jobs/1234567">Engineer</a>'))
    expect((await scanBoard('https://slow.test/jobs')).ok).toBe(true)
    const out = await scanBoard('https://slow.test/jobs?page=2')
    expect(out).toEqual({
      ok: false,
      reason: i18next.t('messages:boardScan.tooSoon', { host: 'slow.test', seconds: 60 }),
    })
  })

  it('stops at a bot check instead of calling it an empty board or a 403', async () => {
    sites(
      { ok: false, status: 404, text: async () => '' },
      {
        ok: false,
        status: 403,
        text: async () =>
          '<html><head><title>Just a moment...</title></head><body><div id="challenge-form"></div></body></html>',
      },
    )
    const out = await scanBoard('https://guarded.test/jobs')
    expect(out).toEqual({ ok: false, reason: i18next.t('messages:boardScan.botWall') })
  })
})
