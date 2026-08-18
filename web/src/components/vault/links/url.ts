/**
 * Reading a pasted address well enough to save it in one gesture, and writing
 * one back out so a reader recognises it.
 *
 * All of the reading is deliberately forgiving: the field this feeds is the only
 * way a link gets into the vault, and one that rejected the most common form of
 * paste would read as broken.
 *
 * The whole app renders addresses from here. There were four spellings of "the
 * host of this URL" — two byte-identical scheme-strippers, `new URL().hostname`
 * without `www.`, and `new URL().host` with it — so one saved posting,
 * `https://www.jobs.rice.edu/postings/1/`, read as `www.jobs.rice.edu/postings/1`
 * in the vault, `jobs.rice.edu` on the application detail page and
 * `www.jobs.rice.edu` in the draft dialog. Three strings, one link, and nothing
 * on screen to say they were the same one. `kg/core/parse-posting.ts` strips
 * `www.` too and stays separate on purpose: that is parsing, below the layer
 * boundary, and it may not import this.
 */

/**
 * The host alone — 'jobs.rice.edu' — or `undefined` when the string is not an
 * address at all.
 *
 * `undefined` rather than the input, because the two callers that show a URL
 * want to fall back to the raw string and the one that fills a `[PORTAL]`
 * placeholder in a draft must not: a blank there is visible and a half-parsed
 * one is not. Making the fallback the caller's decision is what stopped this
 * being copied a fourth time.
 *
 * Normalised first, so a posting saved the way it was typed
 * ('jobs.rice.edu/postings/29411', no scheme) resolves rather than throwing.
 */
export function hostOf(url: string): string | undefined {
  return parseUrl(normalizeUrl(url))?.hostname.replace(/^www\./, '')
}

/**
 * The address minus the noise — scheme and trailing slash gone, path kept.
 *
 * The vault's links list shows this rather than `hostOf` because a link row's
 * subject IS the page: five rows on one host are five different documents, and
 * a list that rendered all five as 'jobs.rice.edu' would be a list of one thing
 * repeated. Everywhere else the host is the whole point, which is why this is a
 * second function and not a flag on the first.
 */
export function pathLabel(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/**
 * Takes what people actually paste.
 *
 * 'jobs.rice.edu/postings' is a URL to everyone except `new URL`, so a missing
 * scheme is filled in rather than rejected — refusing the most common form of
 * paste would make the field feel broken.
 */
export function normalizeUrl(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/**
 * The URL as a URL, or null. A host with no dot in it ('notes', 'localhost') is
 * refused too: `new URL` accepts those happily and a link to one goes nowhere.
 */
export function parseUrl(raw: string) {
  try {
    const url = new URL(raw)
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return null
    return url
  } catch {
    return null
  }
}

/** A stray '%' is not an escape sequence, and `decodeURIComponent` throws on it. */
function safeDecode(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * A title good enough to save without stopping to type one.
 *
 * The last path segment names most postings — '…/postings/statistics-tt' — so it
 * leads, with the host behind it for context. A bare host keeps just the host.
 * The guess is often clumsy, which is what row-level Edit is for.
 */
export function titleFromUrl(url: URL) {
  const host = url.hostname.replace(/^www\./, '')
  const slug = url.pathname.split('/').filter(Boolean).pop()
  if (!slug) return host

  const words = safeDecode(slug)
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[-_+]+/g, ' ')
    .trim()

  return words ? `${host} — ${words}` : host
}
