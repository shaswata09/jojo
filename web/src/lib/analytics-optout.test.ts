/**
 * Turning analytics off forgets this browser's analytics identity.
 *
 * Before, the switch stopped new reports and left the GA client id cookie and
 * Firebase's installation id behind — the id earlier reports were filed under.
 */

import { describe, expect, it } from 'vitest'
import { forgetAnalyticsIdentity } from './analytics'

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
