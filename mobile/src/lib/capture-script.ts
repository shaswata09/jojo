import {
  CAPTURE_HREF_ATTR,
  CAPTURE_LAZY_ATTRS,
  CAPTURE_SCHEMES,
  CAPTURE_STRIP_ATTRS,
  CAPTURE_STRIP_TAGS,
  CAPTURE_UNCLAMP_ATTR,
  CAPTURE_URL_ATTRS,
} from '@jojo/service/core/capture'

/**
 * The DOM walk, as a string, because the only place it can run is inside the
 * WebView.
 *
 * This is the phone's half of the pair described in `core/capture.ts` — the
 * extension's `web/extension/serialise.js` is the other. Both walk a document to
 * the same policy; neither owns the policy, which is interpolated in below from
 * the package's constants rather than restated. Change `CAPTURE_STRIP_TAGS` and
 * this script changes with it, with no second list to remember.
 *
 * ## Why a string and not a function
 *
 * `react-native-webview`'s `injectJavaScript` takes source text and evaluates it
 * in the page. There is no structured channel — the page and the app share
 * nothing but strings, which is also why the result comes back through
 * `window.ReactNativeWebView.postMessage` as JSON rather than as a value.
 *
 * A consequence worth knowing: this code is never type-checked. It is a template
 * literal to TypeScript, so a typo here is a runtime failure inside a WebView on
 * a phone, which is the least observable place in this repo. Hence the shape it
 * has — one try/catch around everything, and a failure that reports itself as a
 * message rather than dying silently and leaving the Save button spinning.
 *
 * ## Why it does not fetch
 *
 * Same reason the extension's content script does not: a fetch from inside the
 * page carries the page's origin and is refused by the CDN the stylesheet lives
 * on. So this collects addresses and `lib/capture.ts` fetches them from the React
 * Native side, where there is no CORS at all.
 *
 * The trailing `true;` is required by `injectJavaScript` — without it the
 * injected script's completion value is whatever the last expression evaluated
 * to, and a non-serialisable value there warns on iOS.
 */
