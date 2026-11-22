/**
 * What the worker checks before it opens a page nobody is watching, and what
 * it looks for once the page has loaded.
 *
 * Two callers, and they are the two ways the scout reaches somebody else's
 * site on its own: `scanBoard` reading a board for a pipeline, and the
 * background reader's `capturePage(url, { unattended: true })` opening a
 * posting a board listed. They used to differ — only the scan asked
 * robots.txt, kept a host's pace or stopped at a bot check, so a round that
 * read one board page politely then opened a dozen of its postings with none
 * of it. Both now go through `beforeOpening` and `showsBotWall` here, so the
 * two cannot drift apart again and the one pacing book counts both.
 *
 * A capture the person starts — the toolbar's Keep button, or "From link" with
 * them waiting on it — does not come through here. That is a person reading a
 * page, which is what the site is for; the rules below are about a program
 * reading on its own.
 *
 * The rules themselves are `core/robots.ts` and `core/board.ts`, transcribed
 * in `crawl-rules.js`.
 */

import {
  ALLOW_ALL,
  BOARD_DAILY_PAGES,
  looksLikeBotWall,
  noAutomatedAccess,
  pace,
  paced,
  paceHost,
  pageGapMs,
  parseRobots,
  robotsAddress,
  robotsAllows,
} from './crawl-rules.js'
import { hostOf } from './targets.js'
import { sleep } from './tabs.js'

/**
 * How long a site's robots.txt gets to answer before it is treated as
 * missing. A robots.txt is a few hundred bytes from the site's edge; a site
 * that cannot serve it in three seconds has stated nothing, and a missing or
 * unreachable robots.txt means allowed. Fetched once per site per browser
 * session (`robotsFor`), so this is paid on the first page of a site only.
 */
export const ROBOTS_TIMEOUT_MS = 3000

/**
 * The longest this worker waits, before opening a tab, to keep the gap a
 * site asks for (`pageGapMs`: at least five seconds, longer when robots.txt
 * says Crawl-delay). Reading pages one after another already takes most of
 * that — a scan spends `SETTLE_MS` and a load in the tab — so the wait is
 * usually a second or two. A site that asks for more than this between pages
 * is not waited on at all: the page is refused with the reason, the pages
 * already read still count, and the rest are read on a later run. Kept short
 * because the page gives a whole scan `SCAN_TIMEOUT_MS` in `capture-bridge.ts`,
 * and this comes out of it — `reader-relay.test.ts` adds it to the worst case.
 */
export const PACE_MAX_WAIT_MS = 5000

/** Where the per-host pacing book is kept: last load and the day's page count. */
export const PACE_BOOK = 'jojo.boardPace'

/** robots.txt per site, for this browser session. `chrome.storage.session` when there is one. */
const ROBOTS_CACHE = 'jojo.robots'
const robotsSeen = new Map()

/**
 * A site's robots.txt rules, fetched once per site per session.
 *
 * Fetched from the worker, not the tab: the worker has the host permission a
 * page lacks, and `credentials: 'omit'` because robots.txt is public and the
 * person's cookies have no business going with it. Anything but a 2xx — a 404,
 * a 5xx, a timeout, a network error — is read as "no robots.txt", which means
 * allowed. Never throws.
 */
export async function robotsFor(url) {
  const address = robotsAddress(url)
  if (address === null) return ALLOW_ALL
  if (robotsSeen.has(address)) return robotsSeen.get(address)
  const session = chrome.storage?.session
  try {
    const stored = session ? (await session.get(ROBOTS_CACHE))?.[ROBOTS_CACHE] : undefined
    const hit = stored && typeof stored === 'object' ? stored[address] : undefined
    if (hit && Array.isArray(hit.rules)) {
      robotsSeen.set(address, hit)
      return hit
    }
  } catch {
    // A session store that will not answer is a cache miss.
  }

  let rules = ALLOW_ALL
  try {
    const response = await fetch(address, {
      credentials: 'omit',
      redirect: 'follow',
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
    })
    if (response.ok) rules = parseRobots(await response.text())
  } catch {
    // Unreachable: nothing stated, so allowed.
  }
  robotsSeen.set(address, rules)
  try {
    if (session) {
      const stored = (await session.get(ROBOTS_CACHE))?.[ROBOTS_CACHE]
      await session.set({ [ROBOTS_CACHE]: { ...(stored && typeof stored === 'object' ? stored : {}), [address]: rules } })
    }
  } catch {
    // Kept in memory regardless.
  }
  return rules
}

/** One pacing decision at a time, so two reads cannot both read the book as "not yet loaded". */
let paceChain = Promise.resolve()

/**
 * Waits out the gap this host is owed, records the load, or says why not.
 *
 * The book is in `chrome.storage.local` rather than memory because the daily
 * budget has to outlive the worker, which the browser stops after thirty
 * seconds idle. A store that will not answer is read as an empty book: the
 * gap is still kept within this worker's life, by the wait below.
 */
