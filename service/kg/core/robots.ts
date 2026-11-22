/**
 * L1 — the manners of a crawler: what a board's robots.txt allows, how fast
 * one host may be read, and how to tell a bot check from a board.
 *
 * WHY THIS EXISTS. The scout reads job boards unattended, on a timer, in the
 * person's own browser (web) or over the phone's `fetch`. Until 2026-11-21 it
 * ignored robots.txt and Crawl-delay entirely, and paced itself by nothing
 * but how long a tab took to load: AcademicJobsOnline asks for
 * `Crawl-delay: 5`, and the CRA career centre disallows `/search/`,
 * `/search?*` and `/jobtype/*`. A site's robots.txt is the one statement of
 * what it allows automated readers to do that every crawler is expected to
 * read, and a tool that reads boards on somebody's behalf has no business
 * reading it less carefully than a search engine does.
 *
 * WHERE EACH HALF RUNS. Everything here is pure: a parser, a matcher, a
 * pacing decision over a plain record, and a test of a page's text. The
 * FETCHING happens where the crawl runs — the extension worker on the web,
 * which has the host permissions a page lacks (a page cannot read another
 * site's robots.txt across origins), and the phone's `fetch`. The extension
 * cannot import from this package, so `web/extension/worker/crawl-rules.js`
 * is a hand transcription, and `web/src/lib/extension-crawl-rules.test.ts`
 * runs the same cases through both and fails if they disagree.
 *
 * Clock-free on purpose (`check-platform` bans the zero-argument `Date` here):
 * every function that cares about time is handed the instant by its caller.
 */

/* --------------------------------- robots --------------------------------- */

/**
 * The most of a robots.txt this reads. RFC 9309 asks a crawler to parse at
 * least 500 KiB; anything past it is ignored, which is what the RFC says to
 * do with an oversized file rather than refusing the whole site.
 */
export const ROBOTS_MAX_CHARS = 500 * 1024

/** One Allow or Disallow line, as written. */
type RobotsRule = { allow: boolean; pattern: string }

/**
 * What a robots.txt says to a crawler that has no name of its own.
 *
 * jojo reads boards through an ordinary browser tab or an ordinary `fetch`; it
 * sends no product token a site could address, so the only group that applies
 * to it is `User-agent: *`. Several `*` groups are merged, as RFC 9309 says.
 */
export type RobotsRules = {
  readonly rules: readonly RobotsRule[]
  /** Seconds, when the `*` group set one. Not in the RFC, but widely written and meant. */
  readonly crawlDelay?: number
}

/** A robots.txt that says nothing: everything allowed, no delay asked for. */
export const ALLOW_ALL: RobotsRules = { rules: [] }

/**
 * Reads a robots.txt into the rules that apply to an unnamed crawler.
 *
 * A group is one or more `User-agent` lines followed by the rules under them;
 * a `User-agent` line after a rule starts the next group. Keys are
 * case-insensitive, `#` starts a comment, and an unknown key (Sitemap, Host,
 * Clean-param…) is skipped. An empty `Disallow:` disallows nothing and is
 * dropped, which is how a file says "everything is allowed" on purpose.
 *
 * Anything this cannot read — an HTML error page served at /robots.txt, an
 * empty body — comes out as `ALLOW_ALL`, because a missing or unreadable
 * robots.txt means the site has stated no limits.
 */
export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRule[] = []
  let crawlDelay: number | undefined

  // The group being read: its agents, and whether a rule has been seen yet
  // (after which another User-agent line starts a new group).
  let agents: string[] = []
  let inRules = false

  for (const raw of text.slice(0, ROBOTS_MAX_CHARS).split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    if (key === 'user-agent') {
      if (inRules) {
        agents = []
        inRules = false
      }
      agents.push(value.toLowerCase())
      continue
    }
    if (key !== 'allow' && key !== 'disallow' && key !== 'crawl-delay') continue
    inRules = true
    if (!agents.includes('*')) continue

    if (key === 'crawl-delay') {
      const seconds = Number(value)
      // The largest a group asked for, if it asked twice. A malformed or
      // negative value is not a request for anything.
      if (Number.isFinite(seconds) && seconds >= 0) crawlDelay = Math.max(crawlDelay ?? 0, seconds)
      continue
    }
    if (value === '') continue
    rules.push({ allow: key === 'allow', pattern: normalisePattern(value) })
  }

  return { rules, ...(crawlDelay === undefined ? {} : { crawlDelay }) }
}

/**
 * A pattern spelled the way a URL's path is: non-ASCII percent-encoded, so a
 * rule written with a raw `é` matches the `%C3%A9` a URL carries. Left as it
 * was when it cannot be encoded.
 */
function normalisePattern(pattern: string): string {
  try {
    return /^[\x21-\x7e]*$/.test(pattern) ? pattern : encodeURI(pattern).replace(/%25([0-9a-f]{2})/gi, '%$1')
  } catch {
    return pattern
  }
}

/** Does one pattern match this path? `*` is any run of characters, a final `$` the end. */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const source = body
    .split('*')
    .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path)
}

/**
 * May an unnamed crawler open this address?
 *
 * The RFC 9309 rule: of every Allow and Disallow pattern that matches the
 * path (with its query), the LONGEST wins, and an Allow wins a tie. No match
 * means allowed. `/robots.txt` itself is always allowed. An address that does
 * not parse is refused, because nothing that cannot be parsed should be
 * opened.
 */