export function captureScript(): string {
  const stripTags = JSON.stringify(CAPTURE_STRIP_TAGS)
  const stripAttrs = JSON.stringify(CAPTURE_STRIP_ATTRS)
  const urlAttrs = JSON.stringify(CAPTURE_URL_ATTRS)
  const lazyAttrs = JSON.stringify(CAPTURE_LAZY_ATTRS)
  const schemes = JSON.stringify(CAPTURE_SCHEMES)
  const hrefAttr = JSON.stringify(CAPTURE_HREF_ATTR)
  const unclampAttr = JSON.stringify(CAPTURE_UNCLAMP_ATTR)

  return `
(function () {
  try {
    var STRIP_TAGS = ${stripTags};
    var STRIP_ATTRS = ${stripAttrs};
    var URL_ATTRS = ${urlAttrs};
    var LAZY_ATTRS = ${lazyAttrs};
    var SCHEMES = ${schemes};
    var HREF_ATTR = ${hrefAttr};
    var UNCLAMP_ATTR = ${unclampAttr};

    var doc = document.documentElement.cloneNode(true);
    var assets = [];
    var dropped = 0;
    var shadowRoots = 0;

    function absolute(value, base) {
      if (typeof value !== 'string' || value.trim() === '') return null;
      try {
        var url = new URL(value, base || document.baseURI);
        return SCHEMES.indexOf(url.protocol) >= 0 ? url.href : null;
      } catch (e) {
        return null;
      }
    }

    function token(href, kind) {
      var index = assets.length;
      assets.push({ href: href, kind: kind });
      return '__JOJO_ASSET_' + index + '__';
    }

    // Two spellings, because CSS has two. A bare @import "https://..." matches
    // no url( pattern at all and shipped live until this handled it.
    function queueCssUrls(css) {
      return css
        .replace(/@import\\s+(['"])([^'"]+)\\1/gi, function (whole, q, raw) {
          if (raw.trim().indexOf('data:') === 0) return whole;
          var href = absolute(raw);
          if (href === null) { dropped += 1; return '@import ""'; }
          return '@import url("' + token(href, 'css') + '")';
        })
        .replace(/url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/gi, function (whole, q, raw) {
          var value = raw.trim();
          if (value.indexOf('data:') === 0) return whole;
          // A same-document SVG filter reference. Resolving one invents a URL
          // that never existed, fetches it, and corrupts a data URI already kept.
          if (value.charAt(0) === '#' || value.indexOf('%23') === 0) return whole;
          var href = absolute(raw);
          if (href === null) { dropped += 1; return 'none'; }
          return 'url("' + token(href, 'css-asset') + '")';
        });
    }

    function rulesOf(sheet) {
      try {
        var out = [];
        var rules = sheet.cssRules;
        for (var r = 0; r < rules.length; r += 1) out.push(rules[r].cssText);
        return out.join('\\n');
      } catch (e) {
        return '';
      }
    }

    // Whether this element is showing less than it holds. Asked of the RENDERED
    // page rather than of a class name — "clamped" is a computed-style fact and
    // the class that produced it differs on every site.
    function isClamped(live) {
      try {
        var style = window.getComputedStyle(live);
        if (style.webkitLineClamp && style.webkitLineClamp !== 'none') return true;
        if (style.overflow !== 'hidden' && style.overflowY !== 'hidden') return false;
        if (style.maxHeight === 'none') return false;
        return live.scrollHeight > live.clientHeight + 4;
      } catch (e) {
        return false;
      }
    }

    function pickImageSrc(node, live) {
      var current = live && live.currentSrc ? absolute(live.currentSrc) : null;
      if (current !== null) return current;
      var src = absolute(node.getAttribute('src'));
      if (src !== null) return src;
      for (var l = 0; l < LAZY_ATTRS.length; l += 1) {
        var lazy = absolute(node.getAttribute(LAZY_ATTRS[l]));
        if (lazy !== null) return lazy;
      }
      var had = node.hasAttribute('src');
      for (var k = 0; k < LAZY_ATTRS.length && !had; k += 1) had = node.hasAttribute(LAZY_ATTRS[k]);
      if (had) dropped += 1;
      return null;
    }

    // 1. elements that never survive. <link rel=stylesheet> becomes a <style>
    //    holding a token, so the CSS it resolves to can be fetched and inlined.
    for (var t = 0; t < STRIP_TAGS.length; t += 1) {
      var tag = STRIP_TAGS[t];
      var nodes = Array.prototype.slice.call(doc.querySelectorAll(tag));
      for (var n = 0; n < nodes.length; n += 1) {
        var node = nodes[n];
        if (tag === 'link') {
          var rel = (node.getAttribute('rel') || '').toLowerCase();
          var href = absolute(node.getAttribute('href'));
          if (rel.indexOf('stylesheet') >= 0 && href !== null) {
            var style = document.createElement('style');
            style.textContent = token(href, 'css');
            if (node.parentNode) node.parentNode.replaceChild(style, node);
            continue;
          }
        }
        if (tag === 'meta') {
          var equiv = (node.getAttribute('http-equiv') || '').toLowerCase();
          if (equiv !== 'refresh' && equiv !== 'content-security-policy') continue;
        }
        if (node.parentNode) node.parentNode.removeChild(node);
      }
    }

    // 2. attributes, walked against the live tree. The clone is faithful and
    //    made in this same tick, so the two lists are element-for-element
    //    aligned — which is what makes computed-style questions answerable.
    var cloneAll = Array.prototype.slice.call(doc.querySelectorAll('*'));
    var liveAll = Array.prototype.slice.call(document.documentElement.querySelectorAll('*'));
    var aligned = cloneAll.length === liveAll.length;

    for (var i = 0; i < cloneAll.length; i += 1) {
      var el = cloneAll[i];
      var live = aligned ? liveAll[i] : null;

      for (var a = 0; a < STRIP_ATTRS.length; a += 1) el.removeAttribute(STRIP_ATTRS[a]);

      var attrs = Array.prototype.slice.call(el.attributes);
      for (var b = 0; b < attrs.length; b += 1) {
        if (attrs[b].name.toLowerCase().indexOf('on') === 0) el.removeAttribute(attrs[b].name);
      }

      // An SVG link. tagName on an SVG anchor is lowercase 'a', and xlink:href
      // is invisible to the leak scan (a colon precedes 'href', not whitespace),
      // so both halves of the net missed it.
      if (el.hasAttribute('xlink:href')) {
        var xdest = absolute(el.getAttribute('xlink:href'));
        el.removeAttribute('xlink:href');
        if (xdest !== null) { dropped += 1; el.setAttribute(HREF_ATTR, xdest); }
      }

      if (el.tagName === 'A' && el.hasAttribute('href')) {
        var dest = absolute(el.getAttribute('href'));
        el.removeAttribute('href');
        if (dest !== null) el.setAttribute(HREF_ATTR, dest);
      }

      if (el.tagName === 'IMG') {
        var src = pickImageSrc(el, live);
        if (src === null) el.removeAttribute('src');
        else el.setAttribute('src', token(src, 'img'));
      } else {
        for (var c = 0; c < URL_ATTRS.length; c += 1) {
          if (URL_ATTRS[c] === 'href') continue;
          if (!el.hasAttribute(URL_ATTRS[c])) continue;
          if (absolute(el.getAttribute(URL_ATTRS[c])) !== null) dropped += 1;
          el.removeAttribute(URL_ATTRS[c]);
        }
        if (el.hasAttribute('background')) el.removeAttribute('background');
      }

      for (var d = 0; d < LAZY_ATTRS.length; d += 1) el.removeAttribute(LAZY_ATTRS[d]);

      var inline = el.getAttribute('style');
      if (inline !== null && /url\\(|@import/i.test(inline)) {
        el.setAttribute('style', queueCssUrls(inline));
      }

      if (live !== null && isClamped(live)) el.setAttribute(UNCLAMP_ATTR, '');
      if (live !== null && live.shadowRoot) shadowRoots += 1;
    }

    // 3. inline stylesheets, including the ones with no text. A <style> whose
    //    rules were inserted through the CSSOM (emotion, styled-components in
    //    production) has an EMPTY textContent, and reading only that captured
    //    Workday's markup with almost none of its styling.
    var liveStyles = Array.prototype.slice.call(document.querySelectorAll('style'));
    var cloneStyles = Array.prototype.slice.call(doc.querySelectorAll('style'));
    for (var s = 0; s < cloneStyles.length; s += 1) {
      var text = cloneStyles[s].textContent || '';
      if (text.indexOf('__JOJO_ASSET_') === 0) continue;
      if (text.trim() === '' && liveStyles[s] && liveStyles[s].sheet) {
        text = rulesOf(liveStyles[s].sheet);
      }
      cloneStyles[s].textContent = /url\\(|@import/i.test(text) ? queueCssUrls(text) : text;
    }

    // Constructed stylesheets have no DOM node at all.
    var adoptedSheets = document.adoptedStyleSheets || [];
    var adopted = [];
    for (var y = 0; y < adoptedSheets.length; y += 1) {
      var rules = rulesOf(adoptedSheets[y]);
      if (rules.trim() !== '') adopted.push(rules);
    }
    if (adopted.length > 0) {
      var adoptedStyle = document.createElement('style');
      adoptedStyle.textContent = queueCssUrls(adopted.join('\\n'));
      (doc.querySelector('head') || doc).appendChild(adoptedStyle);
    }

    // 4. <template> contents. querySelectorAll never descends into a detached
    //    DocumentFragment, so everything above skipped them — and a template is
    //    inert markup a script was going to stamp out, with no script left.
    var templates = Array.prototype.slice.call(doc.querySelectorAll('template'));
    for (var p = 0; p < templates.length; p += 1) {
      if (templates[p].content && templates[p].content.querySelector('*')) dropped += 1;
      templates[p].innerHTML = '';
    }

    // 5. the un-clamp rule, appended last so it wins on order as well as
    //    specificity. Marked elements only.
    if (doc.querySelector('[' + UNCLAMP_ATTR + ']')) {
      var unclamp = document.createElement('style');
      unclamp.textContent = '[' + UNCLAMP_ATTR + ']{' +
        '-webkit-line-clamp:unset !important;' +
        'max-height:none !important;' +
        'overflow:visible !important;' +
        'display:block !important;}';
      (doc.querySelector('head') || doc).appendChild(unclamp);
    }

    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'jojo:capture',
      url: location.href,
      title: (document.title || '').trim(),
      html: '<!doctype html>' + doc.outerHTML,
      assets: assets,
      dropped: dropped,
      shadowRoots: shadowRoots,
    }));
  } catch (error) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'jojo:capture-failed',
      message: String((error && error.message) || error),
    }));
  }
})();
true;
`
}
