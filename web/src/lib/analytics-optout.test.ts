/**
 * Turning analytics off forgets this browser's analytics identity.
 *
 * Before, the switch stopped new reports and left the GA client id cookie and
 * Firebase's installation id behind — the id earlier reports were filed under.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { followAnalyticsSwitch, forgetAnalyticsIdentity } from './analytics'
import analyticsSource from './analytics.ts?raw'

/** A cookie jar keyed by name and domain, which is how a browser keys it. */
function jar(host: string, cookies: { name: string; domain: string }[]) {
  const live = new Map(cookies.map((c) => [`${c.name}@${c.domain}`, c.name]))
  const deleted: string[] = []
  return {
    deleted,
    live,
    env: {
      hostname: host,
      readCookies: () => [...live.values()].map((n) => `${n}=x`).join('; '),
      writeCookie: (line: string) => {
        const name = line.split('=')[0] ?? ''
        const domain = /domain=([^;]+)/.exec(line)?.[1] ?? host
        if (line.includes('expires=Thu, 01 Jan 1970')) live.delete(`${name}@${domain}`)
      },
      deleteDatabase: (name: string) => {
        deleted.push(name)
      },
    },
  }
}

describe('forgetting the analytics identity', () => {
  it('expires the GA cookies on whichever domain gtag set them, and only those', () => {
    const j = jar('me.github.io', [
      { name: '_ga', domain: '.me.github.io' },
      { name: '_ga_ABC123', domain: '.me.github.io' },
      { name: '_gid', domain: 'me.github.io' },
      { name: 'theme', domain: 'me.github.io' },
      { name: '_gauge', domain: 'me.github.io' },
    ])
    forgetAnalyticsIdentity(j.env)
    expect([...j.live.values()].sort()).toEqual(['_gauge', 'theme'])
  })

  it('deletes Firebase’s installation and heartbeat databases', () => {
    const j = jar('localhost', [])
    forgetAnalyticsIdentity(j.env)
    expect(j.deleted).toEqual(['firebase-installations-database', 'firebase-heartbeat-database'])
  })

  it('does nothing outside a page', () => {
    expect(() => {
      forgetAnalyticsIdentity(null)
    }).not.toThrow()
  })
})

describe('turning analytics off in another tab (review 3, multitab-1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Storage as another tab left it. */
  function stored(entries: Record<string, string>) {
    vi.stubGlobal('window', {
      localStorage: { getItem: (key: string) => entries[key] ?? null },
    })
  }

  it('stops this tab’s loaded SDK and forgets its identity', () => {
    stored({ 'jojo/analytics/v1': 'off' })
    const apply = vi.fn()
    const forget = vi.fn()
    followAnalyticsSwitch('jojo/analytics/v1', apply, forget)
    expect(apply).toHaveBeenCalledWith(false)
    expect(forget).toHaveBeenCalledTimes(1)
  })

  it('turns it back on, and forgets nothing, when the other tab said yes', () => {
    stored({ 'jojo/analytics/v1': 'on' })
    const apply = vi.fn()
    const forget = vi.fn()
    followAnalyticsSwitch('jojo/analytics/v1', apply, forget)
    expect(apply).toHaveBeenCalledWith(true)
    expect(forget).not.toHaveBeenCalled()
  })

  it('treats storage being cleared as the answer going with it', () => {
    stored({})
    const apply = vi.fn()
    followAnalyticsSwitch(null, apply, () => {})
    expect(apply).toHaveBeenCalledWith(false)
  })

  it('ignores every other key', () => {
    stored({ 'jojo/analytics/v1': 'off' })
    const apply = vi.fn()
    followAnalyticsSwitch('jojo.theme', apply, () => {})
    expect(apply).not.toHaveBeenCalled()
  })

  it('is listening for the other tabs, and reaches only an SDK this tab already loaded', () => {
    const code = analyticsSource.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    expect(code).toMatch(
      /window\.addEventListener\('storage', \(event\) => \{\s*followAnalyticsSwitch\(event\.key\)/,
    )
    expect(code).toMatch(/if \(loaded\) void applyCollection\(on\)/)
  })
})
