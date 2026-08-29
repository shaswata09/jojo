/**
 * The deep link, end to end: builder -> route pattern -> resolver.
 *
 * The Wave 1 regression is the reason this file exists. `appPath` took a string,
 * eighteen call sites handed it `a.id`, and ids are minted per session — so
 * clicking a card and pressing reload answered a live record with "This
 * application no longer exists". Every piece of that round trip typechecked and
 * every unit of it passed its own tests; what nothing tested was the trip.
 *
 * So the test boots TWO independent sessions over the same fixtures, which is
 * what a reload is: same records, all-new ids. A URL built in the first has to
 * open the right record in the second.
 */

import { describe, expect, it } from 'vitest'
import { matchPath } from 'react-router'
import { resolveAddress } from '@jojo/service/core/address'
import type { Instant } from '@jojo/service/core/model'
import { createProjections } from '@jojo/service/react/projections'
import { bootInMemory } from '@jojo/service/repo/boot'
import { appPath, BASE_TITLE, calendarDate } from '@/lib/links'
// `?raw` rather than `node:fs`: the app project's `types` is `["vite/client"]`,
// so `node:fs` does not typecheck here, and vite/client is what declares this.
import indexHtml from '../../index.html?raw'

const NOW: Instant = new Date('2026-10-12T12:00:00').toISOString()
const now = () => NOW
const TODAY = NOW.slice(0, 10)

/** A fresh process's worth of state: the same fixtures, brand-new NodeIds. */
function session() {
  const { repo } = bootInMemory({ now })
  return { graph: repo.getSnapshot(), p: createProjections(TODAY) }
}

/**
 * Percent-decoding, spelled the way React Router spells it.
 *
 * `useMatch` and `matchRoutes` both run the pathname through `decodePath` before
 * matching (`react-router/dist/…/lib/hooks.js:117`), and `matchPath` on its own
 * does NOT decode — it only turns `%2F` back into a slash. A test that called
 * `matchPath` directly would therefore assert a decoding the app never performs,
 * and would have reported an id URL as unresolvable while the browser resolved
 * it fine. Copied rather than imported because `decodePath` is not exported.
 */
