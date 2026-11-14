/**
 * The DOM walk, as it runs inside the posting's own tab.
 *
 * This is one of the two serialisers in the repo — the other is the phone's,
 * `mobile/src/lib/capture-script.ts`, built from the same constants — and it is
 * the reason the rules live in `core/capture.ts` rather than in either of them.
 * Read that file first: everything here is the mechanical half of what it
 * decides.
 *
 * ## Why it is one self-contained function
 *
 * It is injected with `chrome.scripting.executeScript({ func })`, which
 * stringifies the function and evaluates it in the page. Nothing it closes over
 * survives that trip, so it takes no imports and reaches no module scope — the
 * policy arrives through `args` instead, which is what keeps `policy.js` the
 * single spelling rather than a thing this file re-lists.
 *
 * ## Why it does not fetch
 *
 * A content script's `fetch` carries the PAGE's origin, so pulling a stylesheet
 * off the site's CDN is the same cross-origin request the web app cannot make
 * either — blocked, and blocked silently enough that a capture would come back
 * unstyled with no error to show for it. So this collects the addresses and
 * hands them back; `background.js` does the fetching, where the extension's host
 * permissions make it legal.
 *
 * Assets are replaced with a token rather than substituted by URL later, because
 * the same URL appears in a document more than once, sometimes escaped
 * differently each time, and a global string replace over user-supplied markup
 * is how a serialiser corrupts the body text of a posting that quotes a URL.
 *
 * ## The clone and the live tree are walked in step
 *
 * Several rules can only be decided from the RENDERED page: whether a paragraph
 * is clamped, whether an image below the fold ever got a `src`. Those are
 * computed-style and layout questions, and a detached clone has neither. So the
 * walk holds both trees and indexes them together — the copy is made in the
 * same tick, so `documentElement.querySelectorAll('*')` and the copy's are
 * element-for-element aligned. The live page is never mutated.
 *
 * ## The copy lives in an INERT document
 *
 * It was `document.documentElement.cloneNode(true)`, and that runs the PAGE's
 * code. A clone made in the live document is upgraded by the page's custom
 * element registry: constructors run on it, and `attributeChangedCallback`
 * fires on every attribute this walk later writes — in the page's own world,
 * with a reference to the clone. Reproduced: an element watching `style` read
 * this capture's nonce off the first token written into it, and a second one
 * waited for the strip passes to finish, then prepended
 * `<meta http-equiv=refresh>` and a `<link rel=preconnect>` to the clone's
 * head and appended a forged token. The saved file navigated on open.
 *
 * `importNode` into a document from `createHTMLDocument` makes the same copy —
 * same tree, same order, so the alignment above still holds — in a document
 * with no browsing context, and a document with none has no custom element
 * definitions to look up: nothing is constructed, nothing is called back, and
 * every pass below works on markup the page can no longer touch.
 */

