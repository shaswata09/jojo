/**
 * Reads a job board on the phone, for the scout pipeline.
 *
 * WHAT THIS CAN AND CANNOT REACH, stated first because it is the whole story.
 * React Native's `fetch` carries no session and cannot run a page's JavaScript.
 * So this reads boards that render their listings on the server — Greenhouse,
 * Lever, Ashby and most university and company careers pages — and it honestly
 * cannot read the ones that do not. LinkedIn and Indeed serve an empty shell to
 * anything without a browser in front of it, and a board behind a sign-in serves
 * its sign-in page. Those come back as a sentence saying so rather than as zero
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
 */

import type { BoardScan } from '@jojo/service/core/board'

const TIMEOUT_MS = 20000

/**
 * The most anchors one page hands back before the package filters them.
 *
 * Matches the extension's own ceiling. Not a policy number — `BOARD_MAX_RESULTS`
 * is the policy and it is applied on the far side.
 */
const HARVEST_LIMIT = 400

/** Boards that serve an empty shell to anything that cannot run their scripts. */
const NEEDS_A_BROWSER = /(^|\.)(linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com)$/i

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

export async function scanBoard(url: string): ReturnType<BoardScan> {
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return { ok: false, reason: 'That is not an address I can open.' }
  }

  /*
   * Refused before the request rather than after it. Fetching LinkedIn from a
   * phone returns 200 and an empty shell, so the honest failure is
   * indistinguishable from an empty board unless it is named up front.
   */
  if (NEEDS_A_BROWSER.test(host)) {
    return {
      ok: false,
      reason: `${host} only shows its listings to a real browser, so it cannot be read from the phone. On a computer the jojo browser extension can read it.`,
    }
  }

  // `AbortSignal.timeout` does not exist in React Native — the controller and a
  // timer are the portable spelling, and the same pair `local-service.ts` uses.
  const controller = new AbortController()
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
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      ok: false,
      reason: aborted ? 'That board took too long to answer.' : `That board could not be reached.`,
    }
  }
  clearTimeout(timer)

  if (!response.ok) {
    return { ok: false, reason: `That board answered ${String(response.status)}.` }
  }

  const body = await response.text()
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
  const landed = typeof response.url === 'string' && /^https?:/i.test(response.url) ? response.url : undefined
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
