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
 * walk holds both trees and indexes them together — `cloneNode(true)` produces a
 * faithful copy in the same tick, so `documentElement.querySelectorAll('*')` and
 * the clone's are element-for-element aligned. The live page is never mutated.
 */

export function serialise(policy) {
  const {
    CAPTURE_STRIP_TAGS,
    CAPTURE_STRIP_ATTRS,
    CAPTURE_URL_ATTRS,
    CAPTURE_HREF_ATTR,
    CAPTURE_SCHEMES,
    CAPTURE_LAZY_ATTRS,
    CAPTURE_UNCLAMP_ATTR,
  } = policy

  const doc = document.documentElement.cloneNode(true)
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
    return `__JOJO_ASSET_${String(index)}__`
  }

  /**
   * Replaces every remote reference in a CSS string with a token.
   *
   * Two spellings, because CSS has two. `url(...)` is the common one; a bare
   * `@import "https://…";` is legal and matches no `url(` pattern at all — it
   * shipped live until this handled it, and the viewer fetched it.
   */
  function queueCssUrls(css) {
    return css
      .replace(/@import\s+(['"])([^'"]+)\1/gi, (whole, _quote, raw) => {
        if (raw.trim().startsWith('data:')) return whole
        const href = absolute(raw)
        if (href === null) {
          dropped += 1
          return '@import ""'
        }
        return `@import url("${token(href, 'css')}")`
      })
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, _quote, raw) => {
        const value = raw.trim()
        if (value.startsWith('data:')) return whole
        // A same-document reference — `filter='url(#frameNoise)'` inside inline
        // SVG. Resolving one invents a URL that never existed, which is then
        // fetched, counted as dropped, and written back as `url("")` —
        // corrupting a data URI already decided upon.
        if (value.startsWith('#') || value.startsWith('%23')) return whole
        const href = absolute(raw)
        if (href === null) {
          dropped += 1
          return 'none'
        }
        return `url("${token(href, 'css-asset')}")`
      })
  }

  // ---- 0. everything that needs the LIVE tree, before anything is removed ---
  //
  // Ordering, and it is load-bearing. Step 1 below deletes elements from the
  // clone, after which the two trees no longer line up and no computed-style
  // question can be answered at all. So the rendered-page facts are collected
  // first, while `cloneNode(true)` still guarantees element-for-element
  // alignment, and stashed on the clone for the later passes to read.
  const RESOLVED = 'data-jojo-resolved-src'
  {
    const cloned = [...doc.querySelectorAll('*')]
    const living = [...document.documentElement.querySelectorAll('*')]
    if (cloned.length === living.length) {
      for (let i = 0; i < cloned.length; i += 1) {
        const node = cloned[i]
        const live = living[i]

        if (isClamped(live)) node.setAttribute(CAPTURE_UNCLAMP_ATTR, '')

        // A shadow root's contents cannot be reached: `cloneNode` does not copy
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
        if (node.tagName === 'STYLE' && (node.textContent ?? '').trim() === '' && live.sheet) {
          node.textContent = rulesOf(live.sheet)
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
          const style = document.createElement('style')
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

  // ---- 2. attributes, walked against the live tree --------------------------
  for (const node of [...doc.querySelectorAll('*')]) {
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
      const dest = absolute(node.getAttribute('xlink:href'))
      node.removeAttribute('xlink:href')
      if (dest !== null) {
        dropped += 1
        node.setAttribute(CAPTURE_HREF_ATTR, dest)
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
        if (attr === 'href') continue // anchors handled above
        if (!node.hasAttribute(attr)) continue
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
    const inline = node.getAttribute('style')
    if (inline !== null && /url\(|@import/i.test(inline)) {
      node.setAttribute('style', queueCssUrls(inline))
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
  function isClamped(live) {
    let style
    try {
      style = window.getComputedStyle(live)
    } catch {
      return false
    }
    if (style.webkitLineClamp && style.webkitLineClamp !== 'none') return true
    if (style.overflow !== 'hidden' && style.overflowY !== 'hidden') return false
    if (style.maxHeight === 'none') return false
    // 4px of slack: a container can overrun its own box by a rounding error
    // without anything being hidden from the reader.
    return live.scrollHeight > live.clientHeight + 4
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
    const text = style.textContent ?? ''
    if (text.startsWith('__JOJO_ASSET_')) continue // a token from step 1
    // CSSOM-only sheets were already filled in by pass 0, where the live node
    // was still reachable; nothing here has to index two lists against each
    // other, which is what made this fragile once step 1 inserted new <style>
    // elements the live tree does not have.
    if (/url\(|@import/i.test(text)) style.textContent = queueCssUrls(text)
  }

  // Constructed stylesheets have no DOM node at all, so nothing above can find
  // them. They are appended as one <style> carrying the same rules.
  const adopted = (document.adoptedStyleSheets ?? []).map(rulesOf).filter((t) => t.trim() !== '')
  if (adopted.length > 0) {
    const style = document.createElement('style')
    style.textContent = queueCssUrls(adopted.join('\n'))
    const head = doc.querySelector('head') ?? doc
    head.append(style)
  }

  function rulesOf(sheet) {
    try {
      return [...sheet.cssRules].map((r) => r.cssText).join('\n')
    } catch {
      // Cross-origin. The <link> path fetches these by URL instead.
      return ''
    }
  }

  // ---- 4. <template> contents ----------------------------------------------
  //
  // `cloneNode(true)` copies a template's content and the serialiser writes it
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
    const unclamp = document.createElement('style')
    unclamp.textContent =
      `[${CAPTURE_UNCLAMP_ATTR}]{` +
      '-webkit-line-clamp:unset !important;' +
      'max-height:none !important;' +
      'overflow:visible !important;' +
      'display:block !important;' +
      '}'
    const head = doc.querySelector('head') ?? doc
    head.append(unclamp)
  }

  return {
    url: location.href,
    title: (document.title || '').trim(),
    html: `<!doctype html>${doc.outerHTML}`,
    assets,
    dropped,
    shadowRoots,
    capturedAt: new Date().toISOString(),
  }
}
