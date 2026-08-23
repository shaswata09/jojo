/**
 * The half of the capture that needs permissions the page does not have.
 *
 * `serialise.js` walks the DOM and hands back addresses; this fetches them. It
 * has to be this way round: a content script's `fetch` carries the page's
 * origin and is refused by every CDN a job board uses, while an extension
 * service worker holding `host_permissions` is not subject to CORS at all. That
 * asymmetry is the only reason an extension exists for this feature — everything
 * else the web app could have done itself.
 *
 * Nothing here uploads anything. Every fetch is a GET of a subresource the
 * user's browser was already showing them, and the result goes into
 * `chrome.storage.local` on their own machine until jojo collects it.
 */

import { harvest } from './harvest.js'
import { serialise } from './serialise.js'
import {
  CAPTURE_HREF_ATTR,
  CAPTURE_LAZY_ATTRS,
  CAPTURE_MAX_ASSET_BYTES,
  CAPTURE_MAX_BYTES,
  CAPTURE_SCHEMES,
  CAPTURE_STRIP_ATTRS,
  CAPTURE_STRIP_TAGS,
  CAPTURE_UNCLAMP_ATTR,
  CAPTURE_URL_ATTRS,
} from './policy.js'

const QUEUE = 'jojo.captures'

const POLICY = {
  CAPTURE_STRIP_TAGS,
  CAPTURE_STRIP_ATTRS,
  CAPTURE_URL_ATTRS,
  CAPTURE_HREF_ATTR,
  CAPTURE_SCHEMES,
  CAPTURE_LAZY_ATTRS,
  CAPTURE_UNCLAMP_ATTR,
}

/* --------------------------------- scanning -------------------------------- */

/**
 * The most links one harvest hands back, before the package filters them.
 *
 * Not a policy number — the policy is `BOARD_MAX_RESULTS` in
 * `core/board.ts`, and it is applied on the far side. This is only a ceiling on
 * what crosses `postMessage`, and a board page has a few hundred links on it at
 * the outside.
 */
const HARVEST_LIMIT = 400

/** How long a board gets to load before the attempt is abandoned. */
const LOAD_TIMEOUT_MS = 25000

/**
 * How long to wait after `complete` before reading the page.
 *
 * `complete` means the document finished loading, which on a board that renders
 * its results client-side is the moment BEFORE there are any results. There is
 * no event for "the framework has finished", so this is a wait, and it is the
 * least honest number in the extension. Two and a half seconds is measured
 * against LinkedIn and Workday on a warm connection; a slower board returns
 * fewer rows rather than wrong ones, which is the right way round.
 */
const SETTLE_MS = 2500

