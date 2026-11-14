/**
 * The asset loop: every address the serialiser queued, fetched under the
 * extension's host permissions and turned into a `data:` URI, or emptied.
 */

import { CAPTURE_MAX_ASSET_BYTES } from '../policy.js'
import { rewriteSheet } from './inline-css.js'
import { dropStrayTokens, spliceTokens, sweepRemoteRefs } from './splice.js'
import { isLocalTarget } from './targets.js'
import { byteLength } from './util.js'

/**
 * The most addresses one capture will ever fetch.
 *
 * The loop below walks a list ITS OWN BODY APPENDS TO: a fetched stylesheet's
 * `@import`s and `url()`s are queued as they are discovered, and each of those
 * is a stylesheet that can queue more. `byHref` only collapses repeats of the
 * same address, so a page whose sheets import two FRESH ones apiece has no end
 * — and unbounded here means a service worker fetching forever with the badge
 * stuck on '…', no error, and nothing the user can do but disable the
 * extension. (The deadline `inline` now takes bounds the time too; this bounds
 * the count, which a deadline alone would let run to hundreds of requests.)
 *
 * Set far above what a real posting needs — the widest board measured while the
 * de-duplication above was written queued 47 addresses — and far below forever.
 * Everything past it is counted as dropped, which is the same outcome an asset
 * that failed to fetch already has.
 *
 * Restated rather than imported. The owner is `CAPTURE_MAX_ASSETS` in
 * `service/kg/core/capture.ts`, which the phone's inliner reads directly; this
 * file can only reach the package through `policy.js`, whose drift test does not
 * carry this constant. Two copies, one owner — change them together.
 */
const CAPTURE_MAX_ASSETS = 500

/**
 * How many assets are fetched at once. The loop was sequential, so a page with
 * 200 assets on a slow CDN spent minutes on what a browser does in seconds —
 * AcademicCareers measured past the page's 90-second budget and was not kept.
 * Six is a browser's own per-host connection limit.
 */
const INLINE_CONCURRENCY = 6

/** The per-asset timeout. A CDN that never answers costs this, never more. */
const ASSET_TIMEOUT_MS = 15000

/**
 * A capture's random token prefix, minted per capture by the worker.
 *
 * The prefix used to be the constant `__JOJO_ASSET_`, which a page could simply
 * WRITE: put `__JOJO_ASSET_3__` in an attribute, and the splice below replaced
 * it with asset 3's value — a fetched stylesheet whose `"` closed the attribute
 * and wrote `onload=` into the saved file, which runs when the person opens the
 * download. With a nonce the page cannot know, every token in the document is
 * one this capture put there. Page-written look-alikes are left as the text
 * they are rather than stripped: removing one from `__JOJO_ASSET_0__onerror=`
 * would itself write `onerror=`.
 */
export function captureNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A promise that gives up after `ms`, whatever the thing it waits on does. */
function within(promise, ms) {
  let timer
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), Math.max(0, ms))
    }),
  ]).finally(() => clearTimeout(timer))
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
 *
 * `deadline` is a `Date.now()` time by which inlining STOPS — not fails. What
 * has been fetched by then is kept, everything else is counted into `dropped`
 * and emptied by the sweep at the end exactly as a failed fetch is, and the
 * page is still kept. "From link" was refused whole at the page's 90 seconds on
 * a heavy board; a posting missing some fonts is worth keeping, and no posting
 * is not.
 */
export async function inline(page, nonce, deadline = Date.now() + 120000) {
  const prefix = `__JOJO_ASSET_${nonce}_`
  const keyOf = (index) => `${prefix}${String(index)}__`
  /** One value per token INDEX — spliced in index order, see `spliceTokens`. */
  const resolved = []
  /** Which resolved values are stylesheet TEXT. See `spliceTokens`. */
  const cssKeys = new Set()
  let dropped = page.dropped ?? 0
  const assets = [...page.assets]

  /** Queues a nested address found inside a fetched stylesheet; returns its token. */
  const queue = (href, kind) => {
    const at = assets.length
    assets.push({ href, kind })
    return keyOf(at)
  }

  /*
   * Whether this page may pull assets off this machine or the person's network.
   *
   * A posting on the public web may NOT: this fetch runs with the extension's
   * host permissions, so `<link href=http://127.0.0.1:3001/…>` — or a public
   * address that 302s there — had the local service's answer spliced into the
   * capture and handed to whatever reads it. Measured with a router-style
   * `/secret` on loopback: its body came back inside the stored page.
   *
   * A page that is itself local — the person capturing their own intranet
   * posting from the tab they are looking at — keeps its local assets: it
   * names nothing the person was not already shown.
   */
  // Only a real http(s) address counts: `isLocalTarget` says yes to anything it
  // cannot parse, and a page with no usable `url` must not unlock this.
  const localPage = typeof page.url === 'string' && /^https?:\/\//i.test(page.url) && isLocalTarget(page.url)

  const sheets = {
    prefix,
    queue,
    drop: () => {
      dropped += 1
    },
  }
  const fetchOne = (href, kind) => fetchAsset(href, kind, { deadline, localPage, sheets })
  const claimed = await resolveAll(assets, { fetchOne, deadline, resolved, cssKeys, drop: sheets.drop })

  // Counted, not silently truncated: `dropped` is what the panel shows and what
  // tells somebody their capture is missing pieces. Past the asset cap or past
  // the deadline alike, the tokens left are emptied by the sweep below, exactly
  // as a failed fetch's would be, so the "inlined or gone" invariant holds.
  dropped += assets.length - claimed

  const html = dropStrayTokens(spliceTokens(page.html, resolved, cssKeys, keyOf), prefix)
  const swept = sweepRemoteRefs(html)
  return { html: swept.html, dropped: dropped + swept.dropped }
}