export function robotsAllows(robots: RobotsRules, url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const path = `${parsed.pathname || '/'}${parsed.search}`
  if (parsed.pathname === '/robots.txt') return true

  let best: RobotsRule | undefined
  for (const rule of robots.rules) {
    if (!matches(rule.pattern, path)) continue
    if (
      best === undefined ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
    ) {
      best = rule
    }
  }
  return best === undefined || best.allow
}

/** Where a site's robots.txt lives, for any address on it; null for a non-web address. */
export function robotsAddress(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return `${parsed.protocol}//${parsed.host}/robots.txt`
  } catch {
    return null
  }
}

/* --------------------------------- pacing --------------------------------- */

/**
 * The least time between two page loads on one host, whatever robots.txt says.
 *
 * Five seconds because it is what the strictest board the scout is pointed at
 * asks for (AcademicJobsOnline's `Crawl-delay: 5`), and it is slower than a
 * person paging through results — the scout should never be the busiest
 * reader a board has. A board that asks for longer gets longer.
 */
export const BOARD_MIN_GAP_MS = 5000

/**
 * The most pages of one host the scout opens in a day.
 *
 * A hundred is ten full reads of a board at `BOARD_MAX_PAGES` — more than a
 * daily pipeline needs even with a person pressing Run by hand a few times —
 * and it bounds what a misbehaving model or a looping pipeline can do to
 * somebody else's server. Counted per calendar day (UTC), so it is the same
 * number on every device's clock.
 */
export const BOARD_DAILY_PAGES = 100

/** How long to leave between page loads on a host with these rules. */
export function pageGapMs(robots: RobotsRules): number {
  return Math.max(BOARD_MIN_GAP_MS, Math.round((robots.crawlDelay ?? 0) * 1000))
}

/** What has been loaded, per host: the last load's instant, and the day's count. */
export type PaceBook = Record<string, { last: number; day: string; pages: number }>

/** The host a pace is kept for: lower-case, without `www.`. */
export function paceHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10)

/**
 * Whether a page on `host` may be loaded at `now`, and after how long a wait.
 *
 * Refused outright when the day's budget is spent; otherwise the wait still
 * owed since the last load on this host (zero when it has been long enough).
 * Waiting is the caller's job — this layer has no timer.
 */
export function pace(
  book: PaceBook,
  host: string,
  now: number,
  gapMs: number,
): { ok: true; waitMs: number } | { ok: false; why: 'budget' } {
  const entry = book[host]
  if (entry !== undefined && entry.day === dayOf(now) && entry.pages >= BOARD_DAILY_PAGES) {
    return { ok: false, why: 'budget' }
  }
  const since = entry === undefined ? Number.POSITIVE_INFINITY : now - entry.last
  return { ok: true, waitMs: Math.max(0, Math.ceil(gapMs - since)) }
}

/**
 * The book with one more page loaded on `host` at `now`. A new object, and
 * entries from an earlier day are dropped so the record cannot grow forever.
 */
export function paced(book: PaceBook, host: string, now: number): PaceBook {
  const today = dayOf(now)
  const out: PaceBook = {}
  for (const [key, entry] of Object.entries(book)) {
    if (entry !== undefined && entry.day === today) out[key] = entry
  }
  const entry = out[host]
  out[host] = { last: now, day: today, pages: (entry?.pages ?? 0) + 1 }
  return out
}

/* -------------------------------- bot walls ------------------------------- */

/**
 * Is this page a bot-management challenge rather than the board?
 *
 * A board behind Cloudflare, Imperva (Incapsula) or a captcha interstitial
 * serves a "check you are human" page first. A real browser tab often passes
 * that check by itself after a second or two, which is exactly what must not
 * happen unattended: the site has said it wants a human, and a background tab
 * solving its challenge is a robot getting past the thing built to stop
 * robots. So the read stops and the person is told to open the board
 * themselves.
 *
 * Two kinds of evidence. A STRONG marker only appears on a challenge page —
 * Cloudflare's "Just a moment…" title, its `cf_chl_opt` / `cf-chl-` markup,
 * "Attention Required! | Cloudflare", Imperva's "Incapsula incident ID". A
 * WEAK marker also appears on ordinary pages of protected sites — Imperva
 * injects `_Incapsula_Resource` into every page, Cloudflare's bot script loads
 * from `/cdn-cgi/challenge-platform/` everywhere, and a board can have a
 * reCAPTCHA on its contact form — so it counts only on a page with almost no
 * links, which is what an interstitial is and a page of listings is not.
 *
 * `links` is the page's link count when the caller has a DOM to count with;
 * otherwise `<a ` tags in the markup are counted.
 */
export function looksLikeBotWall(page: { title?: string; html?: string; links?: number }): boolean {
  const title = (page.title ?? '').trim()
  const html = page.html ?? ''
  if (BOT_WALL_TITLE.test(title)) return true
  if (BOT_WALL_STRONG.test(html)) return true
  const links = page.links ?? (html.match(/<a\b/gi)?.length ?? 0)
  return links < BOT_WALL_FEW_LINKS && BOT_WALL_WEAK.test(html)
}

/** Below this many links, a page carrying a weak marker is read as an interstitial. */
export const BOT_WALL_FEW_LINKS = 5

const BOT_WALL_TITLE =
  /^(?:just a moment|attention required!? \| cloudflare|checking your browser|verifying you are human|please verify you are a human|human verification|pardon our interruption)/i
const BOT_WALL_STRONG = /cf_chl_opt|\bcf-chl-|incapsula incident id|id=["']challenge-form["']/i
const BOT_WALL_WEAK = /_Incapsula_Resource|\/cdn-cgi\/challenge-platform\/|hcaptcha\.com|h-captcha|google\.com\/recaptcha|recaptcha\.net|g-recaptcha|challenges\.cloudflare\.com/i