/** Resolves when the tab reports itself loaded, or when the wait runs out. */
function waitForLoad(tabId) {
  return new Promise((resolve) => {
    let done = false
    const finish = (loaded) => {
      if (done) return
      done = true
      chrome.tabs.onUpdated.removeListener(onUpdated)
      clearTimeout(timer)
      resolve(loaded)
    }
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') finish(true)
    }
    const timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS)
    chrome.tabs.onUpdated.addListener(onUpdated)
    // It may already be there — a cached page can complete before the listener
    // is attached, and then nothing would ever fire.
    chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === 'complete') finish(true)
      },
      () => finish(false),
    )
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
async function scanBoard(url) {
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
    const landed = await chrome.tabs.get(tabId)
    if (typeof landed.url === 'string' && landed.url.length > 0) {
      if (hostOf(landed.url) !== hostOf(url)) {
        return {
          ok: false,
          reason: `That board sent us to ${hostOf(landed.url)}, which usually means it wants a sign-in. Open it in a tab and sign in, then try again.`,
        }
      }
    }

    const [run] = await chrome.scripting.executeScript({
      target: { tabId },
      func: harvest,
      args: [HARVEST_LIMIT],
    })
    return { ok: true, rows: Array.isArray(run?.result) ? run.result : [] }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  } finally {
    if (tabId !== null) await chrome.tabs.remove(tabId).catch(() => undefined)
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Toolbar click: capture whatever tab the user is looking at. */
chrome.action.onClicked.addListener((tab) => {
  if (typeof tab.id !== 'number') return
  void capture(tab.id)
})

async function capture(tabId) {
  await badge(tabId, '…')
  try {
    const [run] = await chrome.scripting.executeScript({
      target: { tabId },
      func: serialise,
      args: [POLICY],
    })
    const page = run?.result
    if (!page) return badge(tabId, '!', 'Nothing came back from that page')

    const { html, dropped } = await inline(page)

    if (byteLength(html) > CAPTURE_MAX_BYTES) {
      return badge(tabId, '!', 'That page is too big to keep')
    }

    const queued = await read()
    queued.push({
      // Its handle for the acknowledgement below. Minted here because this is
      // the only place that can, and a counter would collide across a worker
      // restart — MV3 stops the worker whenever it is idle.
      id: `cap_${String(Date.now())}_${String(queued.length)}`,
      url: page.url,
      title: page.title,
      html,
      capturedAt: page.capturedAt,
      dropped,
      shadowRoots: page.shadowRoots ?? 0,
    })
    await chrome.storage.local.set({ [QUEUE]: queued })
    // Global as well as per-tab: `setBadgeText` with a tabId sets it for THAT
    // tab only, so the count vanished the moment the posting was closed and
    // reappeared as a stale number on whatever tab had been captured before.
    // The queue is one thing, so the badge is one number.
    await chrome.action.setBadgeText({ text: String(queued.length) })
    await badge(tabId, String(queued.length), 'Saved — open jojo to file it')
  } catch (error) {
    await badge(tabId, '!', error instanceof Error ? error.message : String(error))
  }
}

/**
 * Turns every queued address into a `data:` URI, and empties what it cannot.
 *
 * The order matters: stylesheets are resolved first because their text names
 * further assets — a webfont or a background image reached only from inside a
 * CSS file — and those are queued as they are discovered rather than in a second
 * pass, so one loop covers both levels.
 *
 * Anything that fails, times out or exceeds the per-asset cap is replaced with
 * an empty value and counted. That is the whole reason the invariant holds
 * without trusting the network: a capture cannot end up with a live URL in it,
 * because the only two outcomes for an address are "inlined" and "gone".
 */
async function inline(page) {
  const resolved = new Map()
  let dropped = page.dropped ?? 0
  const assets = [...page.assets]

  /**
   * One entry per ADDRESS, beside the one-entry-per-token map above.
   *
   * Without this the same font embedded twice is base64-encoded twice, and that
   * is not a tidiness point — it was the whole reason a board failed. Measured
   * across ten live postings: every Lever page declares its webfonts in two
   * `<style>` blocks, so a capture carried 40 base64 payloads of which 19 were
   * distinct — 4.1 MB of pure duplication in a 9.3 MB file. All three Lever
   * tenants tested came out over `CAPTURE_MAX_BYTES` and were refused outright;
   * de-duped they land at 4.8–5.2 MB. Greenhouse and Ashby never repeat an
   * address, which is why the bug looked like "Lever pages are big".
   */
  const byHref = new Map()

  for (let i = 0; i < assets.length; i += 1) {
    const { href, kind } = assets[i]
    const key = `__JOJO_ASSET_${String(i)}__`

    const seen = byHref.get(href)
    if (seen !== undefined) {
      resolved.set(key, seen)
      continue
    }

    try {
      // Timed out rather than hung: the loop is sequential, so one CDN that never
      // answers leaves the badge on '…' with no route to recovery. The header
      // above already promised this; it was not implemented.
      const response = await fetch(href, {
        credentials: 'omit',
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)

      if (kind === 'css') {
        const text = await response.text()
        /*
         * Its own `@import`s FIRST, then its own `url()`s. Both become tokens
         * appended to the list this loop is walking, so they are fetched by a
         * later turn of it and one pass covers arbitrary nesting.
         *
         * The `@import` half was missing, and it was a live leak rather than a
         * missing nicety: the walk sanitises the imports it can see in the
         * page's own `<style>` blocks, but a stylesheet FETCHED here could carry
         * its own `@import "https://…"`, which passed through untouched, passed
         * `remoteRefCount` — which knew nothing about `@import` — and was
         * fetched by the viewer every time the capture was opened.
         */
        const withImports = text.replace(
          /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)[^;]*;?/gi,
          (whole, _q1, viaUrl, _q2, viaString) => {
            const raw = viaUrl ?? viaString ?? ''
            if (raw.trim().startsWith('data:')) return whole
            const nested = absolute(raw, href)
            if (nested === null) {
              dropped += 1
              return ''
            }
            const at = assets.length
            assets.push({ href: nested, kind: 'css' })
            return `__JOJO_ASSET_${String(at)}__`
          },
        )
        const inlinedCss = withImports.replace(
          /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
          (whole, _q, raw) => {
            const value = raw.trim()
            if (value.startsWith('__JOJO_ASSET_')) return whole
            if (value.startsWith('data:')) return whole
            // A same-document reference — `filter='url(#frameNoise)'` inside an
            // inline SVG. Resolving one produces a URL that never existed, which
            // is then fetched (404/403), counted as a dropped asset, and written
            // back as `url("")` — corrupting a data URI the pipeline had already
            // decided to keep. Measured on every Ashby posting.
            if (value.startsWith('#') || value.startsWith('%23')) return whole
            const nested = absolute(raw, href)
            if (nested === null) {
              dropped += 1
              return 'none'
            }
            const at = assets.length
            assets.push({ href: nested, kind: 'css-asset' })
            return `url("__JOJO_ASSET_${String(at)}__")`
          },
        )
        resolved.set(key, inlinedCss)
        byHref.set(href, inlinedCss)
        continue
      }

      const blob = await response.blob()
      if (blob.size > CAPTURE_MAX_ASSET_BYTES) throw new Error('asset too large')
      const uri = await dataUri(blob)
      resolved.set(key, uri)
      byHref.set(href, uri)
    } catch {
      dropped += 1
      resolved.set(key, '')
      // Remembered as a failure too, so a page naming a dead asset ten times
      // makes one request rather than ten.
      byHref.set(href, '')
    }
  }

  let html = page.html
  for (const [key, value] of resolved) html = html.split(key).join(value)

  // Anything the walk missed. A token left standing would render as literal
  // text, and a surviving http(s) address would be the one thing this must not
  // ship — so both are swept here rather than hoped about.
  html = html.replace(/__JOJO_ASSET_\d+__/g, '')
  // Anchored to `<[^>]*?`, so it can only match INSIDE a tag.
  //
  // Without that anchor this ran over the whole document string including text
  // nodes — and `outerHTML` does not escape `"` in text — so a posting whose
  // body reads `add <img src="https://…">` had its own prose rewritten to
  // `src=""` and counted as a dropped asset. `serialise.js` explains at length
  // that assets are tokenised precisely so a global string replace can never
  // corrupt a posting that quotes a URL; this is the line that was doing it.
  html = html.replace(
    /(<[^>]*?\s(?:src|srcset|imagesrcset|href|poster|data|action|formaction|background)\s*=\s*)(["'])\s*(?:https?:|\/\/)[^"']*\2/gi,
    (_whole, head, quote) => {
      dropped += 1
      return `${head}${quote}${quote}`
    },
  )

  return { html, dropped }
}

function absolute(value, base) {
  try {
    const url = new URL(value, base)
    return CAPTURE_SCHEMES.includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function dataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('unreadable asset'))
    reader.readAsDataURL(blob)
  })
}

function byteLength(text) {
  return new TextEncoder().encode(text).length
}

async function read() {
  const stored = await chrome.storage.local.get(QUEUE)
  return Array.isArray(stored[QUEUE]) ? stored[QUEUE] : []
}

async function badge(tabId, text, title) {
  await chrome.action.setBadgeText({ tabId, text })
  if (title !== undefined) await chrome.action.setTitle({ tabId, title })
}

/**
 * The jojo tab asking for what has been captured.
 *
 * `bridge.js` is the only sender — it is a content script on jojo's own origins
 * — and it relays through `window.postMessage`, so the app never needs to know
 * the extension's id. That matters more than it looks: an unpacked extension
 * gets a fresh id on every load, and a delivery path keyed on the id would work
 * for a published build and for nobody developing against it.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'jojo:take-captures') {
    void (async () => {
      // Handed over, NOT deleted.
      //
      // Emptying the queue here was a real loss: jojo validates every envelope
      // through `readCapture` after receiving it, and a capture it refuses was
      // already gone — the user saw "could not be kept" with nothing left to
      // retry and no way to find out why. The queue now shrinks only on
      // `jojo:ack-captures`, which names the ids that were actually filed.
      const queued = await read()
      sendResponse({ captures: queued })
    })()
    return true // the response is async
  }
  if (message?.type === 'jojo:ack-captures') {
    void (async () => {
      const kept = new Set(Array.isArray(message.ids) ? message.ids : [])
      const queued = await read()
      const left = queued.filter((c) => !kept.has(c.id))
      await chrome.storage.local.set({ [QUEUE]: left })
      const text = left.length > 0 ? String(left.length) : ''
      await chrome.action.setBadgeText({ text })
      // The per-tab overrides set at capture time survive a global write, so
      // they are cleared explicitly — otherwise a filed capture goes on being
      // counted on the tab it came from.
      const tabs = await chrome.tabs.query({})
      await Promise.all(
        tabs.map((tab) =>
          typeof tab.id === 'number'
            ? chrome.action.setBadgeText({ tabId: tab.id, text }).catch(() => undefined)
            : undefined,
        ),
      )
      sendResponse({ remaining: left.length })
    })()
    return true
  }
  if (message?.type === 'jojo:peek-captures') {
    void read().then((queued) => sendResponse({ count: queued.length }))
    return true
  }
  /*
   * The one verb the app initiates rather than drains.
   *
   * Every other message here asks about a queue a human gesture filled. This one
   * asks the extension to go and do something, which is a different kind of
   * permission entirely — so it is bounded on both sides: the sender is a content
   * script on jojo's own origin (the manifest's `matches` sees to that), and the
   * only thing it can ask for is one page opened and read.
   */
  if (message?.type === 'jojo:scan-board') {
    void (async () => {
      const url = typeof message.url === 'string' ? message.url : ''
      if (!/^https?:\/\//i.test(url)) {
        sendResponse({ ok: false, reason: 'That is not an address I can open.' })
        return
      }
      sendResponse(await scanBoard(url))
    })()
    return true
  }
  return false
})