/**
 * Every queued address fetched into `resolved`, one value per token index — a
 * few at a time, inside the deadline and the asset cap. Returns how many were
 * claimed; the rest were never started.
 */
async function resolveAll(assets, { fetchOne, deadline, resolved, cssKeys, drop }) {
  /**
   * One entry per ADDRESS, beside the one-entry-per-token `resolved`.
   *
   * Without this the same font embedded twice is base64-encoded twice, and that
   * is not a tidiness point — it was the whole reason a board failed. Measured
   * across ten live postings: every Lever page declares its webfonts in two
   * `<style>` blocks, so a capture carried 40 base64 payloads of which 19 were
   * distinct — 4.1 MB of pure duplication in a 9.3 MB file. All three Lever
   * tenants tested came out over `CAPTURE_MAX_BYTES` and were refused outright;
   * de-duped they land at 4.8–5.2 MB. Greenhouse and Ashby never repeat an
   * address, which is why the bug looked like "Lever pages are big".
   *
   * Holds the PROMISE of a value, so two workers reaching one address at once
   * share one fetch rather than racing two.
   */
  const byHref = new Map()

  let claimed = 0
  const work = async () => {
    for (;;) {
      if (Date.now() >= deadline) return
      if (claimed >= assets.length || claimed >= CAPTURE_MAX_ASSETS) return
      const i = claimed
      claimed += 1
      const { href, kind } = assets[i]

      /*
       * Keyed by KIND as well as address, and `cssKeys` recorded on every path.
       *
       * `serialise.js` mints a token per OCCURRENCE with no de-duplication of
       * its own, so two identical `<link rel=stylesheet>` tags — or a `<link>`
       * and an `@import` of the same sheet — produce two tokens for one address.
       * The shared-value path once skipped `cssKeys.add`, so the splice escaped
       * the FIRST occurrence and spliced the second one raw. Measured end to
       * end: with a sheet answering `}</style><img alt="a > b"
       * src=https://evil.example/…>`, the stored capture carried the first copy
       * escaped and the second as a live `<img>`, and `remoteRefCount` returned
       * 0. Escaping decided by which turn of the loop fetched an address first
       * is not escaping.
       *
       * The kind is in the key because it decides the escape and the value is
       * not interchangeable between kinds: the same address wanted as `css`
       * (text) and as `css-asset` (a data URI inside `url()`) must not hand one
       * form of the value to the other.
       */
      if (kind === 'css') cssKeys.add(i)
      const cacheKey = `${kind}\u0000${href}`
      let pending = byHref.get(cacheKey)
      if (pending === undefined) {
        pending = fetchOne(href, kind).then(
          (value) => ({ value }),
          // Remembered as a failure too, so a page naming a dead asset ten times
          // makes one request rather than ten.
          () => ({ value: '', failed: true }),
        )
        byHref.set(cacheKey, pending)
      }
      const outcome = await pending
      if (outcome.failed) drop()
      resolved[i] = outcome.value
    }
  }
  /*
   * A few workers draining one list that the stylesheets keep appending to. A
   * worker that finds the list momentarily empty while another is still
   * fetching a sheet stops early, so the pool is re-run until a pass claims
   * nothing new — which is at most once per nesting level.
   */
  for (let before = -1; before !== claimed; ) {
    before = claimed
    await Promise.all(Array.from({ length: INLINE_CONCURRENCY }, work))
  }
  return claimed
}

/** One address, fetched within what is left of the deadline. */
async function fetchAsset(href, kind, { deadline, localPage, sheets }) {
  const left = Math.min(ASSET_TIMEOUT_MS, deadline - Date.now())
  if (left <= 0) throw new Error('out of time')
  if (!localPage && isLocalTarget(href)) throw new Error('a local address')
  // Timed out rather than hung — by the signal for a real fetch, and by the
  // race for everything after it, since a body can stall as well.
  //
  // Redirects are followed, and the place they END is judged below. A worker
  // cannot judge each hop: `redirect: 'manual'` hands back an opaque response
  // with no Location to read, so there is no next hop to check. What the
  // final check guarantees is that a body from this machine or the LAN is
  // never READ into a capture; an intermediate hop there is a blind GET whose
  // answer is discarded. A public name that resolves to a private address
  // (DNS rebinding) is out of reach for the reason `isLocalTarget` gives.
  const response = await within(
    fetch(href, { credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(left) }),
    left,
  )
  if (!localPage && typeof response.url === 'string' && response.url !== '' && isLocalTarget(response.url)) {
    throw new Error('redirected to a local address')
  }
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  if (kind === 'css') {
    const text = await within(response.text(), deadline - Date.now())
    // The same cap the blob branch below applies, which this branch reached
    // its return without ever meeting: a stylesheet is the one asset whose
    // bytes are kept as TEXT, so an enormous one was inlined whole into a
    // document that is itself capped, and the whole capture was then refused
    // for being too large with no clue which asset did it.
    if (byteLength(text) > CAPTURE_MAX_ASSET_BYTES) throw new Error('stylesheet too large')
    return rewriteSheet(text, href, sheets)
  }
  const blob = await within(response.blob(), deadline - Date.now())
  if (blob.size > CAPTURE_MAX_ASSET_BYTES) throw new Error('asset too large')
  return dataUri(blob)
}

function dataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('unreadable asset'))
    reader.readAsDataURL(blob)
  })
}