const decodePath = (value: string) =>
  value
    .split('/')
    .map((v) => decodeURIComponent(v).replace(/\//g, '%2F'))
    .join('/')

/**
 * What `ApplicationDetail` receives, taken from the real route pattern rather
 * than by slicing the string — so a builder and a `<Route path>` that stopped
 * agreeing fails here instead of in a browser.
 */
function segmentOf(path: string) {
  return matchPath('/applications/:key', decodePath(path))?.params.key
}

const named = <T extends { org: string }>(list: readonly T[], org: string) =>
  list.find((a) => a.org === org)

describe('appPath', () => {
  it('builds the slug, not the id', () => {
    const { graph, p } = session()
    const rice = named(p.applications(graph), 'Rice')

    expect(rice).toBeDefined()
    expect(rice?.id).toMatch(/^app:/)
    expect(appPath(rice!)).toBe('/applications/rice')
  })

  /**
   * `slugify` only trims, lowercases and collapses whitespace, so an employer
   * called 'A/B' yields the slug 'a/b'. Encoding is what stops that inventing a
   * route segment, and `matchPath` decoding it back is what makes the round trip
   * whole — assert both halves, because either alone looks fine.
   */
  it('encodes a slug that would otherwise invent a route segment', () => {
    const path = appPath({ id: 'app:ignored', slug: 'a/b' })

    expect(path).toBe('/applications/a%2Fb')
    expect(segmentOf(path)).toBe('a/b')
  })
})

describe('a link survives a reload', () => {
  it('opens the same record in a session that never saw the id it was built in', () => {
    const a = session()
    const b = session()

    const built = named(a.p.applications(a.graph), 'Rice')!
    const path = appPath(built)

    // The premise. If these ever match, the fixtures have started minting stable
    // ids and half of this file is about a problem that no longer exists.
    const reloaded = named(b.p.applications(b.graph), 'Rice')!
    expect(reloaded.id).not.toBe(built.id)

    const found = resolveAddress(b.graph, 'application', segmentOf(path)!)
    expect(found).toBeDefined()
    expect(b.p.application(b.graph, found!.id)?.org).toBe('Rice')
    expect(b.p.application(b.graph, found!.id)?.role).toBe(built.role)
  })

  it('opens every seeded application, not just the one that was checked by hand', () => {
    const a = session()
    const b = session()

    for (const built of a.p.applications(a.graph)) {
      const key = segmentOf(appPath(built))
      const found = resolveAddress(b.graph, 'application', key!)
      expect(b.p.application(b.graph, found?.id ?? '')?.org).toBe(built.org)
    }
  })

  /**
   * The legacy branch, and its honest limit. An id URL still resolves inside the
   * session that minted it — which is what "someone has one open in a tab right
   * now" means — and cannot resolve in a session where that id was never minted,
   * because there is nothing there to resolve it to. That second case is the one
   * the empty state is for, and it is why the URL had to stop carrying an id.
   */
  it('still resolves an id URL in the session that minted it, and not after', () => {
    const a = session()
    const b = session()
    const built = named(a.p.applications(a.graph), 'Rice')!

    const legacy = `/applications/${encodeURIComponent(built.id)}`
    expect(resolveAddress(a.graph, 'application', segmentOf(legacy)!)?.id).toBe(built.id)
    expect(resolveAddress(b.graph, 'application', segmentOf(legacy)!)).toBeUndefined()
  })
})

describe('a link that names nothing', () => {
  it('resolves to undefined, which is what the empty state renders from', () => {
    const { graph } = session()

    expect(resolveAddress(graph, 'application', 'nonesuch')).toBeUndefined()
    expect(
      resolveAddress(graph, 'application', 'app:0192f4c1-7b3e-7a41-9c2d-8f5e1a0b6d33'),
    ).toBeUndefined()
  })

  /**
   * Six seeded records answer to 'stripe' — an application, a deadline, a
   * calendar event, a pipeline, a saved posting and a match. The application is
   * the only one `/applications/stripe` may open.
   */
  it('does not hand /applications/stripe one of the five other records named stripe', () => {
    const { graph, p } = session()

    const found = resolveAddress(graph, 'application', 'stripe')
    expect(found?.type).toBe('application')
    expect(p.application(graph, found!.id)?.org).toBe('Stripe')
  })
})

/**
 * `BASE_TITLE` carried the comment "Matches index.html, so the two cannot
 * drift", and nothing made that true — it is one string typed into two files,
 * one of which no test read. This is that sentence, enforced.
 *
 * It matters on the way out of a record: `useTitle(null)` restores the base
 * title, so a drifted copy leaves the tab reading something the page never says.
 */
describe('BASE_TITLE', () => {
  it('is the title index.html ships', () => {
    const title = /<title>([^<]*)<\/title>/.exec(indexHtml)?.[1]

    expect(title).toBe(BASE_TITLE)
  })
})

/**
 * The calendar's three numbers, and the day in particular.
 *
 * `readInt` used to return its fallback BEFORE the clamp, and the day's
 * fallback is today's date — a number the wall clock picks, not the month on
 * screen. '/calendar?y=2026&m=2' loaded on the 31st therefore handed the
 * Calendar d=31 in a 28-day February: no cell lit, and the day panel's
 * `isoOf(2026, 2, 31)` normalises to 2026-03-03, so an event added from a page
 * headed February was stamped in March.
 *
 * Pinned with an injected fallback rather than the live `TODAY_PARTS`, because
 * the bug only showed on the 29th, 30th and 31st of a month — a test reading
 * the clock would have passed on the other twenty-eight days and been no test
 * at all.
 */
describe('calendarDate', () => {
  const onThe31st = { y: 2026, m: 10, d: 31 }

  it('clamps the fallback day to the month that is on screen', () => {
    expect(calendarDate(new URLSearchParams('y=2026&m=2'), onThe31st).d).toBe(28)
  })

  it('clamps it just the same when the day is present but unreadable', () => {
    expect(calendarDate(new URLSearchParams('y=2026&m=2&d=nonsense'), onThe31st).d).toBe(28)
    expect(calendarDate(new URLSearchParams('y=2026&m=2&d=2.5'), onThe31st).d).toBe(28)
  })

  it('still clamps a day that was actually typed', () => {
    expect(calendarDate(new URLSearchParams('y=2026&m=2&d=31'), { y: 2026, m: 10, d: 1 }).d).toBe(
      28,
    )
  })

  it('leaves a fallback the month can honour alone', () => {
    expect(calendarDate(new URLSearchParams('y=2026&m=3'), onThe31st).d).toBe(31)
  })

  it('clamps the month and the year the same way', () => {
    const params = new URLSearchParams('y=99999&m=99&d=1')
    expect(calendarDate(params, onThe31st)).toEqual({ y: 9999, m: 12, d: 1 })
  })

  it('reads a leap February as 29 rather than 28', () => {
    expect(calendarDate(new URLSearchParams('y=2028&m=2'), onThe31st).d).toBe(29)
  })
})
