/**
 * The extension's copy of the crawler's manners has not drifted.
 *
 * `web/extension/worker/crawl-rules.js` is a hand transcription of
 * `service/kg/core/robots.ts` and of `NO_AUTOMATED_ACCESS` in
 * `service/kg/core/board.ts`, because the extension is loaded from disk and
 * cannot import from the package (see `policy.js` for the longer version of
 * that bargain). Lists can be compared structurally; a parser cannot, so the
 * functions are compared by BEHAVIOUR: every case in `robots.cases.ts` is run
 * through both, and they must give the same answer.
 */

import { describe, expect, it } from 'vitest'
// @ts-expect-error — a plain ES module the worker loads from disk, with no types.
import * as js from '../../extension/worker/crawl-rules.js'
import { NO_AUTOMATED_ACCESS, noAutomatedAccess } from '@jojo/service/core/board'
import * as core from '@jojo/service/core/robots'
import { BOT_WALL_CASES, ROBOTS_CASES } from '@jojo/service/core/robots.cases'

type RobotsRules = core.RobotsRules

describe('the extension carries the same crawl rules as the package', () => {
  it('refuses the same sites', () => {
    expect(js.NO_AUTOMATED_ACCESS).toEqual([...NO_AUTOMATED_ACCESS])
    for (const url of [
      'https://www.linkedin.com/jobs/view/1',
      'https://uk.linkedin.com/jobs',
      'https://ca.indeed.com/jobs?q=x',
      'https://www.indeed.co.uk/viewjob?jk=1',
      'https://www.glassdoor.de/Job/index.htm',
      'https://www.ziprecruiter.com/jobs-search',
      'linkedin.com/jobs',
      'https://notlinkedin.com/jobs',
      'https://linkedin.com.attacker.net/',
      'https://careercenter.cra.org/jobs',
      'garbage',
    ]) {
      expect(js.noAutomatedAccess(url), url).toBe(noAutomatedAccess(url))
    }
  })

  it('has the same numbers', () => {
    expect(js.BOARD_MIN_GAP_MS).toBe(core.BOARD_MIN_GAP_MS)
    expect(js.BOARD_DAILY_PAGES).toBe(core.BOARD_DAILY_PAGES)
    expect(js.ROBOTS_MAX_CHARS).toBe(core.ROBOTS_MAX_CHARS)
    expect(js.BOT_WALL_FEW_LINKS).toBe(core.BOT_WALL_FEW_LINKS)
    expect(js.ALLOW_ALL).toEqual(core.ALLOW_ALL)
  })

  for (const c of ROBOTS_CASES) {
    it(`reads robots.txt the same way: ${c.name}`, () => {
      const mine = js.parseRobots(c.robots) as RobotsRules
      const theirs = core.parseRobots(c.robots)
      expect(mine).toEqual(theirs)
      for (const [url] of c.urls) expect(js.robotsAllows(mine, url), url).toBe(core.robotsAllows(theirs, url))
      expect(js.pageGapMs(mine)).toBe(core.pageGapMs(theirs))
    })
  }

  it('finds robots.txt in the same place', () => {
    for (const url of ['https://a.test/x?y=1', 'http://localhost:8877/jobs', 'ftp://a.test/', 'nope']) {
      expect(js.robotsAddress(url)).toBe(core.robotsAddress(url))
    }
  })

  it('paces the same way', () => {
    const t0 = Date.parse('2026-11-21T10:00:00Z')
    let a: core.PaceBook = {}
    let b: core.PaceBook = {}
    for (let i = 0; i < core.BOARD_DAILY_PAGES + 2; i += 1) {
      const now = t0 + i * 3000
      expect(js.pace(a, 'a.test', now, 5000)).toEqual(core.pace(b, 'a.test', now, 5000))
      a = js.paced(a, 'a.test', now) as core.PaceBook
      b = core.paced(b, 'a.test', now)
      expect(a).toEqual(b)
    }
    const tomorrow = Date.parse('2026-11-22T08:00:00Z')
    expect(js.paced(a, 'b.test', tomorrow)).toEqual(core.paced(b, 'b.test', tomorrow))
    expect(js.paceHost('https://www.A.test/x')).toBe(core.paceHost('https://www.A.test/x'))
  })

  for (const c of BOT_WALL_CASES) {
    it(`tells a bot check the same way: ${c.name}`, () => {
      expect(js.looksLikeBotWall(c.page)).toBe(c.wall)
      expect(core.looksLikeBotWall(c.page)).toBe(c.wall)
    })
  }
})
