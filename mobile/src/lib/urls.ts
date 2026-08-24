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
 * A scheme that carries no `//` — `mailto:`, `tel:`, `javascript:`, `data:`.
 *
 * `.` is deliberately absent from the scheme characters, so a host with a port
 * and no scheme (`jobs.rice.edu:8080/x`) is not mistaken for one of these and
 * still normalises.
 */
const OPAQUE_SCHEME = /^[a-z][a-z0-9+-]*:(?!\/\/)/i

/**
 * The address to open, or `undefined` when the field holds nothing openable.
 *
 * Feeds the open button beside a URL field in `components/ui/Field.tsx`, and is
 * deliberately the forgiving twin of `isOpenableUrl` below rather than a second
 * spelling of it. That one is a VALIDATOR: it refuses a scheme-less string so
 * the sheet can say "that is not a full URL" and mean it. This one is an
 * AFFORDANCE, and someone who typed `github.com/you` plainly meant a place — so
 * it normalises first and offers to go there.
 *
 * Both refuse `javascript:` and a host with no dot, because a button that
 * navigates has to. `OPAQUE_SCHEME` is the case normalising alone would miss:
 * `normalizeUrl` only looks for `scheme://`, so `mailto:you@dept.edu` would
 * become `https://mailto:you@dept.edu`, which parses as username `mailto` on
 * host `dept.edu` and goes somewhere nobody asked for.
 */
export function openHref(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed || OPAQUE_SCHEME.test(trimmed)) return undefined
  try {
    const url = new URL(normalizeUrl(trimmed))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (!url.hostname.includes('.')) return undefined
    return url.toString()
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
