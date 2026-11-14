/**
 * Capturing a page: the tab the person is looking at (the popup's Capture
 * button) and a page opened by its address (the app's "From link"). Both run
 * the same serialiser, the same inliner and the same shrinker.
 */

import { serialise } from '../serialise.js'
import { shrinkToFit } from '../shrink.js'
import {
  CAPTURE_HREF_ATTR,
  CAPTURE_LAZY_ATTRS,
  CAPTURE_MAX_BYTES,
  CAPTURE_SCHEMES,
  CAPTURE_STRIP_ATTRS,
  CAPTURE_STRIP_TAGS,
  CAPTURE_UNCLAMP_ATTR,
  CAPTURE_URL_ATTRS,
} from '../policy.js'
import { badge } from './badge.js'
import { captureNonce, inline } from './inline.js'
import { QUEUE, read, withQueue } from './queue.js'
import { SETTLE_MS, sleep, waitForLoad } from './tabs.js'
import { hostOf, isLocalTarget, looksLikeSignIn } from './targets.js'
import { byteLength } from './util.js'

/** The policy `serialise` is handed through `args`; see `serialise.js` for why. */
export const POLICY = {
  CAPTURE_STRIP_TAGS,
  CAPTURE_STRIP_ATTRS,
  CAPTURE_URL_ATTRS,
  CAPTURE_HREF_ATTR,
  CAPTURE_SCHEMES,
  CAPTURE_LAZY_ATTRS,
  CAPTURE_UNCLAMP_ATTR,
}

/**
 * How far into a "From link" capture inlining must STOP, counted from when the
 * request arrived.
 *
 * The page gives up at `CAPTURE_TIMEOUT_MS` (90 s, `capture-bridge.ts`), and
 * the order of the race is the whole point: if the page gives up first, a
 * capture the worker then finishes is posted into a closed channel and nothing
 * is kept. Measured: an AcademicCareers posting was still inlining at 90 s and
 * the person was told it "did not finish saving in time". So inlining stops
 * here and keeps what it has; after it come only `shrinkToFit` and one message
 * back, which take seconds, and `capture-page.test.ts` holds the margin.
 */
export const CAPTURE_PAGE_INLINE_BY_MS = 65000

/**
 * Opens a posting in a background tab and hands the whole page back.
 *
 * The app's "From link". `capture()` below reads the tab the person is looking
 * at; this reads a page the app was given the ADDRESS of. Everything after the
 * tab exists is the same — the same serialiser, the same policy, the same
 * inlining and the same size cap — so a posting saved from a pasted link is the
 * same kind of document the Capture button saves, and the Vault's viewer, the
 * fit reader and the posting lookup cannot tell them apart.
 *
 * NOT queued. `capture()` queues because the person is in another tab and jojo
 * may not even be open; here jojo asked and is waiting, so the page goes back on
 * the reply and the app files it. Queuing it as well would file it twice the
 * next time the inbox drained.
 *
 * Inactive, and closed the moment it has been read — with a `finally` behind
 * that for every earlier exit — for the reason `scanBoard` gives. It
 * carries the person's own cookies, which is the point — a posting behind a
 * sign-in reads as it does for them — and a sign-in wall is refused rather than
 * saved, because a login form filed under a job is worse than nothing.
 */