export function serialise(policy, nonce) {
  const {
    CAPTURE_STRIP_TAGS,
    CAPTURE_STRIP_ATTRS,
    CAPTURE_URL_ATTRS,
    CAPTURE_HREF_ATTR,
    CAPTURE_SCHEMES,
    CAPTURE_LAZY_ATTRS,
    CAPTURE_UNCLAMP_ATTR,
  } = policy

  /*
   * Every token this capture mints carries the worker's per-capture nonce. A
   * constant prefix was a token the PAGE could write too — see `captureNonce`
   * in `background.js` for what that let a page put into the saved file. No
   * nonce, no capture: a token anybody can forge is worse than none.
   */
  if (typeof nonce !== 'string' || !/^[0-9a-f]{16,}$/.test(nonce)) {
    throw new Error('The capture was started without a token nonce.')
  }
  const TOKEN = `__JOJO_ASSET_${nonce}_`

  // See "The copy lives in an INERT document" above. Every element this walk
  // creates is created by `inert` too, for the same reason.
  const inert = document.implementation.createHTMLDocument('')
  const doc = inert.importNode(document.documentElement, true)
  inert.replaceChild(doc, inert.documentElement)
  const assets = []
  let dropped = 0
  let shadowRoots = 0

  /** Absolute, or null when it is not a fetchable address at all. */
  const absolute = (value, base) => {
    if (typeof value !== 'string' || value.trim() === '') return null
    try {
      const url = new URL(value, base || document.baseURI)
      return CAPTURE_SCHEMES.includes(url.protocol) ? url.href : null
    } catch {
      return null
    }
  }

  /** Queues one asset and returns the token that stands in for it. */
  const token = (href, kind) => {
    const index = assets.length
    assets.push({ href, kind })
    return `${TOKEN}${String(index)}__`
  }

  // ---- the CSS tokeniser ----------------------------------------------------

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

  /*
   * A quoted CSS string with its escapes — so the OTHER quote and a `)` may sit
   * inside it. The patterns used `([^'")]+)`, which stopped at the first `)` or
   * quote of either kind: `url("https://x/a)b.png")` did not match at all, was
   * never tokenised, and loaded on view. The CSSOM writes exactly these escapes
   * (`url("a\"b")`) when it round-trips a sheet, so the tokeniser has to read
   * them.
   */
  const DQ = String.raw`"((?:[^"\\\n]|\\[\s\S])*)"`
  const SQ = String.raw`'((?:[^'\\\n]|\\[\s\S])*)'`
  const BARE = String.raw`((?:[^'"()\\\s]|\\[\s\S])*)`
  const CSS_IMPORT = new RegExp(String.raw`@import\s*(?:url\(\s*(?:${DQ}|${SQ}|${BARE})\s*\)|${DQ}|${SQ})[^;]*;?`, 'gi')
  const CSS_URL = new RegExp(String.raw`url\(\s*(?:${DQ}|${SQ}|${BARE})\s*\)`, 'gi')
  const CSS_IMAGE_SET = new RegExp(
    String.raw`(image-set\()((?:[^()"']|"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'|\([^()]*\))*)\)`,
    'gi',
  )
  const CSS_IMAGE_SET_PIECE = new RegExp(String.raw`\([^()]*\)|${DQ}|${SQ}`, 'gi')

  /**
   * Replaces every remote reference in a CSS string with a token.
   *
   * Three spellings, because CSS has three. `url(...)` is the common one; a bare
   * `@import "https://…";` is legal and matches no `url(` pattern at all — it
   * shipped live until this handled it, and the viewer fetched it; and
   * `image-set()` takes a bare STRING, which is neither.
   *
   * `inAttribute` says whether the result is going into a `style` ATTRIBUTE
   * rather than a `<style>` element, and it is not a nicety — see the `@import`
   * arm.
   *
   * Callers hand this CSS the CSSOM has already re-serialised (`normalisedSheet`
   * and `normalisedStyle` below), which is what makes a pattern match enough:
   * `u\72 l(…)` and `@\69mport` are `url(` and `@import` to the CSS parser and
   * were invisible to every pattern here, and the CSSOM writes them back out in
   * plain letters.
   */
  function queueCssUrls(css, inAttribute) {
    return css
      /*
       * An `@import` is replaced by the STYLESHEET, not by a link to it.
       *
       * The whole statement goes and a bare token takes its place, because that
       * is what `@import` means — "insert this sheet here" — and because the
       * alternative was measurably wrong: rewriting it to `url("<token>")` made
       * the inliner substitute the fetched CSS TEXT inside a `url()`, producing
       * `@import url("<the entire stylesheet>")` and losing the sheet entirely.
       *
       * Both spellings are matched here rather than leaving `@import url(…)` to
       * the pattern below, which marks its token `css-asset` — a kind the
       * inliner fetches as a BLOB. An imported sheet base64'd that way loses
       * every font and image its own `url()`s point at.
       */
      .replace(CSS_IMPORT, (whole, u1, u2, u3, s1, s2) => {
        /*
         * An `@import` in a style ATTRIBUTE is not a stylesheet: the CSS
         * parser honours `@import` only at the top of a style SHEET, so no
         * browser ever fetched this one and dropping it loses nothing — hence
         * no `dropped += 1` either, since nothing was there to keep.
         *
         * It is dropped rather than tokenised because of where the token would
         * land. `background.js` splices a `css` token's value — whatever the
         * remote server returned — into the document as text, and escapes it
         * with `cssSafe`, which escapes `<` ALONE on the stated assumption
         * that a `css` token always sits inside a `<style>` element. This was
         * the one path that broke that assumption, and the escape is useless
         * inside a quoted attribute value: measured end to end, a sheet
         * answering `a{content:"x"}" onload="alert(1)" background="https://…`
         * closed the `style` attribute and wrote both an event handler and a
         * live address into the stored capture. Keeping the assumption TRUE is
         * cheaper and more honest than widening the escape, which would have
         * had to mangle `"` and `'` in every legitimate stylesheet.
         */
        if (inAttribute === true) return ''
        const raw = cssUnescape(u1 ?? u2 ?? u3 ?? s1 ?? s2 ?? '').trim()
        if (raw.startsWith('data:')) return whole
        const href = absolute(raw)
        if (href === null) {
          dropped += 1
          return ''
        }
        return token(href, 'css')
      })
      .replace(CSS_URL, (whole, dq, sq, bare) => {
        const value = cssUnescape(dq ?? sq ?? bare ?? '').trim()
        // A token this same chain just produced. Without this the pattern
        // matched one, failed to resolve it, and replaced it with `none` — so a
        // stylesheet was silently dropped AND miscounted. Two replaces in one
        // chain is exactly the shape where a rewrite gets rewritten.
        if (value.startsWith(TOKEN)) return whole
        if (value.startsWith('data:')) return whole
        // A same-document reference — `filter='url(#frameNoise)'` inside inline
        // SVG. Resolving one invents a URL that never existed, which is then
        // fetched, counted as dropped, and written back as `url("")` —
        // corrupting a data URI already decided upon.
        if (value.startsWith('#') || value.startsWith('%23')) return whole
        const href = absolute(value)
        if (href === null) {
          dropped += 1
          return 'none'
        }
        return `url("${token(href, 'css-asset')}")`
      })
      /*
       * `image-set()`, whose URL can be a BARE STRING and is then invisible to
       * every other pattern in this file and in `remoteRefCount`.
       *
       * `image-set("https://cdn/x.png" 1x, "https://cdn/x@2x.png" 2x)` is a
       * fetch with no `url(`, no `@import` and no attribute name. Measured
       * before this ran: the capture stored the address untouched, the scan
       * returned 0, and `readCapture` accepted it — a beacon on every viewing,
       * with every check reporting the file clean.
       *
       * Runs AFTER the `url()` pass so that a `url()` inside an image-set is
       * already a token by the time this sees it. The inner replace consumes a
       * parenthesised group whole, which is what keeps it off both that token and
       * `type("image/avif")` — an image-set option whose string is a MIME type
       * rather than an address, and which this would otherwise have fetched.
       *
       * Anchored on the literal `image-set(` rather than on a pattern that
       * absorbs the vendor prefix: a leading `[a-z-]*` rescans to the end of
       * every run of letters at every offset, and a 2 MB stylesheet made this
       * quadratic — measured as a test run that never finished. The prefix
       * simply stays outside the match, which leaves `-webkit-image-set`
       * rewritten correctly and untouched.
       */
      .replace(CSS_IMAGE_SET, (_whole, head, body) => {
        const rewritten = body.replace(CSS_IMAGE_SET_PIECE, (piece, dq, sq) => {
          if (dq === undefined && sq === undefined) return piece
          const value = cssUnescape(dq ?? sq).trim()
          if (value === '' || value.startsWith(TOKEN)) return piece
          if (value.startsWith('data:')) return piece
          const href = absolute(value)
          if (href === null) {
            dropped += 1
            // `url("")` rather than `none`: an image-set option has to be a
            // URL, and `none` there invalidates the whole declaration.
            return 'url("")'
          }
          return `url("${token(href, 'css-asset')}")`
        })
        return `${head}${rewritten})`
      })
  }

  // ---- 0. everything that needs the LIVE tree, before anything is removed ---
  //
  // Ordering, and it is load-bearing. Step 1 below deletes elements from the
  // clone, after which the two trees no longer line up and no computed-style
  // question can be answered at all. So the rendered-page facts are collected
  // first, while the fresh copy still guarantees element-for-element
  // alignment, and stashed on the clone for the later passes to read.
  const RESOLVED = 'data-jojo-resolved-src'
  /** The clone's <style> elements already written back from the live CSSOM. */
  const normalised = new WeakSet()
  {
    const cloned = [...doc.querySelectorAll('*')]
    const living = [...document.documentElement.querySelectorAll('*')]
    if (cloned.length === living.length) {
      for (let i = 0; i < cloned.length; i += 1) {
        const node = cloned[i]
        const live = living[i]

        // The value records WHICH kind of hiding was found, because the two
        // want different repairs.
        const clamp = clampKind(live)
        if (clamp !== null) node.setAttribute(CAPTURE_UNCLAMP_ATTR, clamp)

        // A shadow root's contents cannot be reached: `importNode` does not copy
        // one and `outerHTML` never serialises one. Counted rather than ignored,
        // so "part of this page is missing" is a number the user sees.
        if (live.shadowRoot !== null) shadowRoots += 1

        // The browser's own answer, which accounts for `srcset` — stripped a few
        // passes below, and without this a `<picture>` would lose its source.
        if (node.tagName === 'IMG' && live.currentSrc) {
          node.setAttribute(RESOLVED, live.currentSrc)
        }

        // A <style> whose rules were inserted through the CSSOM has an EMPTY
        // textContent — emotion and styled-components in production do exactly
        // this. Reading only textContent captured Workday's markup with almost
        // none of its styling.
        //
        // And EVERY <style> is now written back from its CSSOM rules, not only
        // the empty ones: the CSSOM decodes CSS escapes and writes `url(`,
        // `@import` and the URL itself in plain letters, so `u\72 l(https://…)`
        // or `@\69mport "…"` — which the browser honours and no pattern below
        // could read — reaches the tokeniser as the fetch it is.
        if (node.tagName === 'STYLE' && live.sheet) {
          node.textContent = rulesOf(live.sheet)
          normalised.add(node)
        }
      }
    }
  }

  // ---- 1. elements that never survive --------------------------------------
  //
  // Done first and on the clone, so the walks below never see a <script>'s text
  // or a <link>'s href and never have to decide about them.
  for (const tag of CAPTURE_STRIP_TAGS) {
    for (const node of [...doc.querySelectorAll(tag)]) {
      if (tag === 'link') {
        const rel = (node.getAttribute('rel') ?? '').toLowerCase()
        const href = absolute(node.getAttribute('href'))
        if (rel.includes('stylesheet') && href !== null) {
          const style = inert.createElement('style')
          style.textContent = token(href, 'css')
          node.replaceWith(style)
          continue
        }
      }
      // <meta> carries charset and viewport, which a capture wants to keep, and
      // http-equiv refresh, which would navigate the archive away from itself.
      if (tag === 'meta') {
        const equiv = (node.getAttribute('http-equiv') ?? '').toLowerCase()
        if (equiv !== 'refresh' && equiv !== 'content-security-policy') continue
      }
      node.remove()
    }
  }

  // ---- 1b. SVG animations that write an address ---------------------------
  //
  // `<set attributeName="href" to="https://…">` gives an element a live address
  // at VIEW time, after every check has read the markup as having none — and
  // SMIL runs with scripts off, so the sandbox does not stop it. Dropped: an
  // animation of a link target is not something a posting needs, and one whose
  // values name an address is a fetch however it is aimed.
  for (const node of [...doc.querySelectorAll('set, animate, animateTransform, animateMotion')]) {
    const target = (node.getAttribute('attributeName') ?? '').trim().toLowerCase()
    const values = ['to', 'from', 'by', 'values'].map((a) => node.getAttribute(a) ?? '').join(';')
    if (/^(?:xlink:)?href$|^src$/.test(target) || /https?:|\/\/|\\\\/i.test(values)) node.remove()
  }

  // ---- 2. attributes, walked against the live tree --------------------------
  /*
   * `[doc, ...]`, because `doc` is the cloned `<html>` ELEMENT, not a Document.
   *
   * `Element.querySelectorAll('*')` returns DESCENDANTS — it never matches the
   * element it is called on. So the root element's own attributes skipped every
   * strip and every rewrite in this pass: an `on*` handler, a
   * `CAPTURE_STRIP_ATTRS` entry, or a CSSOM-set
   * `documentElement.style.backgroundImage` on `<html>` went into the archive
   * untouched, as a live remote address.
   */
  for (const node of [doc, ...doc.querySelectorAll('*')]) {
    for (const attr of CAPTURE_STRIP_ATTRS) node.removeAttribute(attr)

    // Every on* handler. Markup can carry code without a <script> in sight, and
    // the list of event names is open-ended, so this is a shape match rather
    // than a list.
    for (const { name } of [...node.attributes]) {
      if (name.toLowerCase().startsWith('on')) node.removeAttribute(name)
    }

    // An SVG link. `tagName` on an SVG anchor is lowercase 'a', so the anchor
    // branch below misses it — and `xlink:href` is invisible to the leak scan as
    // well, because that pattern needs whitespace or a quote before `href` and
    // here there is a colon. Both halves of the net missed it.
    if (node.hasAttribute('xlink:href')) {
      const raw = node.getAttribute('xlink:href') ?? ''
      // `<use xlink:href="#icon">` is a reference into THIS document — an inline
      // SVG sprite, which is how most icon systems work. Resolving it against
      // the page URL turned every icon into an absolute address, dropped it, and
      // left the capture with blank squares where the icons were.
      if (!raw.trim().startsWith('#')) {
        const dest = absolute(raw)
        node.removeAttribute('xlink:href')
        if (dest !== null) {
          dropped += 1
          node.setAttribute(CAPTURE_HREF_ATTR, dest)
        }
      }
    }

    // An anchor keeps its words and loses its destination — see
    // CAPTURE_HREF_ATTR. The address is preserved beside it so a reader can
    // still see where it pointed.
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      const href = absolute(node.getAttribute('href'))
      node.removeAttribute('href')
      if (href !== null) node.setAttribute(CAPTURE_HREF_ATTR, href)
    }

    // `if/else`, not an early `continue`. The early exit skipped the inline
    // `style` rewrite below for exactly the element most likely to carry a
    // background image, and `<img style="background:url(https://…)">` shipped
    // with the URL live. Nothing caught it: the sweep and `remoteRefCount` read
    // attribute NAMES, and that URL sits in a value.
    if (node.tagName === 'IMG') {
      const src = pickImageSrc(node)
      if (src === null) node.removeAttribute('src')
      else node.setAttribute('src', token(src, 'img'))
    } else {
      for (const attr of CAPTURE_URL_ATTRS) {
        // `href` is NOT skipped here. Anchors were handled above and no longer
        // carry one; anything else still holding an `href` is SVG `<image>`,
        // `<area>` or a `<link>` the strip pass could not resolve, and every one
        // of those is a fetch. Skipping the attribute outright left them live —
        // `remoteRefCount` then caught them and refused the whole capture, so
        // the symptom was "this page cannot be saved" rather than a leak.
        if (!node.hasAttribute(attr)) continue
        if (attr === 'href' && (node.getAttribute(attr) ?? '').trim().startsWith('#')) continue
        if (absolute(node.getAttribute(attr)) !== null) dropped += 1
        node.removeAttribute(attr)
      }
      // Not in CAPTURE_URL_ATTRS because it is a legacy presentational
      // attribute rather than a URL slot the policy reasons about, but it does
      // fetch.
      if (node.hasAttribute('background')) node.removeAttribute('background')
    }

    // A style attribute can name a background image, which is a fetch dressed
    // as a colour.
    //
    // Read back through the CSSOM first — `node.style.cssText` is the attribute
    // as the CSS parser understood it, escapes decoded — for the reason pass 0
    // gives for <style>.
    const raw = node.getAttribute('style')
    if (raw !== null) {
      const inline = normalisedStyle(node, raw)
      // `true`: this string is going back into an ATTRIBUTE, which changes what
      // may be tokenised into it. See the `@import` arm of `queueCssUrls`.
      if (/url\(|@import|image-set\(/i.test(inline)) node.setAttribute('style', queueCssUrls(inline, true))
      else if (inline !== raw) node.setAttribute('style', inline)
    }

    // Read in `pickImageSrc`, and gone before the document is written out — a
    // lazy loader's address list has no business sitting in the archive.
    for (const attr of CAPTURE_LAZY_ATTRS) node.removeAttribute(attr)
    node.removeAttribute(RESOLVED)
  }

  /**
   * Which address a lazily-loaded image actually wants.
   *
   * `src` first when the rendered image really loaded — `currentSrc` is the
   * browser's own answer and accounts for `srcset`, which is stripped a few
   * lines above and would otherwise leave a picture with no source at all.
   * Failing that, the deferred-loading conventions: LinkedIn keys on
   * `data-delayed-url`, and every lazy loader has its own spelling.
   */
  function pickImageSrc(node) {
    const current = absolute(node.getAttribute(RESOLVED))
    if (current !== null) return current

    const src = absolute(node.getAttribute('src'))
    if (src !== null) return src

    for (const attr of CAPTURE_LAZY_ATTRS) {
      const lazy = absolute(node.getAttribute(attr))
      if (lazy !== null) return lazy
    }
    // An <img> that had a source of some kind and yielded none is a hole in the
    // capture the user should be told about; one that never had a source is not.
    if (node.hasAttribute('src') || CAPTURE_LAZY_ATTRS.some((a) => node.hasAttribute(a))) {
      dropped += 1
    }
    return null
  }

  /**
   * Whether this element is showing less than it holds.
   *
   * Asked of the rendered page rather than of a class name, because "clamped" is
   * a computed-style fact and the class that produced it is different on every
   * site. Two shapes cover what job boards actually use: `-webkit-line-clamp`,
   * and a `max-height` with hidden overflow that the content overruns.
   *
   * This is the single biggest fidelity problem in a captured posting. LinkedIn
   * renders the whole job description into the DOM and clamps it to five lines
   * behind a "See more" button; the capture keeps the text AND the clamp, and
   * the button is inert because scripts are stripped. Without this the reader
   * opens a year-old posting and sees five lines and a dead control, with the
   * rest of it in the file and unreachable.
   */
  function clampKind(live) {
    let style
    try {
      style = window.getComputedStyle(live)
    } catch {
      return null
    }
    if (style.webkitLineClamp && style.webkitLineClamp !== 'none') return 'clamp'
    if (style.overflow !== 'hidden' && style.overflowY !== 'hidden') return null
    if (style.maxHeight === 'none') return null
    // 4px of slack: a container can overrun its own box by a rounding error
    // without anything being hidden from the reader.
    return live.scrollHeight > live.clientHeight + 4 ? 'height' : null
  }

  // ---- 3. inline stylesheets, including the ones with no text ---------------
  //
  // `textContent` is empty for a <style> whose rules were inserted through the
  // CSSOM — which is what emotion and styled-components do in production
  // ("speedy" mode, `sheet.insertRule`). Workday's careers UI is emotion-based,
  // so reading only `textContent` captured its markup with almost none of its
  // styling: correct text, browser-default everything.
  //
  // The rules ARE readable from `document.styleSheets` for same-origin and
  // inline sheets; a cross-origin sheet throws `SecurityError` on `.cssRules`
  // and is exactly the case the <link> fetch path above already covers.
  for (const style of [...doc.querySelectorAll('style')]) {
    const raw = style.textContent ?? ''
    if (raw.startsWith(TOKEN)) continue // a token from step 1
    // One pass 0 could not reach — read through a constructed sheet instead,
    // so its escapes are decoded all the same.
    const text = normalised.has(style) ? raw : normalisedSheet(raw)
    if (text !== raw) style.textContent = text
    // CSSOM-only sheets were already filled in by pass 0, where the live node
    // was still reachable; nothing here has to index two lists against each
    // other, which is what made this fragile once step 1 inserted new <style>
    // elements the live tree does not have.
    if (/url\(|@import|image-set\(/i.test(text)) style.textContent = queueCssUrls(text, false)
  }

  // Constructed stylesheets have no DOM node at all, so nothing above can find
  // them. They are appended as one <style> carrying the same rules.
  const adopted = (document.adoptedStyleSheets ?? []).map(rulesOf).filter((t) => t.trim() !== '')
  if (adopted.length > 0) {
    const style = inert.createElement('style')
    style.textContent = queueCssUrls(adopted.join('\n'), false)
    const head = doc.querySelector('head') ?? doc
    head.append(style)
  }

  function rulesOf(sheet) {
    try {
      // `<` escaped: the CSSOM writes a string's `</style>` back out verbatim,
      // and a rule a script inserted can carry one — which would end this
      // element in the saved file and put whatever followed it in as markup.
      // `\3c ` is the same character to the CSS parser.
      return [...sheet.cssRules].map((r) => r.cssText).join('\n').replace(/</g, '\\3c ')
    } catch {
      // Cross-origin. The <link> path fetches these by URL instead.
      return ''
    }
  }

  /**
   * CSS text the live page has no sheet for, parsed and written back out.
   * `replaceSync` ignores `@import` — fine here, since a <style> with no live
   * sheet was never applied by the page either. If it cannot be parsed at all,
   * text carrying an escape is dropped rather than trusted: an escape is the
   * one thing the tokeniser cannot read.
   */
  function normalisedSheet(text) {
    if (text.trim() === '') return text
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(text)
      return rulesOf(sheet)
    } catch {
      return text.includes('\\') ? '' : text
    }
  }

  /** A style attribute as the CSS parser read it; see the call site. */
  function normalisedStyle(node, raw) {
    const declared = node.style
    if (declared && typeof declared.cssText === 'string') return declared.cssText
    return raw.includes('\\') ? '' : raw
  }

  // ---- 4. <template> contents ----------------------------------------------
  //
  // `importNode(…, true)` copies a template's content and the serialiser writes it
  // out, but `querySelectorAll` never descends into a DocumentFragment that is
  // not in the tree — so everything above skipped it: scripts unstripped,
  // handlers unstripped, URLs untouched. What kept that from being a leak was
  // the blunt string sweep in `background.js`, which is not a mechanism to rely
  // on. Emptied instead: a template is inert markup a script was going to
  // stamp out, and there is no script any more.
  for (const template of [...doc.querySelectorAll('template')]) {
    if (template.content.querySelector('*') !== null) dropped += 1
    template.innerHTML = ''
  }

  // ---- 5. the un-clamp rule -------------------------------------------------
  //
  // Appended last so it wins on specificity as well as order. Marked elements
  // only — a blanket rule would unclamp things the page clamps for layout
  // reasons rather than to hide text.
  if (doc.querySelector(`[${CAPTURE_UNCLAMP_ATTR}]`) !== null) {
    const unclamp = inert.createElement('style')
    unclamp.textContent =
      // `display:block` ONLY where a line clamp was actually in force — that
      // idiom needs `display:-webkit-box`, and releasing the clamp without
      // restoring a sane display leaves the text in a broken box. Everywhere
      // else the element keeps its own display: forcing block on any
      // overflow-hidden container would flatten grids and flex rows that were
      // never hiding anything.
      `[${CAPTURE_UNCLAMP_ATTR}]{` +
      '-webkit-line-clamp:unset !important;' +
      'max-height:none !important;' +
      'overflow:visible !important;' +
      '}' +
      `[${CAPTURE_UNCLAMP_ATTR}="clamp"]{display:block !important;}`
    const head = doc.querySelector('head') ?? doc
    head.append(unclamp)
  }

  // ---- 6. a last look at the STRING ----------------------------------------
  //
  // Run after every DOM pass, on the text that is actually returned. Nothing
  // above should have left a `<link>` or a `<meta http-equiv>`: the strip pass
  // removes every link and every refresh and CSP meta. This is the check that it
  // did, on the one form a later step cannot change — and the shape that got
  // through before the copy was inert was exactly a refresh and a preconnect
  // written into the tree AFTER the strip ran.
  //
  // A plain pattern is exact here, which it would not be on page-written HTML:
  // this string is the serialiser's own output, so every attribute value is
  // double-quoted with any `"` inside written as `&quot;`, and text `<` is
  // `&lt;`. Stylesheet text has its `<` escaped by `rulesOf`.
  const html = `<!doctype html>${doc.outerHTML}`.replace(
    /<(link|meta)(?=[\s/>])(?:[^>"]|"[^"]*")*>/gi,
    (tag, name) => (name.toLowerCase() === 'link' || /\shttp-equiv\s*=/i.test(tag) ? '' : tag),
  )

  return {
    url: location.href,
    title: (document.title || '').trim(),
    html,
    assets,
    dropped,
    shadowRoots,
    capturedAt: new Date().toISOString(),
  }
}
