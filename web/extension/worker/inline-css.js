/**
 * The CSS half of inlining: reading a fetched stylesheet's addresses as the CSS
 * parser reads them, tokenising them for the asset loop, and escaping the text
 * so it cannot leave the `<style>` it is spliced into.
 */

import { CAPTURE_SCHEMES } from '../policy.js'

/**
 * Fetched stylesheet text, made unable to close the element it is spliced into.
 *
 * See the call site. `<` is the only character that can end a `<style>` block,
 * and `\3c ` is its CSS escape — the trailing space is part of the escape and
 * is consumed by the CSS parser, so a rule that genuinely contained `<` renders
 * identically.
 *
 * `<` ALONE is enough only while a `css` token is always inside a `<style>`
 * element, and that is now a rule with a keeper rather than an assumption:
 * `serialise.js` drops an `@import` found in a style ATTRIBUTE instead of
 * tokenising it, which was the one path that put stylesheet text inside a
 * quoted attribute value. Measured while it did: a sheet answering
 * `a{content:"x"}" onload="alert(1)" background="https://…` closed the
 * attribute and wrote a handler and a live address into the archive, because
 * neither `"` nor `'` is escaped here. Widening the escape instead would have
 * mangled `[type="text"]` in every real stylesheet, so the invariant is held at
 * the source. If a third tokenisation path is ever added, it belongs in a
 * `<style>` or it does not get a `css` kind.
 */
export const cssSafe = (css) => css.replace(/</g, '\\3c ')

/** A CSS string's escapes decoded, so the URL resolved is the URL the parser reads. */
function cssUnescape(text) {
  return text
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\r\n\f]?/g, (_w, hex) => {
      const code = parseInt(hex, 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�'
    })
    .replace(/\\\r\n|\\[\n\r\f]/g, '')
    .replace(/\\([\s\S])/g, '$1')
}

/**
 * A quoted CSS string, `"…"` or `'…'`, with its escapes — and so with the OTHER
 * quote and a `)` allowed inside it. The tokenisers used `([^'")]+)`, which
 * stopped at the first `)` or quote of either kind: `url("https://x/a)b.png")`
 * failed to match at all, was never tokenised, and loaded on view.
 */
const CSS_DQ = String.raw`"((?:[^"\\\n]|\\[\s\S])*)"`
const CSS_SQ = String.raw`'((?:[^'\\\n]|\\[\s\S])*)'`
const CSS_URL = new RegExp(String.raw`url\(\s*(?:${CSS_DQ}|${CSS_SQ}|((?:[^'"()\\\s]|\\[\s\S])*))\s*\)`, 'gi')
const CSS_IMPORT = new RegExp(
  String.raw`@import\s*(?:url\(\s*(?:${CSS_DQ}|${CSS_SQ}|((?:[^'"()\\\s]|\\[\s\S])*))\s*\)|${CSS_DQ}|${CSS_SQ})[^;]*;?`,
  'gi',
)
const CSS_IMAGE_SET = new RegExp(
  String.raw`(image-set\()((?:[^()"']|"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'|\([^()]*\))*)\)`,
  'gi',
)
const CSS_IMAGE_SET_PIECE = new RegExp(String.raw`\([^()]*\)|${CSS_DQ}|${CSS_SQ}`, 'gi')

function absolute(value, base) {
  try {
    const url = new URL(value, base)
    return CAPTURE_SCHEMES.includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

/**
 * A fetched stylesheet's own `@import`s, `url()`s and `image-set()` strings, tokenised.
 *
 * `sheets` is the capture's side of it: `prefix`, this capture's token prefix;
 * `queue(href, kind)`, which appends a nested address to the list `inline` is
 * walking and returns its token; and `drop()`, which counts an address that
 * could not be resolved.
 */
export function rewriteSheet(text, href, { prefix, queue, drop }) {
  /*
   * Its own `@import`s FIRST, then its own `url()`s. Both become tokens
   * appended to the list this loop is walking, so they are fetched by a
   * later turn of it and one pass covers arbitrary nesting.
   *
   * The `@import` half was missing, and it was a live leak rather than a
   * missing nicety: the walk sanitises the imports it can see in the
   * page's own `<style>` blocks, but a stylesheet FETCHED here could carry
   * its own `@import "https://…"`, which passed through untouched, passed
   * `remoteRefCount` — which knew nothing about `@import` — and was
   * fetched by the viewer every time the capture was opened.
   */
  const withImports = text.replace(CSS_IMPORT, (whole, u1, u2, u3, s1, s2) => {
    const raw = cssUnescape(u1 ?? u2 ?? u3 ?? s1 ?? s2 ?? '')
    if (raw.trim().startsWith('data:')) return whole
    const nested = absolute(raw.trim(), href)
    if (nested === null) {
      drop()
      return ''
    }
    return queue(nested, 'css')
  })
  const inlinedCss = withImports.replace(CSS_URL, (whole, dq, sq, bare) => {
    const value = cssUnescape(dq ?? sq ?? bare ?? '').trim()
    if (value.startsWith(prefix)) return whole
    if (value.startsWith('data:')) return whole
    // A same-document reference — `filter='url(#frameNoise)'` inside an
    // inline SVG. Resolving one produces a URL that never existed, which
    // is then fetched (404/403), counted as a dropped asset, and written
    // back as `url("")` — corrupting a data URI the pipeline had already
    // decided to keep. Measured on every Ashby posting.
    if (value.startsWith('#') || value.startsWith('%23')) return whole
    const nested = absolute(value, href)
    if (nested === null) {
      drop()
      return 'none'
    }
    return `url("${queue(nested, 'css-asset')}")`
  })
  /*
   * `image-set()`, whose URL can be a BARE STRING.
   *
   * `image-set("https://cdn/x.png" 1x)` is a fetch with no `url(`, no
   * `@import` and no attribute name, so the two rewrites above walk past
   * it and all three patterns in `remoteRefCount` were blind to it.
   * Measured before this ran: the address reached the stored capture
   * untouched, the scan returned 0, and `readCapture` accepted the file.
   * `serialise.js` tokenises the same shape in the page's own CSS; this is
   * the half that covers a stylesheet fetched from the network.
   *
   * Runs after the `url()` pass, so a `url()` inside an image-set is
   * already a token. The inner replace consumes a parenthesised group
   * whole, which keeps it off that token and off `type("image/avif")` —
   * an image-set option whose string is a MIME type, not an address.
   *
   * Anchored on the literal `image-set(` rather than on a pattern that
   * absorbs the vendor prefix: a leading `[a-z-]*` rescans to the end of
   * every run of letters at every offset, and a 2 MB stylesheet made this
   * quadratic — measured as a test run that never finished. The prefix
   * stays outside the match, so `-webkit-image-set` is still rewritten.
   */
  return inlinedCss.replace(CSS_IMAGE_SET, (_whole, head, body) => {
    const rewritten = body.replace(CSS_IMAGE_SET_PIECE, (piece, dq, sq) => {
      if (dq === undefined && sq === undefined) return piece
      const value = cssUnescape(dq ?? sq).trim()
      if (value === '' || value.startsWith(prefix)) return piece
      if (value.startsWith('data:')) return piece
      const nested = absolute(value, href)
      if (nested === null) {
        drop()
        // `url("")` rather than `none`: an image-set option has to be
        // a URL, and `none` there invalidates the declaration.
        return 'url("")'
      }
      return `url("${queue(nested, 'css-asset')}")`
    })
    return `${head}${rewritten})`
  })
}
