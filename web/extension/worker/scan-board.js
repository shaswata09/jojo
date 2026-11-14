/** Reading a job board: opened in a background tab, "Load more" pressed, links harvested. */

import { expandListing, harvest } from '../harvest.js'
import { hostOf, isLocalTarget, looksLikeSignIn, sameSite } from './targets.js'
import { SETTLE_MS, sleep, waitForLoad } from './tabs.js'

/**
 * The most links one harvest hands back, before the package filters them.
 *
 * Not a policy number — the policy is `BOARD_MAX_RESULTS` in
 * `core/board.ts`, and it is applied on the far side. This is only a ceiling on
 * what crosses `postMessage`, and a board page has a few hundred links on it at
 * the outside.
 */
export const HARVEST_LIMIT = 400

/**
 * "Load more": at most this many presses, each waiting up to `MORE_WAIT_MS` for
 * the list to grow, all of it inside `MORE_BUDGET_MS`. Ten seconds on top of
 * the settle keeps a scan inside the page's 40s budget even after a slow 25s
 * load, and on AcademicCareers (≈1.2s a press, 20 jobs each) it is five more
 * screenfuls than the one a person sees on arrival.
 */
export const MORE_ROUNDS = 6
export const MORE_WAIT_MS = 3500
export const MORE_BUDGET_MS = 10000

/**
 * Opens a board in a background tab, reads it, and closes it again.
 *
 * A TAB rather than a fetch from the worker, and the two reasons are both
 * decisive on their own. A worker fetch is `credentials: 'omit'` here — see the
 * note on `inline` — so a board the user is signed into would answer with its
 * sign-in wall; a tab carries the browser's own session and sees what the user
 * sees. And a worker has no `DOMParser` and cannot run the page's JavaScript,
 * so on any board that renders its results client-side the served HTML has no
 * results in it at all.
 *
 * The tab is closed in a `finally`. A scan that throws must not leave a tab
 * open in the user's window — this runs without them watching, and litter they
 * did not open is the fastest way to make a background feature feel like
 * malware.
 */
export async function scanBoard(url) {
  let tabId = null
  try {
    const tab = await chrome.tabs.create({ url, active: false })
    tabId = typeof tab.id === 'number' ? tab.id : null
    if (tabId === null) return { ok: false, reason: 'That board could not be opened.' }

    const loaded = await waitForLoad(tabId)
    if (!loaded) return { ok: false, reason: 'That board took too long to load.' }
    await sleep(SETTLE_MS)

    /*
     * Where it actually ENDED UP, which is not always where it was sent. A board
     * that wants a sign-in redirects, and the harvest then returns the links on
     * a login page — a handful of plausible-looking rows that are not jobs. The
     * host is compared rather than the URL because boards redirect within
     * themselves constantly (locale prefixes, canonical slugs), and only leaving
     * the site means what this is looking for.
     */
    /*
     * A move within the same site is the board, not a wall: `cra.org/ads` now
     * lives at `careercenter.cra.org`, and refusing every change of host made
     * that board unreadable. Leaving the site, or landing on something that
     * looks like a sign-in, is still refused.
     */
    const landed = await chrome.tabs.get(tabId)
    const at = typeof landed.url === 'string' && landed.url.length > 0 ? landed.url : url
    const refused = boardRefusal(url, at)
    if (refused !== null) return { ok: false, reason: refused }

    // Best effort: a board with nothing to press, or a press that throws,
    // still gets read as it stands.
    await chrome.scripting
      .executeScript({ target: { tabId }, func: expandListing, args: [MORE_ROUNDS, MORE_WAIT_MS, MORE_BUDGET_MS] })
      .catch(() => undefined)

    /*
     * Asked AGAIN after pressing. A "Load more" that was really a link, or a
     * board whose button submits a form, navigates the tab — and the harvest
     * below then read whatever page it reached, signed-in or off-site, with
     * every check above already behind it. The same three checks, on where the
     * tab is NOW.
     */
    const after = await chrome.tabs.get(tabId)
    const now = typeof after.url === 'string' && after.url.length > 0 ? after.url : at
    if (now !== at) {
      const moved = boardRefusal(url, now)
      if (moved !== null) return { ok: false, reason: moved }
    }

    const [run] = await chrome.scripting.executeScript({
      target: { tabId },
      func: harvest,
      args: [HARVEST_LIMIT],
    })
    // And once more AFTER reading: a board that navigated during the harvest
    // handed back links from wherever it went, and those are not this board's.
    const finished = await chrome.tabs.get(tabId)
    const end = typeof finished.url === 'string' && finished.url.length > 0 ? finished.url : now
    if (end !== now) {
      const moved = boardRefusal(url, end)
      if (moved !== null) return { ok: false, reason: moved }
    }
    // Where it landed, so relative rows and next-page links resolve against the
    // page they were read on rather than the address that redirected there.
    return { ok: true, rows: Array.isArray(run?.result) ? run.result : [], landed: now }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  } finally {
    if (tabId !== null) await chrome.tabs.remove(tabId).catch(() => undefined)
  }
}

/**
 * Why a board tab that is now at `at` must not be read, or null. Asked once the
 * page has loaded and again after "Load more", which can navigate.
 */
function boardRefusal(url, at) {
  if (isLocalTarget(at)) {
    return 'That board sent us to an address on this machine or your own network, so it was not read.'
  }
  if (!sameSite(hostOf(at), hostOf(url)) || looksLikeSignIn(url, at)) {
    return `That board sent us to ${hostOf(at)}, which usually means it wants a sign-in. Open it in a tab and sign in, then try again.`
  }
  return null
}