export async function capturePage(url) {
  // The page's clock started when it asked, so this one does too.
  const started = Date.now()
  let tabId = null
  try {
    const tab = await chrome.tabs.create({ url, active: false })
    tabId = typeof tab.id === 'number' ? tab.id : null
    if (tabId === null) return { ok: false, reason: 'That page could not be opened.' }

    const loaded = await waitForLoad(tabId)
    if (!loaded) return { ok: false, reason: 'That page took too long to load.' }
    await sleep(SETTLE_MS)

    const landed = await chrome.tabs.get(tabId)
    const refused = landingRefusal(url, landed.url)
    if (refused !== null) return { ok: false, reason: refused }

    const { page, nonce } = await serialiseTab(tabId)

    /*
     * Closed NOW, not in the `finally`. Everything after this works on the
     * string already in hand, and inlining can take a minute — during which
     * the tab sat open in the person's window, signed in and running the
     * site's scripts, for no reason at all. The `finally` still covers every
     * earlier exit.
     */
    await chrome.tabs.remove(tabId).catch(() => undefined)
    tabId = null

    if (!page) return { ok: false, reason: 'Nothing came back from that page.' }
    // Asked a third time, of where the page REPORTS it was when it was read.
    // The tab check above ran before the settle; a page script that navigated
    // in the gap would otherwise be read and kept from wherever it went.
    if (typeof page.url !== 'string' || isLocalTarget(page.url)) {
      return {
        ok: false,
        reason: 'That page moved to an address on this machine or your own network, so it was not kept.',
      }
    }

    let { html, dropped } = await inline(page, nonce, started + CAPTURE_PAGE_INLINE_BY_MS)

    /*
     * Over the cap: leave out the heaviest embedded assets until it fits — the
     * step `capture()` takes, through the same `shrinkToFit`, so a page the
     * Capture button keeps is a page "From link" keeps too.
     *
     * This path refused outright until 2026-09-11, after `capture()` had already
     * learned to shrink. A HigherEdJobs posting — 56 KB of HTML and ~9,700
     * characters of text — inlined to ~8.8 MB because its stylesheets pull in
     * 32 Font Awesome files, the .ttf and the .woff2 of every face, and "+ From
     * link" said "That page is too big to keep." about a posting the model
     * needed none of that to read. `capture-page.test.ts` pins both paths to
     * the one shrinker so they cannot drift apart again.
     */
    if (byteLength(html) > CAPTURE_MAX_BYTES) {
      const fitted = shrinkToFit(html, CAPTURE_MAX_BYTES)
      if (fitted.html === null) {
        return {
          ok: false,
          reason: `That page is too big to keep, even with its images and fonts left out — the limit is ${String(CAPTURE_MAX_BYTES / 1048576)} MB.`,
        }
      }
      html = fitted.html
      dropped += fitted.dropped
    }

    return {
      ok: true,
      capture: {
        url: page.url,
        title: page.title,
        html,
        capturedAt: page.capturedAt,
        dropped,
        shadowRoots: page.shadowRoots ?? 0,
      },
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  } finally {
    if (tabId !== null) await chrome.tabs.remove(tabId).catch(() => undefined)
  }
}

/**
 * Why a "From link" tab that landed at `at` must not be read, or null.
 *
 * A public address that redirects onto this machine or the LAN is refused
 * here, after the redirect — the address asked for was checked before.
 */
function landingRefusal(url, at) {
  if (typeof at === 'string' && isLocalTarget(at)) {
    return 'That page sent us to an address on this machine or your own network, so it was not kept.'
  }
  if (typeof at === 'string' && looksLikeSignIn(url, at)) {
    return `That page sent us to ${hostOf(at)} to sign in. Open the posting in a tab and sign in, then try again.`
  }
  return null
}

/**
 * Runs the serialiser in a tab under a freshly minted nonce, and hands back
 * what it read — undefined when nothing came back — with the nonce its tokens
 * carry, which `inline` needs to find them.
 */
async function serialiseTab(tabId) {
  const nonce = captureNonce()
  const [run] = await chrome.scripting.executeScript({
    target: { tabId },
    func: serialise,
    args: [POLICY, nonce],
  })
  return { page: run?.result, nonce }
}

/*
 * There is no `onClicked` listener any more, and that is not an omission.
 *
 * The action declares a `default_popup`, and Chrome does not fire
 * `chrome.action.onClicked` for an action that has one — the popup opens
 * instead. A listener left here would never run, which is the most expensive
 * kind of dead code: it reads as the live capture path to anyone skimming, so
 * the next person changes it and nothing happens.
 *
 * `capture()` below is now reached from the popup's Capture button, through the
 * `jojo:capture-tab` verb. Same function, same badge, one more hop.
 */

export async function capture(tabId) {
  await badge(tabId, '…')
  try {
    const { page, nonce } = await serialiseTab(tabId)
    if (!page) return fail(tabId, 'Nothing came back from that page.')

    // Nobody is waiting on a clock here, but the badge is, and the loop used to
    // be able to run for hours (500 assets at 15 s each). Two minutes.
    let { html, dropped } = await inline(page, nonce, Date.now() + 120000)

    /*
     * Over the cap: leave out the heaviest embedded assets until it fits,
     * rather than throwing the whole page away.
     *
     * This used to discard outright. Measured on gitlab.com/jobs: 8.04 MB
     * against 8 MB, over by 40 KB, and the posting was lost — text and all —
     * while the popup said "Kept.". Most of that page was base64 fonts and
     * images; the text and layout CSS are not `data:` URIs and are never
     * touched. See `shrink.js`. Only when the page is too large even with every
     * embedded asset gone is it refused, and then the reason says so.
     */
    let trimmed = 0
    if (byteLength(html) > CAPTURE_MAX_BYTES) {
      const fitted = shrinkToFit(html, CAPTURE_MAX_BYTES)
      if (fitted.html === null) {
        return fail(
          tabId,
          `That page is too big to keep, even with its images and fonts left out — the limit is ${String(CAPTURE_MAX_BYTES / 1048576)} MB.`,
        )
      }
      html = fitted.html
      trimmed = fitted.dropped
      dropped += fitted.dropped
    }

    const { queued, id } = await enqueue(page, html, dropped, trimmed)
    // Global as well as per-tab: `setBadgeText` with a tabId sets it for THAT
    // tab only, so the count vanished the moment the posting was closed and
    // reappeared as a stale number on whatever tab had been captured before.
    // The queue is one thing, so the badge is one number.
    await chrome.action.setBadgeText({ text: String(queued.length) })
    await badge(tabId, String(queued.length), 'Saved — open jojo to file it')
    return { ok: true, count: queued.length, id, trimmed }
  } catch (error) {
    return fail(tabId, error instanceof Error ? error.message : String(error))
  }
}

/**
 * Adds one kept page to the queue, and hands back the queue and the page's id.
 *
 * Inside the queue lock: see `withQueue`.
 */
function enqueue(page, html, dropped, trimmed) {
  return withQueue(async () => {
    const queued = await read()
    // Its handle for the acknowledgement below, and what the popup's Save
    // button asks for. Minted here because this is the only place that can.
    const id = `cap_${String(Date.now())}_${String(queued.length)}`
    queued.push({
      // Its handle for the acknowledgement below. Minted here because this is
      // the only place that can, and a counter would collide across a worker
      // restart — MV3 stops the worker whenever it is idle.
      id,
      url: page.url,
      title: page.title,
      html,
      capturedAt: page.capturedAt,
      dropped,
      shadowRoots: page.shadowRoots ?? 0,
      trimmed,
    })
    await chrome.storage.local.set({ [QUEUE]: queued })
    return { queued, id }
  })
}

/**
 * Marks the tab as failed AND hands the reason back.
 *
 * `capture()` used to report failure only through the badge, and return
 * nothing — so the `jojo:capture-tab` handler could not tell success from
 * failure and answered `ok: true` every time. Measured: capturing
 * `chrome://version` and gitlab.com/jobs both stored nothing, and in both the
 * popup said "Kept.". Returning the outcome is what lets the popup say what
 * actually happened.
 */
async function fail(tabId, reason) {
  await badge(tabId, '!', reason)
  return { ok: false, reason }
}
