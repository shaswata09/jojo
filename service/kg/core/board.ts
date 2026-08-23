/**
 * L1 — what comes back from a job board, and which of it is a job.
 *
 * A search-results page is read by something with a DOM: the browser extension
 * injects a script into a real tab, because an MV3 service worker has no
 * `DOMParser` and this layer is forbidden one by `check-platform`. That script
 * is deliberately stupid. It collects every link it can see with whatever text
 * sits near it and hands the lot over; it makes no judgement about what a job
 * is.
 *
 * The judgement is here, and the split is the point. A predicate that lived in
 * the extension would be a second copy of the rule, kept in step by nothing —
 * the capture policy already needs `web/extension/policy.js` and a test that
 * refuses to let it drift, and that is one transcription more than anybody
 * wants. Regexes are worse to transcribe than string lists, so this one is
 * never transcribed: the extension over-collects, and `readListings` throws
 * away everything that is not a posting.
 *
 * WHAT THIS IS DEFENDING AGAINST, concretely. A board's own index page and one
 * of its postings are the same shape to every parser in this repo:
 * `jobs.lever.co/matchgroup` and `jobs.lever.co/matchgroup/1deea0b0-…` both read
 * as "a job at Matchgroup". Without a predicate the scout's first suggestion on
 * every board would be the search page it had just read, filed as a job.
 */

import { canonicalPostingUrl } from './capture'

/** One row of a search-results page, after this module has vetted it. */
export type BoardListing = {
  /** Absolute, canonicalised. The identity `postingKey` folds on. */
  url: string
  title: string
  /** The employer, when the row said so. Boards that aggregate rarely do. */
  org?: string
  location?: string
}

/**
 * The most rows one read hands back to the model.
 *
 * Forty because of what happens downstream rather than what a board can list:
 * `renderOutcome` truncates a read's JSON at 6000 characters and tells the model
 * to narrow the search, so a read that returns two hundred rows returns forty
 * of them and a sentence about it either way. Doing the cut here means the forty
 * are the first forty complete rows rather than the first 6000 characters,
 * which is a row and a half of nonsense on the end.
 */
export const BOARD_MAX_RESULTS = 40

/* ------------------------------ what is a job ----------------------------- */

const UUID = /^[0-9a-f]{8}-?[0-9a-f-]{8,}$/i

/** Path segments that name a routing concept rather than a posting. */
const NOT_AN_ID = new Set([
  'search',
  'jobs',
  'job',
  'careers',
  'career',
  'openings',
  'opening',
  'positions',
  'position',
  'vacancies',
  'apply',
  'application',
  'index',
  'list',
  'all',
  'results',
])

/** A segment that reads as an identifier: digits, a uuid, or a slug ending in one. */
const looksLikeAnId = (segment: string): boolean => {
  if (NOT_AN_ID.has(segment.toLowerCase())) return false
  if (/^\d{3,}$/.test(segment)) return true
  if (UUID.test(segment)) return true
  // 'senior-engineer-4021234567' and 'Engineer_JR1988734'.
  return /[-_](?:r|jr|req)?\d{4,}$/i.test(segment)
}

/**
 * Is this the address of ONE posting, rather than a list of them?
 *
 * Per board where the shape is known, and conservative everywhere else. Being
 * wrong in the permissive direction files a search page as a job; being wrong in
 * the strict direction drops a real job from one board. The second is recoverable
 * — the user still has the board — and the first puts a lie in their records, so
 * an unrecognised host has to clear a real bar rather than a plausible one.
 */
