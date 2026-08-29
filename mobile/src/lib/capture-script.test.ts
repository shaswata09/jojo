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

/**
 * The tokeniser, RUN rather than read.
 *
 * Everything above asks whether the script SAYS something. This lifts one
 * function out of the generated source and executes it, because the two things
 * it has to get right are decided by behaviour and not by shape: which CSS
 * spellings hide a fetch, and — the one that made it a leak — where the token it
 * mints is allowed to end up.
 *
 * `queueCssUrls` closes over `absolute`, `token` and `dropped`, so it is given
 * exactly those three and nothing else. No DOM is involved, which is why it can
 * run here at all.
 */
describe('the injected script’s CSS tokeniser, executed', () => {
  function liftQueueCssUrls() {
    const script = captureScript()
    const region = script.slice(
      script.indexOf('    function queueCssUrls('),
      script.indexOf('    function rulesOf('),
    )
    if (region === '' || !region.includes('function queueCssUrls(')) {
      throw new Error('queueCssUrls() is not where this test expects it in the injected script')
    }
    const assets: { href: string; kind: string }[] = []
    const absolute = (value: unknown) => {
      try {
        const url = new URL(String(value).trim(), 'https://board.test/jobs/1')
        return CAPTURE_SCHEMES.includes(url.protocol as (typeof CAPTURE_SCHEMES)[number])
          ? url.href
          : null
      } catch {
        return null
      }
    }
    const token = (href: string, kind: string) => {
      assets.push({ href, kind })
      return `__JOJO_ASSET_${String(assets.length - 1)}__`
    }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const run = new Function(
      'absolute',
      'token',
      `var dropped = 0; ${region}; return queueCssUrls`,
    )(absolute, token) as (css: string, inAttribute: boolean) => string
    return { run, assets }
  }

  it('drops an @import found in a style attribute rather than tokenising it', () => {
    /*
     * `lib/capture.ts` escapes a `css` token's value with `cssSafe`, which
     * escapes `<` ALONE — right while such a token sits inside a `<style>`
     * element and useless inside a quoted attribute value. This walk runs the
     * same rewrite over inline `style` attributes, and an `@import` there used
     * to become a `css` token like any other, so the fetched sheet was spliced
     * into the attribute. Measured on the web side with a sheet answering
     * `a{content:"x"}" onload="alert(1)" background="https://…`: the attribute
     * closed and an event handler went into the archive.
     *
     * Nothing is lost by dropping it — the CSS parser honours `@import` only at
     * the top of a style SHEET, so no browser ever fetched this one.
     */
    const { run, assets } = liftQueueCssUrls()
    expect(run('@import "https://evil.test/s.css";', true)).toBe('')
    expect(assets).toEqual([])
  })

  it('still tokenises the same @import inside a <style> element', () => {
    const { run, assets } = liftQueueCssUrls()
    expect(run('@import "https://cdn.test/s.css";', false)).toBe('__JOJO_ASSET_0__')
    expect(assets).toEqual([{ href: 'https://cdn.test/s.css', kind: 'css' }])
  })

  it('tokenises an image-set bare string, which matches no url() pattern', () => {
    // `image-set("https://cdn/x.png" 1x)` is a fetch with no `url(`, no
    // `@import` and no attribute name — invisible to every pattern in
    // `remoteRefCount`, so it reached a stored capture and the scan passed it.
    const { run, assets } = liftQueueCssUrls()
    expect(run('.a{background-image:image-set("https://cdn.test/x.png" 1x)}', false)).toBe(
      '.a{background-image:image-set(url("__JOJO_ASSET_0__") 1x)}',
    )
    expect(assets).toEqual([{ href: 'https://cdn.test/x.png', kind: 'css-asset' }])
  })

  it('tokenises the vendor-prefixed and single-quoted spelling too', () => {
    const { run, assets } = liftQueueCssUrls()
    expect(run(".a{background:-webkit-image-set('https://cdn.test/x.png' 1x)}", false)).toBe(
      '.a{background:-webkit-image-set(url("__JOJO_ASSET_0__") 1x)}',
    )
    expect(assets).toHaveLength(1)
  })

  it('leaves an image-set option that is a MIME type rather than an address', () => {
    const { run, assets } = liftQueueCssUrls()
    expect(
      run('.a{background:image-set("https://cdn.test/x.avif" type("image/avif"))}', false),
    ).toBe('.a{background:image-set(url("__JOJO_ASSET_0__") type("image/avif"))}')
    expect(assets).toEqual([{ href: 'https://cdn.test/x.avif', kind: 'css-asset' }])
  })

  it('leaves an already-inlined image-set alone', () => {
    const { run, assets } = liftQueueCssUrls()
    const css = '.a{background:image-set("data:image/png;base64,AAAA" 1x)}'
    expect(run(css, false)).toBe(css)
    expect(assets).toEqual([])
  })
})
