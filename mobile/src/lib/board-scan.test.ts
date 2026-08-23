/**
 * The phone's board reader, over a stubbed `fetch`.
 *
 * What matters here is the honesty of the failures rather than the parsing.
 * This path cannot reach a board that needs a browser, and the difference
 * between "no jobs" and "I could not see the jobs" is the difference between a
 * model moving on and a model concluding the search is exhausted.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { scanBoard } from './board-scan'

const html = (body: string) => ({
  ok: true,
  status: 200,
  text: async () => body,
})

const stubFetch = (value: unknown) => {
  vi.stubGlobal('fetch', vi.fn(async () => value))
}

afterEach(() => {
  vi.unstubAllGlobals()
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

  it('turns the entities a board writes back into characters', async () => {
    stubFetch(html('<a href="/jobs/1234567">R&amp;D&nbsp;Engineer</a>'))
    const out = await scanBoard('https://acme.test/jobs')
    expect((out as { rows: { title: string }[] }).rows[0]?.title).toBe('R&D Engineer')
  })

  /*
   * Named up front rather than discovered by fetching. LinkedIn answers a
   * phone with 200 and an empty shell, so the honest failure is otherwise
   * indistinguishable from a board with no jobs on it.
   */
  it('refuses the boards that only answer a real browser, before asking', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    for (const host of ['linkedin.com', 'www.linkedin.com', 'indeed.com', 'www.glassdoor.com']) {
      const out = await scanBoard(`https://${host}/jobs/search?q=ml`)
      expect(out.ok).toBe(false)
      if (!out.ok) expect(out.reason).toContain('real browser')
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
