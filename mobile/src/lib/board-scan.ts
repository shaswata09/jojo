/**
 * Reads a job board on the phone, for the scout pipeline.
 *
 * WHAT THIS CAN AND CANNOT REACH, stated first because it is the whole story.
 * React Native's `fetch` carries no session and cannot run a page's JavaScript.
 * So this reads boards that render their listings on the server — Greenhouse,
 * Lever, Ashby and most university and company careers pages — and it honestly
 * cannot read the ones that do not: a board behind a sign-in serves its sign-in
 * page. (LinkedIn, Indeed, Glassdoor and ZipRecruiter are not read at all, on
 * either platform — their terms forbid automated reading; see below.) Those come back as a sentence saying so rather than as zero
 * results, because "there are no jobs here" and "I could not see the jobs here"
 * are different facts and the model does different things with them.
 *
 * The web app has no such limit: `web/src/lib/capture-bridge.ts` drives the
 * capture extension, which opens a real background tab with the user's own
 * cookies. That asymmetry is not an oversight to be fixed later — a phone has
 * nowhere to put an extension, and a headless browser is not a thing an app
 * ships.
 *
 * WHY REGEX AND NOT A PARSER. There is no DOM here and no HTML parser in the
 * bundle, and adding one to read anchors would be a dependency carried for a
 * best-effort feature. What makes it safe rather than merely cheap is where the
 * output goes: `readListings` in `core/board.ts` vets every row — resolving it,
 * testing it against `isJobPostingUrl`, canonicalising and capping it — so the
 * worst a sloppy match can do is be thrown away.
 *
 * HOW POLITELY. Before a page is fetched this asks the same questions the web
 * extension's worker asks, with the same rules (`core/robots.ts`, and
 * `NO_AUTOMATED_ACCESS` in `core/board.ts`): is the site one whose terms forbid
 * automated reading (then never), does its robots.txt allow the address, has
 * this host had its gap since the last page — at least five seconds, longer
 * if robots.txt asks — and has it pages left in today's budget. A page that
 * turns out to be a bot check ("Just a moment…", a captcha interstitial) stops
 * the read rather than being parsed as an empty board.
 *
 * The robots cache and the pacing book live in memory for as long as the app
 * runs. A restart forgets them, which costs at most one extra robots.txt fetch
 * and lets the day's budget start again; persisting them would mean a new
 * stored record for a limit that a person restarting the app is not
 * circumventing on purpose.
 */

import { noAutomatedAccess } from '@jojo/service/core/board'
import type { BoardScan, ScanCancellation } from '@jojo/service/core/board'
import {
  ALLOW_ALL,
  BOARD_DAILY_PAGES,
  looksLikeBotWall,
  pace,
  paced,
  paceHost,
  pageGapMs,
  parseRobots,
  robotsAddress,
  robotsAllows,
} from '@jojo/service/core/robots'
import type { PaceBook, RobotsRules } from '@jojo/service/core/robots'
import { i18next } from '@/i18n/i18n'

const TIMEOUT_MS = 20000

/**
 * How long a robots.txt gets before it is read as missing (which means
 * allowed). A few hundred bytes from the site's edge; the same number the
 * extension worker uses.
 */
export const ROBOTS_TIMEOUT_MS = 3000

/**
 * The longest this waits to keep a host's gap. Usually it is the few seconds
 * left of the five-second minimum; a site whose Crawl-delay asks for more than
 * this between pages is not waited on, and the read stops there with the pages
 * before it still counted. Longer than the extension's cap because nothing on
 * the phone is timing the whole scan from outside.
 */
export const PACE_MAX_WAIT_MS = 30000

/** robots.txt per site, for as long as the app runs. */
const robotsSeen = new Map<string, RobotsRules>()
/** The pages loaded per host today, for as long as the app runs. */
let book: PaceBook = {}

/** For tests: a fresh robots cache and pacing book, as a fresh app launch has. */
export function resetBoardPacing(): void {
  robotsSeen.clear()
  book = {}
}