export function isJobPostingUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false

  const host = parsed.hostname.toLowerCase()
  const segments = parsed.pathname.split('/').filter(Boolean)

  if (host.endsWith('linkedin.com')) {
    const fromQuery = parsed.searchParams.get('currentJobId')
    if (fromQuery !== null && /^\d+$/.test(fromQuery)) return true
    return /\/jobs\/view\/(?:[^/?#]*?-)?\d+/.test(parsed.pathname)
  }
  if (host.endsWith('greenhouse.io')) {
    return /\/[^/]+\/jobs\/\d+/.test(parsed.pathname)
  }
  if (host.endsWith('lever.co') || host.endsWith('ashbyhq.com')) {
    // `/<tenant>/<uuid>`. The tenant alone is the board's index page.
    return segments.length >= 2 && UUID.test(segments[1]!)
  }
  if (host.endsWith('myworkdayjobs.com')) {
    return /_(?:R|JR|REQ)[-_]?\d{3,}/i.test(parsed.pathname)
  }
  if (host.endsWith('indeed.com')) {
    return parsed.searchParams.has('jk') || /\/viewjob/.test(parsed.pathname)
  }

  /*
   * An unrecognised board. Two things must both be true: somewhere in the path
   * a segment names a job, and somewhere after it a segment identifies one.
   * `/careers` fails on the second and `/about/12345` fails on the first.
   */
  const namesAJob = segments.findIndex((s) =>
    /^(?:jobs?|careers?|positions?|openings?|vacanc(?:y|ies)|listings?)$/i.test(s),
  )
  if (namesAJob === -1) return false
  return segments.slice(namesAJob + 1).some(looksLikeAnId)
}

/* -------------------------------- the sources ----------------------------- */

/**
 * The board addresses a pipeline watches, out of the free text it was given.
 *
 * `Pipeline.source` has always been prose, and both platforms' dialogs have
 * always promised "Separate several with commas" while nothing split on one. So
 * this is the first reader of a field users have been filling in for a while,
 * and it has to cope with what is already stored: bare hostnames without a
 * scheme, an em dash meaning "nothing", and prose that names a board rather than
 * addressing one.
 *
 * Anything that cannot be read as an address is dropped rather than guessed at.
 * A scout told to watch "the CRA job board" has nothing to fetch, and inventing
 * `https://the-cra-job-board` would send it somewhere real by accident.
 */
export function parseSources(source: string): string[] {
  const out: string[] = []
  for (const piece of source.split(/[,\n]/)) {
    const text = piece.trim()
    if (text.length === 0 || text === '—') continue

    // A bare `cra.org/ads` is what the placeholder in both dialogs shows, so it
    // has to work; `new URL` refuses it without a scheme.
    const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`
    try {
      const parsed = new URL(candidate)
      /*
       * A hostname with no dot is usually prose rather than a host — "linkedin"
       * parses as `https://linkedin` quite happily — so it is refused, with one
       * exception that is a real host rather than a convenience: `localhost`.
       * It is what an internal careers site and a test both look like, and
       * excluding it would be excluding the only board that can be verified
       * without reaching somebody else's server.
       */
      const host = parsed.hostname.toLowerCase()
      if (/\s/.test(host)) continue
      if (!host.includes('.') && host !== 'localhost') continue
      if (!out.includes(parsed.href)) out.push(parsed.href)
    } catch {
      // Prose. See above.
    }
  }
  return out
}

/* ------------------------------ the trust boundary ------------------------ */

/**
 * Everything a scan returned, vetted.
 *
 * The same shape of guard `readCapture` puts on a capture, and for the same
 * reason: what arrives crossed `postMessage` from a content script relaying an
 * extension, and every field of it was read off a page somebody else wrote. It
 * is `unknown` until this function has been over it.
 *
 * Relative hrefs are resolved against the board's own address rather than
 * dropped — most boards link their rows relatively, so dropping them would
 * return nothing from exactly the boards that work best.
 */
export function readListings(raw: unknown, from: string): BoardListing[] {
  if (!Array.isArray(raw)) return []

  const out: BoardListing[] = []
  const seen = new Set<string>()

  for (const row of raw) {
    if (out.length >= BOARD_MAX_RESULTS) break
    if (typeof row !== 'object' || row === null) continue

    const fields = row as Record<string, unknown>
    const href = fields['url']
    const title = fields['title']
    if (typeof href !== 'string' || typeof title !== 'string') continue

    let absolute: string
    try {
      absolute = new URL(href, from).href
    } catch {
      continue
    }
    if (!isJobPostingUrl(absolute)) continue

    const url = canonicalPostingUrl(absolute)
    if (seen.has(url)) continue
    seen.add(url)

    const clean = title.trim().replace(/\s+/g, ' ')
    if (clean.length === 0) continue

    out.push({
      url,
      title: clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1)}…` : clean,
      ...text(fields['org'], 'org'),
      ...text(fields['location'], 'location'),
    })
  }

  return out
}

const TITLE_MAX = 160
const FIELD_MAX = 80

/** An optional string field, present only when it says something. */
function text(value: unknown, key: 'org' | 'location'): Record<string, string> {
  if (typeof value !== 'string') return {}
  const clean = value.trim().replace(/\s+/g, ' ')
  if (clean.length === 0) return {}
  return { [key]: clean.length > FIELD_MAX ? `${clean.slice(0, FIELD_MAX - 1)}…` : clean }
}
