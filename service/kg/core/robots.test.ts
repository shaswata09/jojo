/**
 * The crawler's manners: robots.txt, pacing, and bot checks.
 *
 * The cases are exported as a table so the extension's transcription
 * (`web/extension/worker/crawl-rules.js`) can be run through exactly the same
 * ones — see `web/src/lib/extension-crawl-rules.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import {
  ALLOW_ALL,
  BOARD_DAILY_PAGES,
  BOARD_MIN_GAP_MS,
  looksLikeBotWall,
  pace,
  paced,
  paceHost,
  pageGapMs,
  parseRobots,
  robotsAddress,
  robotsAllows,
} from './robots'
import { ROBOTS_CASES, BOT_WALL_CASES } from './robots.cases'

describe('reading a robots.txt', () => {
  for (const c of ROBOTS_CASES) {
    it(c.name, () => {
      const rules = parseRobots(c.robots)
      for (const [url, allowed] of c.urls) expect(robotsAllows(rules, url), url).toBe(allowed)
      if ('crawlDelay' in c) expect(rules.crawlDelay).toBe(c.crawlDelay)
    })
  }

  it('reads nothing into a file that is not a robots.txt', () => {
    expect(parseRobots('<!doctype html><html><body><a href="/x">x</a></body></html>')).toEqual(ALLOW_ALL)
    expect(parseRobots('')).toEqual(ALLOW_ALL)
  })

  it('refuses an address it cannot parse, and always allows robots.txt itself', () => {
    const all = parseRobots('User-agent: *\nDisallow: /')
    expect(robotsAllows(all, 'not a url')).toBe(false)
    expect(robotsAllows(all, 'https://a.test/robots.txt')).toBe(true)
  })

  it('knows where a site keeps it', () => {
    expect(robotsAddress('https://careercenter.cra.org/jobs?page=2')).toBe('https://careercenter.cra.org/robots.txt')
    expect(robotsAddress('http://localhost:8877/jobs')).toBe('http://localhost:8877/robots.txt')
    expect(robotsAddress('ftp://a.test/x')).toBeNull()
    expect(robotsAddress('nonsense')).toBeNull()
  })
})

describe('pacing one host', () => {
  const t0 = Date.parse('2026-11-21T10:00:00Z')

  it('never goes faster than five seconds, and slower when a site asks', () => {
    expect(pageGapMs(ALLOW_ALL)).toBe(BOARD_MIN_GAP_MS)
    expect(pageGapMs(parseRobots('User-agent: *\nCrawl-delay: 2'))).toBe(5000)
    // AcademicJobsOnline's, measured.
    expect(pageGapMs(parseRobots('User-agent: *\nCrawl-delay: 5'))).toBe(5000)
    expect(pageGapMs(parseRobots('User-agent: *\nCrawl-delay: 12.5'))).toBe(12500)
  })

  it('owes no wait on a host it has not loaded, and the rest of the gap on one it has', () => {
    expect(pace({}, 'a.test', t0, 5000)).toEqual({ ok: true, waitMs: 0 })
    const book = paced({}, 'a.test', t0)
    expect(pace(book, 'a.test', t0 + 1200, 5000)).toEqual({ ok: true, waitMs: 3800 })
    expect(pace(book, 'a.test', t0 + 6000, 5000)).toEqual({ ok: true, waitMs: 0 })
    // Another host is its own count.
    expect(pace(book, 'b.test', t0 + 10, 5000)).toEqual({ ok: true, waitMs: 0 })
  })

  it('stops a host at its daily budget, and starts again the next day', () => {
    let book = {}
    for (let i = 0; i < BOARD_DAILY_PAGES; i += 1) book = paced(book, 'a.test', t0 + i * 6000)
    const late = t0 + BOARD_DAILY_PAGES * 6000
    expect(pace(book, 'a.test', late, 5000)).toEqual({ ok: false, why: 'budget' })
    expect(pace(book, 'b.test', late, 5000).ok).toBe(true)
    const tomorrow = Date.parse('2026-11-22T00:00:01Z')
    expect(pace(book, 'a.test', tomorrow, 5000)).toEqual({ ok: true, waitMs: 0 })
  })

  it('forgets earlier days, so the book cannot grow forever', () => {
    const old = paced({}, 'a.test', t0)
    const next = paced(old, 'b.test', Date.parse('2026-11-23T09:00:00Z'))
    expect(Object.keys(next)).toEqual(['b.test'])
  })

  it('keeps one count for a site with and without www', () => {
    expect(paceHost('https://www.HigherEdJobs.com/faculty')).toBe('higheredjobs.com')
    expect(paceHost('nonsense')).toBeNull()
  })
})

describe('telling a bot check from a board', () => {
  for (const c of BOT_WALL_CASES) {
    it(c.name, () => {
      expect(looksLikeBotWall(c.page)).toBe(c.wall)
    })
  }
})
