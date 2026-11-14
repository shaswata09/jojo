/**
 * The last three steps of `inline`, on the document string: every value spliced
 * over its token, this capture's stray tokens removed, and any remote address
 * left in a tag emptied.
 */

import { cssSafe } from './inline-css.js'

/** Every resolved value spliced over its token. */
export function spliceTokens(html, resolved, cssKeys, keyOf) {
  /*
   * In INDEX order, which is the order the tokens were minted. A stylesheet's
   * nested tokens are only in the document once that stylesheet's text has been
   * spliced, and a nested token always has a higher index than its sheet — so
   * splicing by index can never look for a token before it exists, however the
   * fetches finished.
   */
  for (let i = 0; i < resolved.length; i += 1) {
    const value = resolved[i]
    if (value === undefined) continue
    /*
     * Stylesheet text is spliced into the document, so it must not be able to
     * LEAVE the element it is spliced into.
     *
     * The token for a `<link rel=stylesheet>` sits inside a `<style>` block, and
     * the value is whatever the remote server returned. A sheet ending
     * `}</style><img src=https://evil.example/beacon.png>` closes the block and
     * writes a live tag into the archive — and it was written unquoted
     * precisely because neither the sweep below nor `remoteRefCount` could see
     * that shape. Both know it now; this stops the splice creating the tag at
     * all, which is the half that does not depend on a pattern being complete.
     *
     * Only `<` needs escaping to keep CSS inside `<style>`: a stylesheet has no
     * legitimate `<`, and the HTML tokeniser leaves a `<style>` block only on a
     * literal `</`. Escaping it as `\3c ` — the CSS hex escape, trailing space
     * included — keeps any (pathological) legitimate use rendering the same.
     */
    html = html.split(keyOf(i)).join(cssKeys.has(i) ? cssSafe(value) : value)
  }
  return html
}

/** This capture's tokens that nothing resolved, removed. */
export function dropStrayTokens(html, prefix) {
  // Anything the walk missed. A token left standing would render as literal
  // text, and a surviving http(s) address would be the one thing this must not
  // ship — so both are swept here rather than hoped about. THIS capture's
  // tokens only: see `captureNonce` for why a page's look-alikes stay.
  return html.split(prefix).map((part, n) => (n === 0 ? part : part.replace(/^\d+__/, ''))).join('')
}

/**
 * Any remote address still in a tag, emptied; hands back the document and how
 * many addresses were emptied, which count as dropped.
 */
export function sweepRemoteRefs(html) {
  let dropped = 0
  // Anchored to `<[^>]*?`, so it can only match INSIDE a tag.
  //
  // Without that anchor this ran over the whole document string including text
  // nodes — and `outerHTML` does not escape `"` in text — so a posting whose
  // body reads `add <img src="https://…">` had its own prose rewritten to
  // `src=""` and counted as a dropped asset. `serialise.js` explains at length
  // that assets are tokenised precisely so a global string replace can never
  // corrupt a posting that quotes a URL; this is the line that was doing it.
  //
  // The value may be UNQUOTED. HTML does not require quotes and browsers honour
  // `src=https://…`, so a sweep that demanded them left the one shape
  // `remoteRefCount` was also blind to — a capture that beaconed on every
  // viewing while both checks reported it clean. The two widen together: a scan
  // stricter than the sweep refuses captures with no remedy.
  //
  // And the anchor consumes QUOTED RUNS rather than stopping at the first `>`.
  // A `>` inside an attribute value is legal and unescaped — the HTML serialiser
  // escapes `&`, nbsp and `"` in a value and leaves `>` alone — so `<[^>]*?`
  // made one earlier attribute enough to hide every attribute after it.
  // Measured: `<img src=https://evil.example/b.png>` was emptied,
  // `<img alt="a > b" src=https://evil.example/b.png>` was not, and
  // `remoteRefCount` (blind in the same way, from the same spelling) then passed
  // the file. `<` must be followed by an ASCII letter because that is exactly
  // when the tokeniser starts a tag. Identical to `REMOTE_REF` in
  // `service/kg/core/capture.ts` — a third copy lives in
  // `mobile/src/lib/capture.ts`, and the three change together.
  //
  // The scheme is matched as loosely as the URL parser reads it — a tab or
  // newline inside it, leading control characters, backslashes for slashes —
  // and `xlink:href` is on the list, because `remoteRefCount` now counts all of
  // those and a scan stricter than this sweep refuses a capture with no remedy.
  // A quoted value is consumed to ITS OWN closing quote, so the other quote
  // inside it no longer stops the match short.
  html = html.replace(
    // The C0 range is deliberate: it is what the URL parser trims.
    // eslint-disable-next-line no-control-regex
    /(<[a-zA-Z](?:[^>"']|"[^"]*"|'[^']*')*?\s(?:xlink:)?(?:src|srcset|imagesrcset|href|poster|data|action|formaction|background)\s*=\s*)(?:"[\x00-\x20]*(?:h[\t\n\r]*t[\t\n\r]*t[\t\n\r]*p[\t\n\r]*(?:s[\t\n\r]*)?:|[\\/][\t\n\r]*[\\/])[^"]*"|'[\x00-\x20]*(?:h[\t\n\r]*t[\t\n\r]*t[\t\n\r]*p[\t\n\r]*(?:s[\t\n\r]*)?:|[\\/][\t\n\r]*[\\/])[^']*'|(?:https?:|[\\/]{2})[^\s>]*)/gi,
    (_whole, head) => {
      dropped += 1
      // Emptied by writing a quoted empty value, which is valid HTML whatever
      // the original quoting and cannot be re-read as a URL.
      return `${head}""`
    },
  )

  return { html, dropped }
}
