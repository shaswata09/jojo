/**
 * Makes an inlined page fit the cap by leaving out its heaviest embedded assets.
 *
 * ## Why this exists
 *
 * `capture()` used to discard a page outright when the inlined HTML came out
 * over `CAPTURE_MAX_BYTES`. Measured on gitlab.com/jobs: 8.04 MB against an
 * 8 MB cap — over by 40 KB — and the whole posting was thrown away, text and
 * all, while the popup said "Kept.". About 5.7 MB of that page was base64
 * fonts and images, most of them living inside its stylesheets. Leaving out the
 * single largest font would have saved it.
 *
 * So instead of all-or-nothing, the most expensive embedded assets are removed
 * one at a time until the page fits. The text of the posting and its layout CSS
 * are never touched — they are not `data:` URIs — so the thing a person kept a
 * page FOR survives, and what goes is decoration.
 *
 * ## Why "most expensive" means size × occurrences
 *
 * `inline()` fetches an address once but splices its value in at EVERY place
 * it is referenced. The same 0.31 MB SVG was measured appearing several times
 * in one capture. Removing one distinct asset removes all its copies, so an
 * asset's real cost is its size times how often it appears — a small icon
 * repeated twenty times can outweigh one large photo.
 *
 * ## What it guarantees
 *
 * - Every removed asset becomes an EMPTY value (`url("")`, `src=""`) — exactly
 *   what `inline()` already writes for an asset that failed to fetch. So this
 *   can never introduce a live address, and a viewer treats the gap the same.
 * - Non-asset text is left byte-for-byte alone.
 * - If the page is still over the cap with every embedded asset removed, it
 *   returns `html: null` rather than a broken half-page, so the caller can say
 *   honestly that the page itself is too large.
 *
 * Plain ES module, no imports: the worker imports it, and so does a web test
 * (`web/src/lib/capture-shrink.test.ts`), which is how this file is checked.
 */

/**
 * An inlined asset, in the two positions `inline()` writes one: inside a CSS
 * `url(...)`, or as the value of an attribute. Only base64 URIs are considered,
 * because those are the ones `inline()` produced; a small url-encoded
 * `data:image/svg+xml,...` that was already on the page is left alone.
 */
const EMBEDDED = /(?:url\(\s*["']?|=\s*["'])(data:[a-zA-Z0-9.+/-]+;base64,[A-Za-z0-9+/=]+)/g

const encoder = new TextEncoder()
const bytesOf = (text) => encoder.encode(text).length

/**
 * @param {string} html      the inlined page
 * @param {number} maxBytes  the cap, in UTF-8 bytes
 * @returns {{ html: string | null, dropped: number, freedBytes: number }}
 *   `dropped` counts DISTINCT assets removed; `html` is null when it cannot fit.
 */
export function shrinkToFit(html, maxBytes) {
  let size = bytesOf(html)
  if (size <= maxBytes) return { html, dropped: 0, freedBytes: 0 }

  // Distinct URIs and how often each appears. A base64 URI is ASCII, so its
  // length IS its byte count, and removing one copy frees exactly that much.
  const seen = new Map()
  for (const match of html.matchAll(EMBEDDED)) {
    const uri = match[1]
    seen.set(uri, (seen.get(uri) ?? 0) + 1)
  }

  const byCost = [...seen.entries()]
    .map(([uri, times]) => ({ uri, cost: uri.length * times }))
    .sort((a, b) => b.cost - a.cost)

  const removed = new Set()
  let freedBytes = 0
  for (const { uri, cost } of byCost) {
    if (size <= maxBytes) break
    removed.add(uri)
    size -= cost
    freedBytes += cost
  }

  if (size > maxBytes) return { html: null, dropped: removed.size, freedBytes }

  // One pass per removed asset. `split/join` rather than a regex: a base64 URI
  // is hundreds of kilobytes, and turning it into a pattern would mean escaping
  // `+` and `/` in all of it for no gain.
  let out = html
  for (const uri of removed) out = out.split(uri).join('')
  return { html: out, dropped: removed.size, freedBytes }
}
