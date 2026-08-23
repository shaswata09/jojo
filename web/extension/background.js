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
        // Its own url()s become tokens appended to the list this loop is
        // walking, so they are fetched by a later turn of the same loop.
        const inlinedCss = text.replace(
          /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
          (whole, _q, raw) => {
            const value = raw.trim()
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
      await chrome.action.setBadgeText({ text: left.length > 0 ? String(left.length) : '' })
      sendResponse({ remaining: left.length })
    })()
    return true
  }
  if (message?.type === 'jojo:peek-captures') {
    void read().then((queued) => sendResponse({ count: queued.length }))
    return true
  }
  return false
})