/**
 * A site's robots.txt, once per site. Without cookies (`credentials: 'omit'`,
 * as every fetch here is), and anything but a 2xx — or no answer within
 * `ROBOTS_TIMEOUT_MS` — reads as "no robots.txt", which means allowed. `stop`
 * is the scan's own controller, so a Stop ends this wait too.
 */
async function robotsFor(url: string, stop: AbortSignal): Promise<RobotsRules> {
  const address = robotsAddress(url)
  if (address === null) return ALLOW_ALL
  const hit = robotsSeen.get(address)
  if (hit !== undefined) return hit

  const own = new AbortController()
  const timer = setTimeout(() => own.abort(), ROBOTS_TIMEOUT_MS)
  const follow = () => own.abort()
  stop.addEventListener?.('abort', follow)
  let rules: RobotsRules = ALLOW_ALL
  let stoppedHere = false
  try {
    const response = await fetch(address, {
      signal: own.signal,
      credentials: 'omit',
      headers: { Accept: 'text/plain' },
    })
    if (response.ok) rules = parseRobots(await response.text())
  } catch {
    // Unreachable: nothing stated, so allowed. A Stop is not cached as an answer.
    stoppedHere = stop.aborted
  } finally {
    clearTimeout(timer)
    stop.removeEventListener?.('abort', follow)
  }
  if (!stoppedHere) robotsSeen.set(address, rules)
  return rules
}

/** Waits `ms`, or less if `stop` fires first. */
const wait = (ms: number, stop: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    stop.addEventListener?.(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })

/** A page's `<title>`, as text, for the bot-check test. */
const titleOf = (html: string) => textOf(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')

/**
 * The most anchors one page hands back before the package filters them.
 *
 * Matches the extension's own ceiling. Not a policy number — `BOARD_MAX_RESULTS`
 * is the policy and it is applied on the far side.
 */
const HARVEST_LIMIT = 400

const ANCHOR = /<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi

/** Everything between the tags, with the tags taken out. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Read through a call: TypeScript would otherwise keep the first check's answer. */
const stopped = (signal: ScanCancellation | undefined) => signal?.aborted === true

/**
 * `signal` is the round's Stop (review 2026-11-18, leaks-2): it was dropped, so
 * a Stop pressed mid-page waited out the fetch — up to `TIMEOUT_MS` — where the
 * web's twin (`capture-bridge.ts`) gives up at once.
 */
export async function scanBoard(url: string, signal?: ScanCancellation): ReturnType<BoardScan> {
  if (stopped(signal)) {
    return { ok: false, reason: i18next.t('messages:boardScan.cancelled') }
  }
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return { ok: false, reason: i18next.t('messages:boardScan.badAddress') }
  }

  /*
   * Refused before any request. LinkedIn, Indeed, Glassdoor and ZipRecruiter
   * forbid automated reading in their terms (`NO_AUTOMATED_ACCESS`), and a
   * pipeline reads on a timer with nobody watching. This used to be refused
   * for a technical reason — they serve a phone an empty shell — and the web
   * scout, which has a real browser, read them anyway. The terms are the
   * reason now, and the rule is the one both platforms share.
   */
  const forbidden = noAutomatedAccess(url)
  if (forbidden !== null) {
    return {
      ok: false,
      reason: i18next.t('messages:boardScan.noAutomatedAccess', { host: forbidden }),
    }
  }

  // `AbortSignal.timeout` does not exist in React Native — the controller and a
  // timer are the portable spelling, and the same pair `local-service.ts` uses.
  const controller = new AbortController()
  // The Stop aborts the same request. React Native's fetch resolves only once
  // the whole body has arrived (whatwg-fetch over XHR), so this and the timer
  // cover the body too. Wired before robots.txt and the pacing wait, so a Stop
  // ends those as well.
  signal?.onAbort?.(() => controller.abort())
  ;(
    signal as {
      addEventListener?: (type: 'abort', fn: () => void, options?: { once?: boolean }) => void
    }
  )?.addEventListener?.('abort', () => controller.abort(), { once: true })

  // What the site's robots.txt allows an unnamed crawler.
  const robots = await robotsFor(url, controller.signal)
  if (stopped(signal)) {
    return { ok: false, reason: i18next.t('messages:boardScan.cancelled') }
  }
  if (!robotsAllows(robots, url)) {
    return { ok: false, reason: i18next.t('messages:boardScan.robots', { host }) }
  }

  // The gap this host is owed since its last page, and today's budget.
  const paceKey = paceHost(url) ?? host
  const gap = pageGapMs(robots)
  const decision = pace(book, paceKey, Date.now(), gap)
  if (!decision.ok) {
    return {
      ok: false,
      reason: i18next.t('messages:boardScan.dailyBudget', { host, pages: BOARD_DAILY_PAGES }),
    }
  }
  if (decision.waitMs > PACE_MAX_WAIT_MS) {
    return {
      ok: false,
      reason: i18next.t('messages:boardScan.tooSoon', { host, seconds: Math.round(gap / 1000) }),
    }
  }
  if (decision.waitMs > 0) await wait(decision.waitMs, controller.signal)
  if (stopped(signal)) {
    return { ok: false, reason: i18next.t('messages:boardScan.cancelled') }
  }
  book = paced(book, paceKey, Date.now())

  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, {
      signal: controller.signal,
      // No cookies leave the device for a third party, which is also why a
      // signed-in board is out of reach here. The trade is stated in the header.
      credentials: 'omit',
      headers: { Accept: 'text/html,application/xhtml+xml' },
    })
  } catch (error) {
    clearTimeout(timer)
    if (stopped(signal)) {
      return { ok: false, reason: i18next.t('messages:boardScan.cancelled') }
    }
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      ok: false,
      reason: aborted
        ? i18next.t('messages:boardScan.timeout')
        : i18next.t('messages:boardScan.unreachable'),
    }
  }
  clearTimeout(timer)

  /*
   * Read before the status is judged: a Cloudflare or Imperva challenge comes
   * back as a 403 or 503, and "That board answered 403" would send the person
   * looking for the wrong problem. A bot check stops the read — the site has
   * asked for a human, and the person can open it themselves.
   */
  let body = ''
  try {
    body = await response.text()
  } catch {
    body = ''
  }
  if (looksLikeBotWall({ title: titleOf(body), html: body })) {
    return { ok: false, reason: i18next.t('messages:boardScan.botWall') }
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: i18next.t('messages:boardScan.status', { status: response.status }),
    }
  }

  const rows: { url: string; title: string; rel?: string }[] = []
  for (const match of body.matchAll(ANCHOR)) {
    if (rows.length >= HARVEST_LIMIT) break
    // An attribute value is HTML too: HigherEdJobs writes its page links as
    // `search.cfm?JobCat=31&amp;Page=2`, and left encoded that is a different
    // address — every page past the first would be read as page one.
    const href = decodeAttribute(match[2] ?? match[3] ?? '')
    const tag = /^<a\b[^>]*>/i.exec(match[0])?.[0] ?? ''
    // An icon-only pager link has no text; its accessible name is the title.
    const title = textOf(match[4] ?? '') || decodeAttribute(attribute(tag, 'aria-label') ?? '')
    if (!href || !title) continue
    const rel = attribute(tag, 'rel')
    rows.push({ url: href, title: title.slice(0, 300), ...(rel ? { rel: rel.slice(0, 40) } : {}) })
  }

  // The page's own `<link rel="next">`, where the pager is not an anchor at all.
  const declared = /<link\b[^>]*\brel\s*=\s*["'][^"']*\bnext\b[^"']*["'][^>]*>/i.exec(body)?.[0]
  const next = declared ? attribute(declared, 'href') : undefined
  if (next) rows.push({ url: decodeAttribute(next), title: 'Next', rel: 'next' })

  // Where the fetch ended up after redirects, so relative links resolve there.
  // `response.url` is empty on some React Native builds; then it is left out.
  const landed =
    typeof response.url === 'string' && /^https?:/i.test(response.url) ? response.url : undefined
  return { ok: true, rows, ...(landed ? { landed } : {}) }
}

/** One attribute's raw value off an opening tag, or undefined. */
function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return match ? (match[1] ?? match[2] ?? '') : undefined
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .trim()
}
