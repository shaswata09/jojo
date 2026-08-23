import { describe, expect, it } from 'vitest'
import {
  CAPTURE_HREF_ATTR,
  CAPTURE_LAZY_ATTRS,
  CAPTURE_SCHEMES,
  CAPTURE_STRIP_ATTRS,
  CAPTURE_STRIP_TAGS,
  CAPTURE_UNCLAMP_ATTR,
  CAPTURE_URL_ATTRS,
} from '@jojo/service/core/capture'
import { captureScript } from './capture-script'

/**
 * The one file in this repo TypeScript cannot see.
 *
 * `captureScript()` returns the phone's DOM walk as a STRING, because
 * `injectJavaScript` takes source text and the WebView is the only place it can
 * run. To the compiler it is a template literal, so a syntax error in it is not
 * a build failure — it is a runtime throw inside a WebView on a phone, which is
 * the least observable place in the codebase. It had no test at all, and it
 * shipped with two bugs a parse could not have caught and a read should have:
 * the live-tree walk placed after the removals that destroy the alignment it
 * depends on, and an `@import` rewrite undone by the next replace in its own
 * chain.
 *
 * So this checks three different things, and the first is the cheapest and the
 * most valuable: that the string is syntactically valid JavaScript at all.
 * `new Function` compiles without executing, which is exactly the question —
 * nothing here has a DOM to run against.
 */

describe('the injected capture script', () => {
  const script = captureScript()

  it('is syntactically valid JavaScript', () => {
    // The check no compiler performs. A stray backtick or an unescaped `${` in
    // the template reaches a phone otherwise.
    expect(() => new Function(script)).not.toThrow()
  })

  it('contains no backtick, which would end the template that holds it', () => {
    // Found the hard way. A backtick inside a comment in the injected source
    // terminates the TypeScript template literal it lives in, and the rest of
    // the script becomes TypeScript — which fails to compile in a way that
    // points at a line number far from the comment that caused it. Prose about
    // `href` is the natural thing to write and the exact thing that breaks it.
    expect(script).not.toContain('`')
  })

  it('is an IIFE that cannot leak a binding into the page', () => {
    expect(script.trimStart().startsWith('(function ()')).toBe(true)
    // `injectJavaScript` warns on iOS when the completion value is not
    // serialisable, which is what the trailing literal is for.
    expect(script.trimEnd().endsWith('true;')).toBe(true)
  })

  it('reports a failure rather than dying silently', () => {
    // Everything is inside one try/catch, because a throw in here leaves the
    // Save button spinning with nothing on screen to explain it.
    expect(script).toContain('jojo:capture-failed')
    expect(script).toContain("type: 'jojo:capture'")
  })

  /**
   * The phone's half of the policy-drift guard.
   *
   * `web/src/lib/capture-policy.test.ts` does this for the extension, which
   * transcribes the constants by hand. The phone interpolates them, so the
   * failure mode is different — not drift, but a constant that is exported,
   * passed in, and then never read. `CAPTURE_URL_ATTRS` was exactly that for a
   * while: destructured on web and ignored, with a hardcoded list used instead.
   */
  it('carries every policy constant it is given', () => {
    for (const tag of CAPTURE_STRIP_TAGS) expect(script).toContain(`"${tag}"`)
    for (const attr of CAPTURE_STRIP_ATTRS) expect(script).toContain(`"${attr}"`)
    for (const attr of CAPTURE_URL_ATTRS) expect(script).toContain(`"${attr}"`)
    for (const attr of CAPTURE_LAZY_ATTRS) expect(script).toContain(`"${attr}"`)
    for (const scheme of CAPTURE_SCHEMES) expect(script).toContain(`"${scheme}"`)
    expect(script).toContain(`"${CAPTURE_HREF_ATTR}"`)
    expect(script).toContain(`"${CAPTURE_UNCLAMP_ATTR}"`)
  })

  it('reads the interpolated lists rather than a hardcoded copy', () => {
    // The bug this pins: a walk that destructures the policy and then loops over
    // its own literal array. Both loops must name the interpolated constant.
    expect(script).toContain('URL_ATTRS.length')
    expect(script).toContain('LAZY_ATTRS.length')
    expect(script).toContain('STRIP_ATTRS.length')
    expect(script).toContain('STRIP_TAGS.length')
  })

  /**
   * Ordering, which is the bug that cost the phone every clamp and every
   * CSSOM-only stylesheet.
   *
   * The live tree can only be walked in step with the clone while the two have
   * the same elements — that is, BEFORE the pass that deletes `<script>` and
   * friends from the clone. Asserted as source order because there is no DOM
   * here to observe the consequence in.
   */
  it('walks the live tree before anything is removed from the clone', () => {
    const alignment = script.indexOf('cloned0.length === living0.length')
    const removals = script.indexOf('STRIP_TAGS[t]')
    expect(alignment).toBeGreaterThan(-1)
    expect(removals).toBeGreaterThan(-1)
    expect(alignment).toBeLessThan(removals)
  })

  it('guards its own tokens from the second replace in the chain', () => {
    // `@import "https://…"` is rewritten to `url("__JOJO_ASSET_n__")`, and the
    // very next `.replace` matched that token, could not resolve it, and wrote
    // `none` — undoing the fix and miscounting a drop.
    expect(script).toContain("value.indexOf('__JOJO_ASSET_') === 0")
  })

  it('leaves a same-document SVG reference alone', () => {
    expect(script).toContain("value.charAt(0) === '#'")
  })

  it('strips the attributes a leak scan cannot see', () => {
    // Both are invisible to `remoteRefCount`: an inline style holds its URL in a
    // value, and `xlink:href` has a colon where the pattern needs whitespace.
    expect(script).toContain("el.hasAttribute('xlink:href')")
    expect(script).toContain("el.getAttribute('style')")
  })

  it('recovers the stylesheets that have no text', () => {
    // emotion and styled-components in production insert rules through the
    // CSSOM and leave `textContent` empty — which is most of Workday.
    expect(script).toContain('adoptedStyleSheets')
    expect(script).toContain('rulesOf(')
  })
})
