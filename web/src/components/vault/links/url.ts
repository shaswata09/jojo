/**
 * Reading a pasted address well enough to save it in one gesture.
 *
 * All of it is deliberately forgiving: the field this feeds is the only way a
 * link gets into the vault, and one that rejected the most common form of paste
 * would read as broken.
 */

/** Strips the scheme and any trailing slash, so the host reads at a glance. */
export function hostOf(url: string) {
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
