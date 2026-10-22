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

import { canonicalPostingUrl, onBoard } from './capture'

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

/** A query parameter that names one job: `JobCode`, `jobId`, `job_id`, `postingId`, `jid`… */
const JOB_PARAM = /^(?:jid|(?:job|posting|vacancy|position|opening|req|requisition)[-_]?(?:code|id|no|num|number)?)$/i

/**
 * The name/value pairs of a query string, decoded.
 *
 * By hand rather than through `searchParams.entries()`: the portable URL type
 * declares only `get` and `has` (see `types/portable-globals.d.ts`), and this
 * needs to ask about parameters whose names it does not know in advance.
 */
function queryPairs(search: string): [string, string][] {
  const out: [string, string][] = []
  for (const piece of search.replace(/^\?/, '').split('&')) {
    if (piece === '') continue
    const at = piece.indexOf('=')
    const name = at === -1 ? piece : piece.slice(0, at)
    const value = at === -1 ? '' : piece.slice(at + 1)
    try {
      out.push([decodeURIComponent(name), decodeURIComponent(value.replace(/\+/g, ' '))])
    } catch {
      // A malformed escape names nothing this needs.
    }
  }
  return out
}

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

  if (onBoard(host, 'linkedin.com')) {
    const fromQuery = parsed.searchParams.get('currentJobId')
    if (fromQuery !== null && /^\d+$/.test(fromQuery)) return true
    return /\/jobs\/view\/(?:[^/?#]*?-)?\d+/.test(parsed.pathname)
  }
  if (onBoard(host, 'greenhouse.io')) {
    return /\/[^/]+\/jobs\/\d+/.test(parsed.pathname)
  }
  if (onBoard(host, 'lever.co') || onBoard(host, 'ashbyhq.com')) {
    // `/<tenant>/<uuid>`. The tenant alone is the board's index page.
    return segments.length >= 2 && UUID.test(segments[1]!)
  }
  if (onBoard(host, 'myworkdayjobs.com')) {
    return /_(?:R|JR|REQ)[-_]?\d{3,}/i.test(parsed.pathname)
  }
  if (onBoard(host, 'indeed.com')) {
    return parsed.searchParams.has('jk') || /\/viewjob/.test(parsed.pathname)
  }

  /*
   * A posting named by its QUERY rather than its path — HigherEdJobs'
   * `/faculty/details.cfm?JobCode=179575091`, and the many older boards built
   * the same way. Read before the path rule, which looks for a job in the path
   * and finds none: until this existed every HigherEdJobs posting was thrown
   * away and a scan of that board reported an empty page.
   *
   * A parameter whose NAME says job and whose value reads as an identifier.
   * `?id=` alone is not enough — it is on every page of every CMS — and a search
   * page is refused even when it carries a job code, because a results page
   * filtered to one job is still a results page.
   */
  if (!/(?:^|[/_-])(?:search|results?|list)(?:[._-]|$)/i.test(segments.at(-1) ?? '')) {
    for (const [name, value] of queryPairs(parsed.search)) {
      if (JOB_PARAM.test(name) && (/^\d{3,}$/.test(value) || UUID.test(value))) return true
    }
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

/**
 * Is `url` on one of the boards in `allowed`?
 *
 * Host-only, because a board paginates: a person who typed `cra.org/ads` means
 * that board, including `cra.org/ads?page=2` and `cra.org/ads/senior`. Matching
 * the full URL would refuse the second page of the only thing the pipeline is
 * for.
 *
 * The named host or a subdomain of it — see `sameSite` for what that admits
 * and why. It used to be the exact host, and that did bite: the board itself
 * sends a reader to `careercenter.cra.org` or `www.higheredjobs.com`.
 *
 * Both sides go through `parseSources` first, so both are absolute URLs by the
 * time they arrive and `new URL` cannot throw. It is still wrapped, because a
 * refusal is the right answer to a string this cannot parse.
 */
export function onOneOf(url: string, allowed: readonly string[]): boolean {
  const host = hostOf(url)
  if (host === null) return false
  return allowed.some((entry) => {
    const named = hostOf(entry)
    return named !== null && sameSite(host, named)
  })
}

const hostOf = (value: string): string | null => {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Is `host` the board `named`, or a part of it?
 *
 * The named host itself, the same host with or without `www.`, or a subdomain
 * of it. Measured on the real boards before this was loosened: `cra.org/ads`
 * now redirects to `careercenter.cra.org`, and `higheredjobs.com` serves every
 * page and every next-page link from `www.higheredjobs.com` — so the exact
 * match this used to be refused the second page of both, and CRA's first.
 *
 * Still not a suffix match on the text. A subdomain has to end in `.` plus the
 * whole named host, so `cra.org.attacker.net` and `evil-cra.org` stay refused;
 * and a PARENT of the named host is not admitted, because a person who typed
 * `jobs.acme.com` did not name the rest of acme.com.
 */
export function sameSite(host: string, named: string): boolean {
  const bare = (h: string) => h.replace(/^www\./, '')
  return bare(host) === bare(named) || host.endsWith(`.${bare(named)}`)
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

/* ---------------------------------- pages --------------------------------- */

/**
 * What reading one page of a board returns, from whichever scanner the platform
 * has. `landed` is where the page actually ended up, when the scanner knows —
 * a board that redirects (`cra.org/ads` → `careercenter.cra.org`) links its
 * rows relative to where it landed, not to where it was asked for.
 */
export type BoardScan = (
  url: string,
) => Promise<{ ok: true; rows: unknown; landed?: string } | { ok: false; reason: string }>

/** How many pages of one board a single read follows before handing back a `next`. */
export const BOARD_MAX_PAGES = 10

/** "Next", "Next page", "Next »", "›", "»", "→", "More results", AJO's "next...". */
const NEXT_TEXT =
  /^(?:(?:next(?:\s+(?:page|\d+))?|more\s+(?:results|jobs|listings)|older(?:\s+(?:posts|jobs|entries))?)\s*(?:[›»>→]|\.{2,3}|…)?|[›»>→]{1,2})$/i
const PREVIOUS_TEXT = /^(?:[‹«<←]|prev(?:ious)?\b.*|newer\b.*|first\b.*|last\b.*)$/i

/** A page's identity for "have I read this one": host, path and query; never the fragment. */
export function pageKey(url: string): string {
  try {
    const parsed = new URL(url.split('#')[0] ?? url)
    return `${parsed.hostname.toLowerCase().replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`
  } catch {
    return url
  }
}

/** The listing a page belongs to: its path with a trailing `/page/3` or `/3` taken off. */
const listingOf = (pathname: string) =>
  pathname.replace(/\/(?:page\/)?\d{1,4}\/?$/i, '').replace(/\/+$/, '')

/**
 * The further pages of a board, read off the links a scan collected.
 *
 * In the order worth reading them: a link that DECLARES itself the next page
 * (`rel="next"`, or text that says "Next") first, then numbered pages lowest
 * first. Page 1 is never offered — it is the page being read, under another
 * spelling — and nor is anything that says "previous".
 *
 * A numbered link is only a page of THIS listing when it is the same listing:
 * the same path, or the same path with a page number on the end (`/ads/` and
 * `/ads/page/2/`). A "2" anywhere else on the page is a calendar, a carousel or
 * a footnote. A "Next" link is trusted wherever it points on the same site —
 * AcademicJobsOnline's goes from `/ajo/jobs` to `/ajo?joblst-…` — because the
 * word is the board saying what the link is.
 *
 * Same site only, by `sameSite`: a page of a board is on that board.
 */
export function pageLinks(raw: unknown, from: string): string[] {
  if (!Array.isArray(raw)) return []
  let here: URL
  try {
    here = new URL(from)
  } catch {
    return []
  }
  const host = here.hostname.toLowerCase()
  const listing = listingOf(here.pathname)
  const self = pageKey(from)

  const declared: string[] = []
  const numbered: { n: number; url: string }[] = []

  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue
    const fields = row as Record<string, unknown>
    const href = fields['url']
    if (typeof href !== 'string') continue
    const text = typeof fields['title'] === 'string' ? fields['title'].trim().replace(/\s+/g, ' ') : ''
    const rel = typeof fields['rel'] === 'string' ? fields['rel'].toLowerCase() : ''

    let target: URL
    try {
      target = new URL(href, from)
    } catch {
      continue
    }
    if (target.protocol !== 'https:' && target.protocol !== 'http:') continue
    if (!sameSite(target.hostname.toLowerCase(), host) && !sameSite(host, target.hostname.toLowerCase())) continue
    const url = target.href.split('#')[0] ?? target.href
    if (pageKey(url) === self) continue
    if (isJobPostingUrl(url)) continue
    if (/\bprev\b/.test(rel) || PREVIOUS_TEXT.test(text)) continue

    if (/\bnext\b/.test(rel) || (text.length <= 24 && NEXT_TEXT.test(text))) {
      declared.push(url)
      continue
    }
    if (/^\d{1,4}$/.test(text)) {
      const n = Number(text)
      if (n >= 2 && listingOf(target.pathname) === listing) numbered.push({ n, url })
    }
  }

  const out: string[] = []
  const seen = new Set<string>()
  for (const url of [...declared, ...numbered.sort((a, b) => a.n - b.n).map((p) => p.url)]) {
    const key = pageKey(url)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(url)
  }
  return out
}

/** What following a board's pages found. */
export type BoardCrawl =
  | {
      ok: true
      /** The pages actually read, in order. */
      pages: string[]
      /** New to this person — not saved, not an application, not suggested before. */
      listings: BoardListing[]
      /** Postings on those pages that they have already been shown. */
      alreadySeen: number
      /** The first page not read yet, when the read stopped before the board ran out. */
      next?: string
      /** Why a later page could not be read, when one could not. The pages before it still count. */
      stopped?: string
    }
  | { ok: false; reason: string }

/**
 * Reads a board page by page until it runs out of pages, of budget, or of
 * room for more results.
 *
 * Reported 2026-10-22: the scout read the first page of a board and nothing
 * else — HigherEdJobs' ten pages, CRA's and the rest — so a board whose first
 * page had all been seen before looked empty, two empty rounds followed, and
 * the pipeline offered to switch itself off while hundreds of postings sat on
 * pages two to ten.
 *
 * Two things fix that together. The pages are followed (`pageLinks`), and the
 * postings the person has already been shown are taken out HERE rather than
 * left for the model to recognise: forty rows of jobs it has already proposed
 * would fill the read and teach the model that the board has nothing new,
 * which is the same mistake one level down.
 *
 * `want` is the room in one answer (`BOARD_MAX_RESULTS`); once it is full the
 * read stops and names the next unread page, so the model can come back for
 * more after proposing from these. `allowed` is the same guard `board.search`
 * puts on the model's own address — every page followed is one more tab opened
 * in the person's browser, and a "next" link is text somebody else wrote.
 */
export async function crawlBoard(options: {
  start: string
  scan: BoardScan
  allowed: (url: string) => boolean
  known: (url: string) => boolean
  maxPages?: number
  want?: number
}): Promise<BoardCrawl> {
  const { start, scan, allowed, known } = options
  const maxPages = options.maxPages ?? BOARD_MAX_PAGES
  const want = options.want ?? BOARD_MAX_RESULTS

  const queue = [start]
  const queued = new Set([pageKey(start)])
  const pages: string[] = []
  const listings: BoardListing[] = []
  const counted = new Set<string>()
  let alreadySeen = 0
  let stopped: string | undefined

  while (queue.length > 0 && pages.length < maxPages && listings.length < want) {
    const page = queue.shift()!
    const out = await scan(page)
    if (!out.ok) {
      // The first page failing is the board failing; a later one is a board
      // that stopped answering partway, and the pages before it still stand.
      if (pages.length === 0) return { ok: false, reason: out.reason }
      stopped = out.reason
      queue.unshift(page)
      break
    }
    pages.push(page)
    // Rows resolve against where the page LANDED, when that is still this board.
    const base = out.landed !== undefined && onOneOf(out.landed, [page]) ? out.landed : page
    queued.add(pageKey(base))

    for (const listing of readListings(out.rows, base)) {
      if (counted.has(listing.url)) continue
      counted.add(listing.url)
      if (known(listing.url)) alreadySeen += 1
      else if (listings.length < want) listings.push(listing)
    }

    for (const next of pageLinks(out.rows, base)) {
      const key = pageKey(next)
      if (queued.has(key) || !allowed(next)) continue
      queued.add(key)
      queue.push(next)
    }
  }

  const next = queue[0]
  return {
    ok: true,
    pages,
    listings,
    alreadySeen,
    ...(next === undefined ? {} : { next }),
    ...(stopped === undefined ? {} : { stopped }),
  }
}
