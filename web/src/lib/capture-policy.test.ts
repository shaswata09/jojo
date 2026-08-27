import { describe, expect, it } from 'vitest'
import policySource from '../../extension/policy.js?raw'
import backgroundSource from '../../extension/background.js?raw'
import { PROVIDERS } from '@jojo/service/core/provider'
import {
  CAPTURE_HREF_ATTR,
  CAPTURE_LAZY_ATTRS,
  CAPTURE_MAX_ASSET_BYTES,
  CAPTURE_MAX_BYTES,
  CAPTURE_SCHEMES,
  CAPTURE_STRIP_ATTRS,
  CAPTURE_STRIP_TAGS,
  CAPTURE_UNCLAMP_ATTR,
  CAPTURE_URL_ATTRS,
} from '@jojo/service/core/capture'

/**
 * The extension's copy of the capture policy has not drifted.
 *
 * `web/extension/policy.js` is a hand transcription of constants that live in
 * `service/kg/core/capture.ts`, and it exists because the extension is loaded
 * from disk by the browser rather than built by Vite — it cannot import from the
 * package, and putting a build step in front of it would put a compile between
 * editing the extension and reloading it.
 *
 * A transcription with no check is the `buildMonth` drift waiting to happen:
 * somebody adds a tag to the strip list, the package's tests stay green, and
 * every capture taken from then on keeps an element the viewer was promised
 * would never reach it. Silent, and only visible in a saved page nobody reads
 * again for a year.
 *
 * Read as SOURCE TEXT rather than imported, deliberately. Importing the module
 * would need `allowJs` and a tsconfig that reaches outside `src`, and it would
 * check that the file parses rather than that it says the same thing. This
 * compares the literals, which is the claim being made.
 */

/** Pulls `export const NAME = [ … ]` out of the source as a real array. */
function arrayLiteral(name: string): string[] {
  const match = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`).exec(policySource)
  if (match === null) throw new Error(`${name} is not exported from extension/policy.js`)
  return [...match[1]!.matchAll(/'([^']*)'/g)].map((m) => m[1]!)
}

/** Pulls a scalar `export const NAME = <value>` line. */
function scalarLiteral(name: string): string {
  const match = new RegExp(`export const ${name} = (.+)`).exec(policySource)
  if (match === null) throw new Error(`${name} is not exported from extension/policy.js`)
  return match[1]!.trim().replace(/^'|'$/g, '')
}

describe('the extension carries the same capture policy as the package', () => {
  it.each([
    ['CAPTURE_STRIP_TAGS', CAPTURE_STRIP_TAGS],
    ['CAPTURE_STRIP_ATTRS', CAPTURE_STRIP_ATTRS],
    ['CAPTURE_URL_ATTRS', CAPTURE_URL_ATTRS],
    ['CAPTURE_SCHEMES', CAPTURE_SCHEMES],
    ['CAPTURE_LAZY_ATTRS', CAPTURE_LAZY_ATTRS],
  ])('%s matches, in the same order', (name, expected) => {
    // Order as well as membership: the strip loop walks the list, and `link`
    // running before `meta` is what lets the stylesheet branch replace a node
    // the meta branch would otherwise have already removed.
    expect(arrayLiteral(name)).toEqual([...expected])
  })

  it('names the same attribute for a rewritten anchor', () => {
    // The one both serialisers write and `remoteRefCount` is built around. A
    // mismatch here means every captured link reads as a leak and every capture
    // is refused — loud, but only at the moment somebody tries to save a page.
    expect(scalarLiteral('CAPTURE_HREF_ATTR')).toBe(CAPTURE_HREF_ATTR)
  })

  it('names the same attribute for an un-clamped element', () => {
    // Both halves have to agree or the rule the serialiser appends selects
    // nothing, and every captured posting silently keeps its "See more" clamp.
    expect(scalarLiteral('CAPTURE_UNCLAMP_ATTR')).toBe(CAPTURE_UNCLAMP_ATTR)
  })

  it('caps at the same size', () => {
    // Evaluated rather than string-compared, so `8 * 1024 * 1024` and
    // `8388608` are allowed to be spelled differently and still agree.
    const evaluate = (expr: string) => Number(new Function(`return ${expr}`)())
    expect(evaluate(scalarLiteral('CAPTURE_MAX_BYTES'))).toBe(CAPTURE_MAX_BYTES)
    expect(evaluate(scalarLiteral('CAPTURE_MAX_ASSET_BYTES'))).toBe(CAPTURE_MAX_ASSET_BYTES)
  })

  it('is reading a real file and real constants', () => {
    // Guards the guard. If the glob resolved to nothing or the regex stopped
    // matching, every assertion above would pass by comparing nothing.
    expect(policySource).toContain('CAPTURE_STRIP_TAGS')
    expect(CAPTURE_STRIP_TAGS.length).toBeGreaterThan(5)
    expect(() => arrayLiteral('CAPTURE_NOT_A_REAL_LIST')).toThrow()
  })
})


describe("the extension's model-host list matches the provider table", () => {
  /*
   * The same bargain as every other list in `policy.js`: the extension cannot
   * import from `@jojo/service`, so the hosts are transcribed — and the
   * transcription is checked, so the rule still has one owner.
   *
   * It matters more than the capture lists because this one is a security
   * boundary. The worker relays a page-composed request under its own
   * `https://*` permission, and the list is what stops that being an open proxy.
   * A host that drifts OUT silently breaks a provider; one that drifts IN
   * silently widens what the extension can be asked to fetch.
   */
  it('names exactly the cloud providers jojo knows about', () => {
    const transcribed = arrayLiteral('MODEL_HOSTS')
    const fromTable = PROVIDERS.filter((p) => p.cloud).map((p) => new URL(p.endpoint).hostname)
    expect([...transcribed].sort()).toEqual([...new Set(fromTable)].sort())
  })

  it('lists no local provider, which loopback allows instead', () => {
    const transcribed = arrayLiteral('MODEL_HOSTS')
    expect(transcribed).not.toContain('localhost')
    expect(transcribed).not.toContain('127.0.0.1')
  })
})

/**
 * The relay's address rule, read out of the extension source.
 *
 * The page and the extension have to agree about which addresses are relayable.
 * They did not: the page's error text said "install the jojo extension, which
 * relays that one hop for you" while `background.js` allowed loopback and five
 * hosted providers, so somebody with a model server on their own network
 * installed an extension that then refused the address it was installed for.
 *
 * Read from source because the extension is plain JS in no tsconfig — the same
 * technique `reader-relay.test.ts` uses.
 */
describe('which model addresses the extension will relay', () => {
  const source = backgroundSource.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

  it('relays private-network addresses as well as loopback and known providers', () => {
    const guard = source.slice(source.indexOf('async function modelRefusal'))
    expect(guard).toContain('isPrivateNetwork(url)')
    expect(guard).toContain('isLoopback(url)')
    expect(guard).toContain('isKnownModelHost(url)')
  })

  it('accepts only ranges that are unroutable on the public internet', () => {
    const fn = source.slice(source.indexOf('function isPrivateNetwork'))
    // RFC 1918, RFC 3927 link-local, and mDNS. A public http address relayed
    // would make this a way for any page to launder a request through the
    // user's browser.
    for (const marker of ['=== 10', '=== 172', '=== 192', '=== 169', ".local'"]) {
      expect(fn).toContain(marker)
    }
    expect(fn).toContain("protocol !== 'http:'")
  })
})
