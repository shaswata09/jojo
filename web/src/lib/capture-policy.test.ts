import { describe, expect, it } from 'vitest'
import policySource from '../../extension/policy.js?raw'
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
