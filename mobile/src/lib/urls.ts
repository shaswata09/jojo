/**
 * The three things this app does to a URL, told apart.
 *
 * Four screens had grown a `hostOf` and two of them meant different things by
 * it — one stripped the scheme off a stored string, the other parsed the URL
 * and read `.hostname` — so the same posting rendered as
 * `jobs.rice.edu/postings/29411` in the Vault and `jobs.rice.edu` on the
 * record. Both readings are wanted; they just needed different names.
 */

/**
 * Takes what people actually paste.
 *
 * `jobs.rice.edu/postings` is a URL to everyone except `new URL`, so a missing
 * scheme is filled in rather than rejected — refusing the most common form of
 * paste would make the field feel broken.
 */
export function normalizeUrl(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/**
 * Something the OS can open.
 *
 * The seeded postings carry no scheme at all, and handing one of those to
 * `Linking.openURL` opens nothing.
 */
export const hrefOf = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`)

/**
 * The stored string with its scheme and trailing slash trimmed —
 * `jobs.rice.edu/postings/29411`.
 *
 * For a list row, where the path is part of what identifies the thing you
 * saved. Never parses, so a half-typed URL survives it unchanged.
 */
export const displayUrl = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

/**
 * Just the host — `stripe.com`.
 *
 * For a link that should read as a destination rather than as 180 characters
 * of tracking parameters. A URL typed by hand may not parse at all, in which
 * case the raw string is still the honest thing to show.
 */
export function hostOf(url: string) {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * The same, but `undefined` rather than a fallback when there is nothing to
 * parse — the draft sheet substitutes `[PORTAL]` only when it genuinely knows
 * one, and a guess there ends up in an email.
 */
export function hostOrNothing(url?: string): string | undefined {
  if (!url) return undefined
  try {
    return new URL(normalizeUrl(url)).host
  } catch {
    return undefined
  }
}

/**
 * A URL a browser can actually open, for validation.
 *
 * `new URL` alone is not the test: 'javascript:alert(1)' parses perfectly and
 * would end up behind the posting link on the application's own page.
 */
export function isOpenableUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
