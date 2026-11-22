/**
 * The crawler's manners, as the extension can read them: which sites it never
 * reads on a schedule, what a robots.txt allows, how fast one host is read,
 * and how to tell a bot check from a board.
 *
 * A hand transcription of `service/kg/core/robots.ts` and of
 * `NO_AUTOMATED_ACCESS` / `noAutomatedAccess` in `service/kg/core/board.ts`,
 * for the reason `policy.js` gives: the extension is loaded from disk as plain
 * files and cannot import from the package. What keeps the copy honest is
 * `web/src/lib/extension-crawl-rules.test.ts`, which runs the same cases
 * through this file and the package and fails when they disagree. Change the
 * package first, then this, and let that test say whether they match.
 *
 * The comments that explain WHY each rule is what it is live in the package;
 * this copy only says what it is.
 */

/** Sites whose terms forbid automated reading. See `NO_AUTOMATED_ACCESS`. */
export const NO_AUTOMATED_ACCESS = ['linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com']

/** The site in `NO_AUTOMATED_ACCESS` an address is on, or null. */
export function noAutomatedAccess(url) {
  let host
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase()
  } catch {
    return null
  }
  for (const site of NO_AUTOMATED_ACCESS) {
    if (host === site || host.endsWith(`.${site}`)) return site
    const name = site.slice(0, site.indexOf('.'))
    if (new RegExp(`(?:^|\\.)${name}\\.(?:[a-z]{2,3})(?:\\.[a-z]{2})?$`).test(host)) return site
  }
  return null
}

/* --------------------------------- robots --------------------------------- */

export const ROBOTS_MAX_CHARS = 500 * 1024

export const ALLOW_ALL = { rules: [] }

export function parseRobots(text) {
  const rules = []
  let crawlDelay
  let agents = []
  let inRules = false

  for (const raw of String(text).slice(0, ROBOTS_MAX_CHARS).split(/\r\n|\r|\n/)) {
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
      if (Number.isFinite(seconds) && seconds >= 0) crawlDelay = Math.max(crawlDelay ?? 0, seconds)
      continue
    }
    if (value === '') continue
    rules.push({ allow: key === 'allow', pattern: normalisePattern(value) })
  }

  return crawlDelay === undefined ? { rules } : { rules, crawlDelay }
}

function normalisePattern(pattern) {
  try {
    return /^[\x21-\x7e]*$/.test(pattern) ? pattern : encodeURI(pattern).replace(/%25([0-9a-f]{2})/gi, '%$1')
  } catch {
    return pattern
  }
}

function matches(pattern, path) {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const source = body
    .split('*')
    .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path)
}

export function robotsAllows(robots, url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const path = `${parsed.pathname || '/'}${parsed.search}`
  if (parsed.pathname === '/robots.txt') return true

  let best
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

export function robotsAddress(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return `${parsed.protocol}//${parsed.host}/robots.txt`
  } catch {
    return null
  }
}

/* --------------------------------- pacing --------------------------------- */

export const BOARD_MIN_GAP_MS = 5000
export const BOARD_DAILY_PAGES = 100

export function pageGapMs(robots) {
  return Math.max(BOARD_MIN_GAP_MS, Math.round((robots.crawlDelay ?? 0) * 1000))
}

export function paceHost(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

const dayOf = (now) => new Date(now).toISOString().slice(0, 10)

export function pace(book, host, now, gapMs) {
  const entry = book[host]
  if (entry !== undefined && entry.day === dayOf(now) && entry.pages >= BOARD_DAILY_PAGES) {
    return { ok: false, why: 'budget' }
  }
  const since = entry === undefined ? Number.POSITIVE_INFINITY : now - entry.last
  return { ok: true, waitMs: Math.max(0, Math.ceil(gapMs - since)) }
}

export function paced(book, host, now) {
  const today = dayOf(now)
  const out = {}
  for (const [key, entry] of Object.entries(book)) {
    if (entry !== undefined && entry.day === today) out[key] = entry
  }
  const entry = out[host]
  out[host] = { last: now, day: today, pages: (entry?.pages ?? 0) + 1 }
  return out
}

/* -------------------------------- bot walls ------------------------------- */

export const BOT_WALL_FEW_LINKS = 5

const BOT_WALL_TITLE =
  /^(?:just a moment|attention required!? \| cloudflare|checking your browser|verifying you are human|please verify you are a human|human verification|pardon our interruption)/i
const BOT_WALL_STRONG = /cf_chl_opt|\bcf-chl-|incapsula incident id|id=["']challenge-form["']/i
const BOT_WALL_WEAK = /_Incapsula_Resource|\/cdn-cgi\/challenge-platform\/|hcaptcha\.com|h-captcha|google\.com\/recaptcha|recaptcha\.net|g-recaptcha|challenges\.cloudflare\.com/i

export function looksLikeBotWall(page) {
  const title = String(page?.title ?? '').trim()
  const html = String(page?.html ?? '')
  if (BOT_WALL_TITLE.test(title)) return true
  if (BOT_WALL_STRONG.test(html)) return true
  const links = typeof page?.links === 'number' ? page.links : (html.match(/<a\b/gi)?.length ?? 0)
  return links < BOT_WALL_FEW_LINKS && BOT_WALL_WEAK.test(html)
}