export function takePace(url, robots) {
  const run = paceChain.then(async () => {
    const host = paceHost(url)
    if (host === null) return null
    let book = {}
    try {
      const stored = (await chrome.storage.local.get(PACE_BOOK))?.[PACE_BOOK]
      if (stored && typeof stored === 'object') book = stored
    } catch {
      // An empty book; see above.
    }
    const gap = pageGapMs(robots)
    const decision = pace(book, host, Date.now(), gap)
    if (!decision.ok) {
      return `jojo has already read ${BOARD_DAILY_PAGES} pages of ${host} today, which is as many as it reads from one site in a day. The rest can be read tomorrow.`
    }
    if (decision.waitMs > PACE_MAX_WAIT_MS) {
      return `${host} asks automated readers to wait ${Math.round(gap / 1000)} seconds between pages, so jojo stopped here. The rest can be read on a later run.`
    }
    if (decision.waitMs > 0) await sleep(decision.waitMs)
    try {
      await chrome.storage.local.set({ [PACE_BOOK]: paced(book, host, Date.now()) })
    } catch {
      // Not recorded; the next page still waits from memory of nothing, which
      // only costs politeness on a store that is failing anyway.
    }
    return null
  })
  paceChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** The sentence a site whose terms forbid automated reading gets. */
export const forbiddenRefusal = (site) =>
  `${site} does not allow automated reading in its terms of use, so jojo will not read it on a schedule. Open a posting there yourself and save it with the jojo extension's button instead.`

/** The sentence a page gets when its robots.txt disallows it. */
export const robotsRefusal = (url) =>
  `${hostOf(url)} asks automated readers not to open this page (its robots.txt disallows it), so jojo did not read it.`

/** The sentence a bot check gets. The read stops; the person can open the page. */
export const BOT_WALL_REASON = 'This board is asking for a human check; open it yourself.'

/**
 * Everything asked BEFORE a tab is opened for a read nobody is watching, in
 * the order that opens the fewest pages: a site whose terms forbid automated
 * reading is never opened, nor is its robots.txt fetched; the site's
 * robots.txt must allow the address; and the host must be owed no wait longer
 * than `PACE_MAX_WAIT_MS` and have pages left today (`takePace`, which also
 * records this load against both).
 *
 * `{ reason }` to refuse, or `{ robots }` — the rules it read, so a caller
 * that follows a redirect can tell whether it reached another site's.
 */
export async function beforeOpening(url) {
  const forbidden = noAutomatedAccess(url)
  if (forbidden !== null) return { reason: forbiddenRefusal(forbidden) }
  let robots = ALLOW_ALL
  try {
    robots = await robotsFor(url)
  } catch {
    // Unreadable is allowed; see `robotsFor`.
  }
  if (!robotsAllows(robots, url)) return { reason: robotsRefusal(url) }
  const paceRefusal = await takePace(url, robots)
  if (paceRefusal !== null) return { reason: paceRefusal }
  return { robots }
}

/**
 * Where an unattended tab LANDED, asked once it has loaded: a redirect onto a
 * site whose terms forbid automated reading is refused as if it had been
 * asked for directly, and a redirect onto another site's robots.txt is asked
 * of that one. The page has loaded, but nothing is read from it. `null` when
 * it may be read.
 */
export async function afterLanding(url, at) {
  if (typeof at !== 'string' || at.length === 0) return null
  const forbidden = noAutomatedAccess(at)
  if (forbidden !== null) return forbiddenRefusal(forbidden)
  if (robotsAddress(at) !== robotsAddress(url)) {
    let there = ALLOW_ALL
    try {
      there = await robotsFor(at)
    } catch {
      // Allowed; see `robotsFor`.
    }
    if (!robotsAllows(there, at)) return robotsRefusal(at)
  }
  return null
}

/** The page's title, a slice of its markup and its link count, read in the tab. */
function pageSignals() {
  return {
    title: document.title,
    html: document.documentElement ? document.documentElement.outerHTML.slice(0, 200000) : '',
    links: document.links.length,
  }
}

/**
 * Whether the tab is showing a bot check right now. A page that cannot be read
 * is not one.
 *
 * Asked the moment the page has loaded, BEFORE any settle wait: a Cloudflare or
 * Imperva challenge in a real browser often passes itself within that wait,
 * and a background tab quietly solving an "are you human?" check is exactly
 * what the check is there to stop. Callers ask again after the settle, for the
 * challenge some sites only put up once their script has run.
 */
export async function showsBotWall(tabId) {
  try {
    const [run] = await chrome.scripting.executeScript({ target: { tabId }, func: pageSignals })
    return run?.result ? looksLikeBotWall(run.result) : false
  } catch {
    return false
  }
}
