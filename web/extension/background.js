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

import { expandListing, harvest } from './harvest.js'
import { serialise } from './serialise.js'
import { shrinkToFit } from './shrink.js'
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
  MODEL_HOSTS,
} from './policy.js'

const QUEUE = 'jojo.captures'

/**
 * Which relays are switched on, and where the reader lives.
 *
 * Two relays leave this machine's control in different ways, so they are two
 * switches rather than one: the READER hop stays on loopback and is the private
 * option; the MODEL hop goes to a named provider on the internet and is billed.
 * Somebody who wants the reader and not the cloud can have exactly that, and
 * the popup is where they say so.
 *
 * Per PROVIDER rather than one flag for all of them, because the providers are
 * not interchangeable to the person paying: a key for one is not a key for
 * another, and "route to NVIDIA but not to OpenAI" is a real preference.
 *
 * Absent means ON for the reader and the named providers. An extension that
 * arrives switched off looks broken, and the failure — a relay that refuses —
 * reads exactly like the bug this whole file exists to work around. Defaults
 * live in `defaultRouting`.
 *
 * `network` — models on the person's own network — is the exception, and is
 * OFF until they turn it on. The other routes each go to one named place; this
 * one goes to any private address a page names, which is a page reaching the
 * person's router, printer and NAS through their browser. Nothing a page sends
 * can switch it on (a script on jojo's origin could send the same thing), so
 * only the popup can: one press, named in the refusal the first time a model on
 * the network is asked for.
 */
const ROUTING = 'jojo.routing'

const READER_DEFAULT = 'http://127.0.0.1:3001/mcp'

function defaultRouting() {
  return {
    reader: { enabled: true, endpoint: READER_DEFAULT },
    models: Object.fromEntries(MODEL_HOSTS.map((host) => [host, true])),
    network: false,
  }
}

async function routing() {
  const stored = await chrome.storage.local.get(ROUTING)
  const saved = stored[ROUTING]
  const base = defaultRouting()
  if (!saved || typeof saved !== 'object') return base
  return {
    reader: {
      enabled: saved.reader?.enabled !== false,
      endpoint:
        typeof saved.reader?.endpoint === 'string' && saved.reader.endpoint.trim()
          ? saved.reader.endpoint.trim()
          : READER_DEFAULT,
    },
    // Rebuilt from MODEL_HOSTS rather than trusted wholesale, so a provider
    // added to the allowlist appears switched on instead of missing, and one
    // removed from it cannot linger in storage as a route that no longer exists.
    models: Object.fromEntries(MODEL_HOSTS.map((host) => [host, saved.models?.[host] !== false])),
    // `=== true`: absent is OFF here, unlike every switch above. See ROUTING.
    network: saved.network === true,
  }
}

const POLICY = {
  CAPTURE_STRIP_TAGS,
  CAPTURE_STRIP_ATTRS,
  CAPTURE_URL_ATTRS,
  CAPTURE_HREF_ATTR,
  CAPTURE_SCHEMES,
  CAPTURE_LAZY_ATTRS,
  CAPTURE_UNCLAMP_ATTR,
}

/* ------------------------------- installing -------------------------------- */

/**
 * Injects the bridge into jojo tabs that were ALREADY OPEN.
 *
 * A content script listed in the manifest runs on navigation. It does not run
 * retroactively, so the tab somebody installed the extension from — which is
 * jojo's own Settings page, every time, because that is where the installer
 * lives — has no bridge in it and no way to get one except a reload.
 *
 * That is the whole of "MarkItDown does not show connected until you refresh".
 * Nothing was broken: the page was asking a relay that had never been injected
 * into it, correctly getting no answer, and correctly reporting that.
 *
 * The patterns are read out of the manifest rather than repeated here, so the
 * list of ports this app runs on has one owner. Failures are swallowed per tab:
 * a tab that has since navigated away, or a restricted page, is not an error —
 * it is a tab that does not need one.
 */
async function injectIntoOpenTabs() {
  const scripts = chrome.runtime.getManifest().content_scripts ?? []
  for (const entry of scripts) {
    const matches = entry.matches ?? []
    if (matches.length === 0) continue
    let tabs = []
    try {
      tabs = await chrome.tabs.query({ url: matches })
    } catch {
      continue
    }
    for (const tab of tabs) {
      if (typeof tab.id !== 'number') continue
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: entry.js ?? [] })
      } catch {
        // Already injected, navigated away, or not scriptable. All fine.
      }
    }
  }
}

// `onInstalled` also fires on update and on a reload of an unpacked extension,
// which is exactly when a developer needs this too.
chrome.runtime.onInstalled.addListener(() => {
  void injectIntoOpenTabs()
})

/* ------------------------------ reading docs ------------------------------- */

/**
 * Is this an address on this machine?
 *
 * Parsed rather than pattern-matched on the string, because `http://127.0.0.1@evil.example.com/`
 * passes a naive `startsWith` and is a request to evil.example.com. `URL` puts
 * the real host in `hostname`, where a check means what it looks like.
 *
 * `http` only: there is no https story for a loopback server without a
 * certificate, and allowing it here would suggest there is.
 */
function isLoopback(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  const host = url.hostname
  // The bracketed form is what `URL` gives back for IPv6.
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
}

/**
 * Whether two loopback addresses are the same SERVER: same port, any of the
 * three loopback spellings. Not `origin` equality — `localhost` and `127.0.0.1`
 * are one listener, and somebody who typed one in Settings and the other in the
 * popup should not be refused for it.
 */
function sameLoopbackServer(a, b) {
  if (!isLoopback(a) || !isLoopback(b)) return false
  const port = (raw) => {
    const url = new URL(raw)
    return url.port === '' ? '80' : url.port
  }
  return port(a) === port(b)
}

/**
 * jojo-bridge's port — `DEFAULT_PORT` in `jojo-bridge.mjs`, and the one the
 * page dials (`BRIDGE_ADDRESS` in `web/src/lib/mcp-link.ts`). The link is
 * pinned to it: without a pin, `jojo:mcp-link` relayed any request to any port
 * on this machine, so a page could drive every local dev server and database
 * console the person had running.
 */
const JOJO_BRIDGE_ADDRESS = 'http://127.0.0.1:3002'

/**
 * A machine on the person's OWN network, reached over plain http.
 *
 * ## Why this exists
 *
 * The relay allowed loopback and five hosted providers. That is right for a
 * model running on the same machine and right for a paid API, and it leaves out
 * the case this app is most often actually used in: a model server on another
 * box on the same network — a workstation with the GPU, a homelab, a lab
 * subnet — reached from a copy of jojo served over https, where the browser
 * forbids the page from making that call itself.
 *
 * Reported from exactly that setup: GitHub Pages over https, vLLM at
 * `http://10.116.34.124:8103/v1`. The page cannot reach it (mixed content) and
 * the relay refused it (not loopback, not a known provider), so the address was
 * unusable by any route while the error text suggested installing the extension
 * that was already refusing it.
 *
 * ## Why this is not an open proxy
 *
 * Only ranges that are unroutable on the public internet, and only over http:
 *
 *   - RFC 1918 private space: 10/8, 172.16/12, 192.168/16
 *   - RFC 3927 link-local: 169.254/16
 *   - RFC 4193 IPv6 unique-local (fc00::/7) and IPv6 link-local (fe80::/10)
 *   - `.local`, which is mDNS
 *
 * A public address over http is still refused — relaying one would make this
 * extension a way for any page to launder a request through the user's browser
 * to somewhere on the internet, which is the thing the list was protecting
 * against. A private address can only reach hardware the person already has
 * access to from where they are sitting.
 *
 * The user-facing consequence is worth stating plainly: with the extension
 * installed and "Models on my network" switched on, a page can ask it to fetch
 * from the user's own LAN. That switch is OFF until the person turns it on in
 * the popup — an earlier version of this comment said the per-provider switches
 * already turned it off, and they could not: they are keyed by the hosted
 * providers' names, so `10.0.0.5` had no switch at all. `modelRefusal` reads
 * `routing().network`.
 */
function isPrivateNetwork(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  return privateHost(url.hostname)
}

/**
 * Whether a hostname is on a private network: RFC 1918, link-local, IPv6
 * unique-local and link-local, and mDNS. Loopback is NOT included — it is
 * `isLoopback`'s question — and the hostname is as `URL` normalised it, so
 * `http://0xa.1/` has already become `10.0.0.1` by the time it arrives.
 */
function privateHost(hostname) {
  const host = String(hostname).replace(/^\[|\]$/g, '').toLowerCase()

  if (host.endsWith('.local')) return true

  if (host.includes(':')) {
    // An IPv4 address written as IPv6 (`::ffff:a00:1`) is that IPv4 address.
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
    if (mapped) {
      const hi = parseInt(mapped[1], 16)
      const lo = parseInt(mapped[2], 16)
      return privateHost(`${String(hi >> 8)}.${String(hi & 255)}.${String(lo >> 8)}.${String(lo & 255)}`)
    }
    // IPv6 unique-local and link-local.
    return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)
  }

  const parts = host.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1))
  if (octets.some((n) => n < 0 || n > 255)) return false
  const [a, b] = octets
  if (a === 10) return true
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  return false
}

/**
 * Whether an address is this machine or the person's own network, by ANY scheme.
 *
 * The scan and "From link" open a tab with the person's cookies and hand the
 * whole rendered DOM back to the page that asked. Pointed at a router's admin
 * page, a NAS, or a dev server on this machine, that is a page reading the
 * person's intranet through their own browser — so those two verbs refuse it,
 * before the tab opens and again after any redirect. A posting is on the public
 * web; nobody's job advert lives at 192.168.1.1.
 *
 * Hostname-only. A public name that RESOLVES to a private address passes, and a
 * worker cannot see DNS answers to close that; `privateHost` closes every
 * literal spelling.
 */
function isLocalTarget(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return true
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '::' || host === '0.0.0.0' || /^127\./.test(host) || /^0\./.test(host)) return true
  if (/^::ffff:7f[0-9a-f]{2}:/.test(host)) return true
  if (host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return true
  return privateHost(host)
}

/**
 * The port name the streaming model relay answers on.
 *
 * Shared with `bridge.js`; a mismatch is a silent no-op rather than an
 * error, because `onConnect` simply never fires for a name nobody listens
 * for — which is why it is a named constant on both sides.
 */
const MODEL_STREAM_PORT = 'jojo:model-stream'

/**
 * How long the far end gets, reader or model provider. Converting a large PDF is
 * genuinely slow, and so is a 70B model composing a first token.
 *
 * The PAGE has to be willing to wait at least this long, and for most of this
 * constant's life it was not: `capture-bridge.ts` gave the same request the
 * scan's 40 seconds, so a conversion this worker finished at 55 had already been
 * abandoned at the other end and reported as "the extension did not answer" —
 * and the answer, when it came, was posted into a closed channel. Reads do not
 * stream, so nothing re-armed that timer.
 *
 * `RELAY_TIMEOUT_MS` over there is now a transcription of this number with a
 * margin, and `reader-relay.test.ts` fails if the two drift. Whichever end gives
 * up first writes the sentence the user reads, and it should be this one: it
 * knows what was being called and for how long.
 */
const READ_TIMEOUT_MS = 120000

/**
 * The only methods any relay carries. Every request jojo makes through one is a
 * GET (a model list, the link's poll) or a POST (a completion, an MCP call);
 * anything else a page asks for is a verb jojo never sends, aimed at a server
 * that would act on it.
 */
const RELAY_METHODS = ['GET', 'POST']

/** The method to send, or null when it is not one a relay carries. */
function relayMethod(request) {
  const method = typeof request?.method === 'string' ? request.method.trim().toUpperCase() : 'POST'
  return RELAY_METHODS.includes(method) ? method : null
}

/**
 * A model provider jojo knows about, over https.
 *
 * Several of them send no CORS headers — measured against
 * `integrate.api.nvidia.com`, whose preflight answers 200 with `vary: Origin`
 * and no `access-control-allow-origin`, so the browser blocks the real request
 * and the page reports a bare "Failed to fetch". The extension is not a page and
 * is not subject to that.
 *
 * An allowlist rather than "any https", for the same reason `isLoopback` exists:
 * this relays a request the page composed using the extension's own permissions,
 * and without a list any script on jojo's origin could read any site on the web
 * through it. `MODEL_HOSTS` is transcribed from the provider table and the gate
 * checks the transcription.
 *
 * Exact host match, not a suffix test: `endsWith('openai.com')` also accepts
 * `evil-openai.com`, which is how allowlists usually fail.
 */
function isKnownModelHost(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  return MODEL_HOSTS.includes(url.hostname)
}

/**
 * One request to the reader, relayed verbatim.
 *
 * The page owns the MCP protocol — the handshake, the JSON-RPC envelope, the
 * session header — and this owns only the hop. Keeping the split there means
 * the protocol stays in `@jojo/service/agent/markitdown`, where it is tested,
 * instead of being half-reimplemented in an extension nothing can test.
 *
 * The answer comes back as `{ ok, status, text }`, the same shape the page's own
 * transport returns, so the caller cannot tell which route was taken.
 */
async function relay(request, what) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, READ_TIMEOUT_MS)
  const method = relayMethod(request)
  if (method === null) {
    clearTimeout(timer)
    return {
      ok: false,
      status: 0,
      text: '',
      reason: `The extension relays GET and POST only, so the ${what} was not called.`,
    }
  }
  // A GET may not carry one, and `fetch` throws rather than ignoring it:
  // "Request with GET/HEAD method cannot have body". The model list is a GET.
  const sendsBody = method !== 'GET'
  try {
    const response = await fetch(request.url, {
      method,
      headers: request.headers && typeof request.headers === 'object' ? request.headers : {},
      ...(sendsBody && typeof request.body === 'string' && request.body !== ''
        ? { body: request.body }
        : {}),
      signal: controller.signal,
      // Same rule as the page's transport: a loopback server shares an origin
      // policy with nothing, and credentials it never asked for are how a local
      // request stops being local.
      credentials: 'omit',
    })
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text().catch(() => ''),
    }
  } catch (error) {
    const aborted = error && error.name === 'AbortError'
    /*
     * NOTHING IS RECORDED HERE, and the absence is the fix.
     *
     * This called `recordExtensionCrash`, which is defined nowhere — not in this
     * file, not in the repo. So the commonest failure this function has, a
     * reader that was never started, threw `ReferenceError` out of the catch
     * before reaching the return below: `sendResponse` was never called, the
     * message channel closed, and the page showed Chrome's "message port closed
     * before a response was received" instead. Every sentence written in this
     * function was dead code, including the one naming which thing was called.
     *
     * The failure does reach the person, by the only route a service worker has
     * to them: the `reason` below crosses the bridge and is shown. A worker's
     * own crash log — what the recorder was meant to be — needs the
     * `jojo:crash-reporting` handler that `bridge.js` already forwards to and
     * this worker does not implement; when that lands, it goes here.
     */
    return {
      ok: false,
      status: 0,
      text: '',
      // Named by what was being called. This said "the reader" for everything,
      // so a failed model request reported a document reader that was not
      // involved — two wrong nouns in one sentence about a third thing.
      reason: aborted
        ? `The ${what} did not answer within ${String(READ_TIMEOUT_MS / 1000)} seconds.`
        : `Could not reach the ${what} at ${request.url} — ${String(error && error.message ? error.message : error)}.`,
    }
  } finally {
    clearTimeout(timer)
  }
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
 * "Load more": at most this many presses, each waiting up to `MORE_WAIT_MS` for
 * the list to grow, all of it inside `MORE_BUDGET_MS`. Ten seconds on top of
 * the settle keeps a scan inside the page's 40s budget even after a slow 25s
 * load, and on AcademicCareers (≈1.2s a press, 20 jobs each) it is five more
 * screenfuls than the one a person sees on arrival.
 */
const MORE_ROUNDS = 6
const MORE_WAIT_MS = 3500
const MORE_BUDGET_MS = 10000

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

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * The same board, give or take `www.` and its own subdomains — in either
 * direction, since a board may redirect up (`www.` dropped) as well as down.
 * The package's `sameSite` (`core/board.ts`) is the one rule; this is the
 * worker's copy of it, kept to the same three cases.
 */
function sameSite(a, b) {
  if (!a || !b) return false
  const bare = (h) => h.replace(/^www\./, '')
  return bare(a) === bare(b) || a.endsWith(`.${bare(b)}`) || b.endsWith(`.${bare(a)}`)
}

/**
 * Whether a redirect landed on an account page rather than a posting.
 *
 * Only a page it was SENT to counts — the address asked for is never judged, so
 * a posting whose own path happens to say "auth" is not refused — and only one
 * that looks like a sign-in. `scanBoard` refuses any change of host, which is
 * right for a board and wrong here: a careers page handing over to the tracking
 * system that hosts its listings (careers.acme.com → boards.greenhouse.io) is
 * the ordinary shape of a posting link. The host alone is not enough either,
 * because the commonest wall is on the same one: LinkedIn sends a signed-out
 * reader of /jobs/view to /authwall.
 */
const SIGN_IN = /(^|[./-])(log-?in|sign-?in|sso|auth|authwall|accounts?|checkpoint)([./-]|$)/i

function looksLikeSignIn(requested, landed) {
  if (landed === requested) return false
  try {
    const at = new URL(landed)
    return SIGN_IN.test(`${at.hostname}${at.pathname}`)
  } catch {
    return false
  }
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
const CAPTURE_PAGE_INLINE_BY_MS = 65000

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
async function capturePage(url) {
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
    // A public address that redirects onto this machine or the LAN is refused
    // here, after the redirect — the address asked for was checked before.
    if (typeof landed.url === 'string' && isLocalTarget(landed.url)) {
      return {
        ok: false,
        reason: 'That page sent us to an address on this machine or your own network, so it was not kept.',
      }
    }
    if (typeof landed.url === 'string' && looksLikeSignIn(url, landed.url)) {
      return {
        ok: false,
        reason: `That page sent us to ${hostOf(landed.url)} to sign in. Open the posting in a tab and sign in, then try again.`,
      }
    }

    const nonce = captureNonce()
    const [run] = await chrome.scripting.executeScript({
      target: { tabId },
      func: serialise,
      args: [POLICY, nonce],
    })
    const page = run?.result

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

async function capture(tabId) {
  await badge(tabId, '…')
  try {
    const nonce = captureNonce()
    const [run] = await chrome.scripting.executeScript({
      target: { tabId },
      func: serialise,
      args: [POLICY, nonce],
    })
    const page = run?.result
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

    // Inside the queue lock: see `withQueue`.
    const { queued, id } = await withQueue(async () => {
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

/**
 * Fetched stylesheet text, made unable to close the element it is spliced into.
 *
 * See the call site. `<` is the only character that can end a `<style>` block,
 * and `\3c ` is its CSS escape — the trailing space is part of the escape and
 * is consumed by the CSS parser, so a rule that genuinely contained `<` renders
 * identically.
 *
 * `<` ALONE is enough only while a `css` token is always inside a `<style>`
 * element, and that is now a rule with a keeper rather than an assumption:
 * `serialise.js` drops an `@import` found in a style ATTRIBUTE instead of
 * tokenising it, which was the one path that put stylesheet text inside a
 * quoted attribute value. Measured while it did: a sheet answering
 * `a{content:"x"}" onload="alert(1)" background="https://…` closed the
 * attribute and wrote a handler and a live address into the archive, because
 * neither `"` nor `'` is escaped here. Widening the escape instead would have
 * mangled `[type="text"]` in every real stylesheet, so the invariant is held at
 * the source. If a third tokenisation path is ever added, it belongs in a
 * `<style>` or it does not get a `css` kind.
 */
const cssSafe = (css) => css.replace(/</g, '\\3c ')

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
function captureNonce() {
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

/** A CSS string's escapes decoded, so the URL resolved is the URL the parser reads. */
function cssUnescape(text) {
  return text
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\r\n\f]?/g, (_w, hex) => {
      const code = parseInt(hex, 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�'
    })
    .replace(/\\\r\n|\\[\n\r\f]/g, '')
    .replace(/\\([\s\S])/g, '$1')
}

/**
 * A quoted CSS string, `"…"` or `'…'`, with its escapes — and so with the OTHER
 * quote and a `)` allowed inside it. The tokenisers used `([^'")]+)`, which
 * stopped at the first `)` or quote of either kind: `url("https://x/a)b.png")`
 * failed to match at all, was never tokenised, and loaded on view.
 */
const CSS_DQ = String.raw`"((?:[^"\\\n]|\\[\s\S])*)"`
const CSS_SQ = String.raw`'((?:[^'\\\n]|\\[\s\S])*)'`
const CSS_URL = new RegExp(String.raw`url\(\s*(?:${CSS_DQ}|${CSS_SQ}|((?:[^'"()\\\s]|\\[\s\S])*))\s*\)`, 'gi')
const CSS_IMPORT = new RegExp(
  String.raw`@import\s*(?:url\(\s*(?:${CSS_DQ}|${CSS_SQ}|((?:[^'"()\\\s]|\\[\s\S])*))\s*\)|${CSS_DQ}|${CSS_SQ})[^;]*;?`,
  'gi',
)
const CSS_IMAGE_SET = new RegExp(
  String.raw`(image-set\()((?:[^()"']|"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'|\([^()]*\))*)\)`,
  'gi',
)
const CSS_IMAGE_SET_PIECE = new RegExp(String.raw`\([^()]*\)|${CSS_DQ}|${CSS_SQ}`, 'gi')

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
async function inline(page, nonce, deadline = Date.now() + 120000) {
  const prefix = `__JOJO_ASSET_${nonce}_`
  const keyOf = (index) => `${prefix}${String(index)}__`
  /** One value per token INDEX — spliced in index order, see below. */
  const resolved = []
  /** Which resolved values are stylesheet TEXT. See the splice below. */
  const cssKeys = new Set()
  let dropped = page.dropped ?? 0
  const assets = [...page.assets]

  /**
   * One entry per ADDRESS, beside the one-entry-per-token list above.
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

  /** Queues a nested address found inside a fetched stylesheet; returns its token. */
  const queue = (href, kind) => {
    const at = assets.length
    assets.push({ href, kind })
    return keyOf(at)
  }

  /** A fetched stylesheet's own `@import`s, `url()`s and `image-set()` strings, tokenised. */
  const rewriteSheet = (text, href) => {
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
    const withImports = text.replace(CSS_IMPORT, (whole, u1, u2, u3, s1, s2) => {
      const raw = cssUnescape(u1 ?? u2 ?? u3 ?? s1 ?? s2 ?? '')
      if (raw.trim().startsWith('data:')) return whole
      const nested = absolute(raw.trim(), href)
      if (nested === null) {
        dropped += 1
        return ''
      }
      return queue(nested, 'css')
    })
    const inlinedCss = withImports.replace(CSS_URL, (whole, dq, sq, bare) => {
      const value = cssUnescape(dq ?? sq ?? bare ?? '').trim()
      if (value.startsWith(prefix)) return whole
      if (value.startsWith('data:')) return whole
      // A same-document reference — `filter='url(#frameNoise)'` inside an
      // inline SVG. Resolving one produces a URL that never existed, which
      // is then fetched (404/403), counted as a dropped asset, and written
      // back as `url("")` — corrupting a data URI the pipeline had already
      // decided to keep. Measured on every Ashby posting.
      if (value.startsWith('#') || value.startsWith('%23')) return whole
      const nested = absolute(value, href)
      if (nested === null) {
        dropped += 1
        return 'none'
      }
      return `url("${queue(nested, 'css-asset')}")`
    })
    /*
     * `image-set()`, whose URL can be a BARE STRING.
     *
     * `image-set("https://cdn/x.png" 1x)` is a fetch with no `url(`, no
     * `@import` and no attribute name, so the two rewrites above walk past
     * it and all three patterns in `remoteRefCount` were blind to it.
     * Measured before this ran: the address reached the stored capture
     * untouched, the scan returned 0, and `readCapture` accepted the file.
     * `serialise.js` tokenises the same shape in the page's own CSS; this is
     * the half that covers a stylesheet fetched from the network.
     *
     * Runs after the `url()` pass, so a `url()` inside an image-set is
     * already a token. The inner replace consumes a parenthesised group
     * whole, which keeps it off that token and off `type("image/avif")` —
     * an image-set option whose string is a MIME type, not an address.
     *
     * Anchored on the literal `image-set(` rather than on a pattern that
     * absorbs the vendor prefix: a leading `[a-z-]*` rescans to the end of
     * every run of letters at every offset, and a 2 MB stylesheet made this
     * quadratic — measured as a test run that never finished. The prefix
     * stays outside the match, so `-webkit-image-set` is still rewritten.
     */
    return inlinedCss.replace(CSS_IMAGE_SET, (_whole, head, body) => {
      const rewritten = body.replace(CSS_IMAGE_SET_PIECE, (piece, dq, sq) => {
        if (dq === undefined && sq === undefined) return piece
        const value = cssUnescape(dq ?? sq).trim()
        if (value === '' || value.startsWith(prefix)) return piece
        if (value.startsWith('data:')) return piece
        const nested = absolute(value, href)
        if (nested === null) {
          dropped += 1
          // `url("")` rather than `none`: an image-set option has to be
          // a URL, and `none` there invalidates the declaration.
          return 'url("")'
        }
        return `url("${queue(nested, 'css-asset')}")`
      })
      return `${head}${rewritten})`
    })
  }

  /** One address, fetched within what is left of the deadline. */
  const fetchOne = async (href, kind) => {
    const left = Math.min(ASSET_TIMEOUT_MS, deadline - Date.now())
    if (left <= 0) throw new Error('out of time')
    // Timed out rather than hung — by the signal for a real fetch, and by the
    // race for everything after it, since a body can stall as well.
    const response = await within(
      fetch(href, { credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(left) }),
      left,
    )
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
    if (kind === 'css') {
      const text = await within(response.text(), deadline - Date.now())
      // The same cap the blob branch below applies, which this branch reached
      // its return without ever meeting: a stylesheet is the one asset whose
      // bytes are kept as TEXT, so an enormous one was inlined whole into a
      // document that is itself capped, and the whole capture was then refused
      // for being too large with no clue which asset did it.
      if (byteLength(text) > CAPTURE_MAX_ASSET_BYTES) throw new Error('stylesheet too large')
      return rewriteSheet(text, href)
    }
    const blob = await within(response.blob(), deadline - Date.now())
    if (blob.size > CAPTURE_MAX_ASSET_BYTES) throw new Error('asset too large')
    return dataUri(blob)
  }

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
      if (outcome.failed) dropped += 1
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

  // Counted, not silently truncated: `dropped` is what the panel shows and what
  // tells somebody their capture is missing pieces. Past the asset cap or past
  // the deadline alike, the tokens left are emptied by the sweep below, exactly
  // as a failed fetch's would be, so the "inlined or gone" invariant holds.
  dropped += assets.length - claimed

  let html = page.html
  /*
   * In INDEX order, which is the order the tokens were minted. A stylesheet's
   * nested tokens are only in the document once that stylesheet's text has been
   * spliced, and a nested token always has a higher index than its sheet — so
   * splicing by index can never look for a token before it exists, however the
   * fetches finished.
   */
  for (let i = 0; i < resolved.length; i += 1) {
    const value = resolved[i]
    if (value === undefined) continue
    /*
     * Stylesheet text is spliced into the document, so it must not be able to
     * LEAVE the element it is spliced into.
     *
     * The token for a `<link rel=stylesheet>` sits inside a `<style>` block, and
     * the value is whatever the remote server returned. A sheet ending
     * `}</style><img src=https://evil.example/beacon.png>` closes the block and
     * writes a live tag into the archive — and it was written unquoted
     * precisely because neither the sweep below nor `remoteRefCount` could see
     * that shape. Both know it now; this stops the splice creating the tag at
     * all, which is the half that does not depend on a pattern being complete.
     *
     * Only `<` needs escaping to keep CSS inside `<style>`: a stylesheet has no
     * legitimate `<`, and the HTML tokeniser leaves a `<style>` block only on a
     * literal `</`. Escaping it as `\3c ` — the CSS hex escape, trailing space
     * included — keeps any (pathological) legitimate use rendering the same.
     */
    html = html.split(keyOf(i)).join(cssKeys.has(i) ? cssSafe(value) : value)
  }

  // Anything the walk missed. A token left standing would render as literal
  // text, and a surviving http(s) address would be the one thing this must not
  // ship — so both are swept here rather than hoped about. THIS capture's
  // tokens only: see `captureNonce` for why a page's look-alikes stay.
  html = html.split(prefix).map((part, n) => (n === 0 ? part : part.replace(/^\d+__/, ''))).join('')

  // Anchored to `<[^>]*?`, so it can only match INSIDE a tag.
  //
  // Without that anchor this ran over the whole document string including text
  // nodes — and `outerHTML` does not escape `"` in text — so a posting whose
  // body reads `add <img src="https://…">` had its own prose rewritten to
  // `src=""` and counted as a dropped asset. `serialise.js` explains at length
  // that assets are tokenised precisely so a global string replace can never
  // corrupt a posting that quotes a URL; this is the line that was doing it.
  //
  // The value may be UNQUOTED. HTML does not require quotes and browsers honour
  // `src=https://…`, so a sweep that demanded them left the one shape
  // `remoteRefCount` was also blind to — a capture that beaconed on every
  // viewing while both checks reported it clean. The two widen together: a scan
  // stricter than the sweep refuses captures with no remedy.
  //
  // And the anchor consumes QUOTED RUNS rather than stopping at the first `>`.
  // A `>` inside an attribute value is legal and unescaped — the HTML serialiser
  // escapes `&`, nbsp and `"` in a value and leaves `>` alone — so `<[^>]*?`
  // made one earlier attribute enough to hide every attribute after it.
  // Measured: `<img src=https://evil.example/b.png>` was emptied,
  // `<img alt="a > b" src=https://evil.example/b.png>` was not, and
  // `remoteRefCount` (blind in the same way, from the same spelling) then passed
  // the file. `<` must be followed by an ASCII letter because that is exactly
  // when the tokeniser starts a tag. Identical to `REMOTE_REF` in
  // `service/kg/core/capture.ts` — a third copy lives in
  // `mobile/src/lib/capture.ts`, and the three change together.
  //
  // The scheme is matched as loosely as the URL parser reads it — a tab or
  // newline inside it, leading control characters, backslashes for slashes —
  // and `xlink:href` is on the list, because `remoteRefCount` now counts all of
  // those and a scan stricter than this sweep refuses a capture with no remedy.
  // A quoted value is consumed to ITS OWN closing quote, so the other quote
  // inside it no longer stops the match short.
  html = html.replace(
    // The C0 range is deliberate: it is what the URL parser trims.
    // eslint-disable-next-line no-control-regex
    /(<[a-zA-Z](?:[^>"']|"[^"]*"|'[^']*')*?\s(?:xlink:)?(?:src|srcset|imagesrcset|href|poster|data|action|formaction|background)\s*=\s*)(?:"[\x00-\x20]*(?:h[\t\n\r]*t[\t\n\r]*t[\t\n\r]*p[\t\n\r]*(?:s[\t\n\r]*)?:|[\\/][\t\n\r]*[\\/])[^"]*"|'[\x00-\x20]*(?:h[\t\n\r]*t[\t\n\r]*t[\t\n\r]*p[\t\n\r]*(?:s[\t\n\r]*)?:|[\\/][\t\n\r]*[\\/])[^']*'|(?:https?:|[\\/]{2})[^\s>]*)/gi,
    (_whole, head) => {
      dropped += 1
      // Emptied by writing a quoted empty value, which is valid HTML whatever
      // the original quoting and cannot be re-read as a URL.
      return `${head}""`
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

/**
 * Every read-modify-write of the queue, one at a time.
 *
 * `capture`, `delete`, `clear` and `ack` each read the whole queue, change it
 * and write it back, with awaits in between. Two at once — a capture landing
 * while jojo acknowledges the last batch — each wrote back the list it read,
 * and the second write erased the first's change: a kept page vanished, or a
 * filed one came back to be filed again. Chained here, each sees the last's
 * result. A failure does not jam the chain.
 */
let queueChain = Promise.resolve()
function withQueue(change) {
  const run = queueChain.then(change, change)
  queueChain = run.catch(() => undefined)
  return run
}

/**
 * A badge on one tab, best effort. The tab may have closed since the capture
 * started — `setBadgeText` then REJECTS, and that rejection escaped every
 * handler that awaited it, so the reply never came and the caller sat out its
 * whole timeout. A badge is decoration; it never decides an outcome.
 */
async function badge(tabId, text, title) {
  try {
    await chrome.action.setBadgeText({ tabId, text })
    if (title !== undefined) await chrome.action.setTitle({ tabId, title })
  } catch {
    // The tab is gone. Nothing to mark.
  }
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

/**
 * Whether this model address is refused, and why — or null to go ahead.
 *
 * ONE copy of the rule, called by both the whole-body relay and the streaming
 * one. Two copies would be two things to keep in step, and the thing they
 * decide is which addresses this extension will fetch on a page's behalf —
 * exactly the rule that must not drift.
 */
async function modelRefusal(url) {
  const routes = await routing()
  const host = hostOf(url)
  // A provider the person switched off is refused BY NAME, so the message says
  // which one and where to change it. Loopback is not a provider and is not
  // gated here — a local model never left the machine.
  if (host && !isLoopback(url) && routes.models[host] === false) {
    return `Routing to ${host} is switched off in the jojo extension.`
  }
  // A model on the person's own network, which has its own switch and is OFF
  // until they turn it on — see ROUTING. Named so the fix is one press away.
  if (isPrivateNetwork(url) && !routes.network) {
    return (
      `${host} is on your own network, and relaying to models on your network is switched off ` +
      'in the jojo extension. Open the extension and turn on "Models on my network".'
    )
  }
  if (!isLoopback(url) && !isPrivateNetwork(url) && !isKnownModelHost(url)) {
    return (
      'That address is not a model provider jojo knows about, is not on this machine, ' +
      'and is not on your own network. The extension relays to this machine, to private ' +
      'network addresses, and to the hosted providers in its own list — a plain http ' +
      'address on the public internet is refused.'
    )
  }
  return null
}

/**
 * The same relay, but handing back the body AS IT ARRIVES.
 *
 * ## Why this exists
 *
 * A cloud provider cannot be called from the page: NVIDIA, OpenAI and Anthropic
 * do not send `access-control-allow-origin` to a browser origin, so the request
 * is made here instead. Until now that meant `await response.text()` — the
 * whole answer, handed back in one piece — and a person watching a slow model
 * write three paragraphs saw a spinner for the entire time, then all of it at
 * once. Local models have streamed since streaming was added; this is what
 * makes a hosted one behave the same.
 *
 * ## Why a Port and not `sendResponse`
 *
 * `sendResponse` fires exactly once. Streaming is many messages over one
 * request, which is what `chrome.runtime.connect` is for. The port also gives a
 * disconnect signal, so a tab that navigates away aborts the fetch instead of
 * leaving it running in a worker nobody is listening to.
 *
 * The final message carries the assembled text as well, so a caller that missed
 * a chunk — or a page that would rather not reassemble — has the whole body on
 * the same terms as the non-streaming relay.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== MODEL_STREAM_PORT) return

  const controller = new AbortController()
  let closed = false
  port.onDisconnect.addListener(() => {
    closed = true
    controller.abort()
  })

  port.onMessage.addListener((message) => {
    void (async () => {
      const request = message?.request
      const url = typeof request?.url === 'string' ? request.url : ''
      const send = (payload) => {
        if (closed) return
        try {
          port.postMessage(payload)
        } catch {
          // The page went away mid-answer. Nothing to do and nothing to log:
          // the disconnect listener has already aborted the fetch.
          closed = true
        }
      }

      // Inside a try like everything after it: a throw here would otherwise
      // end the stream with no 'done', and the page would wait out its budget.
      let refusal
      try {
        refusal = await modelRefusal(url)
      } catch (error) {
        refusal = `The extension could not read its routing settings: ${reasonOf(error)}`
      }
      if (refusal) {
        send({ type: 'done', ok: false, status: 0, text: '', reason: refusal })
        return
      }

      // Same ceiling as the whole-body relay, but reset by ARRIVING BYTES
      // rather than by the request finishing: a long answer is not a stall, and
      // a fixed deadline would cut off exactly the slow responses this exists
      // to make watchable.
      let timer = null
      const arm = () => {
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
          controller.abort()
        }, READ_TIMEOUT_MS)
      }
      arm()

      try {
        const method = relayMethod(request)
        if (method === null) throw new Error('the extension relays GET and POST only')
        const sendsBody = method !== 'GET'
        const response = await fetch(url, {
          method,
          headers: request.headers && typeof request.headers === 'object' ? request.headers : {},
          ...(sendsBody && typeof request.body === 'string' && request.body !== ''
            ? { body: request.body }
            : {}),
          signal: controller.signal,
          credentials: 'omit',
        })

        // A refusal has a body worth reading whole — it is an error message, not
        // a stream, and forwarding it as chunks would make the page parse an
        // SSE frame that was never sent.
        if (!response.ok || !response.body) {
          const text = await response.text().catch(() => '')
          if (timer !== null) clearTimeout(timer)
          send({ type: 'done', ok: response.ok, status: response.status, text })
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let whole = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          arm()
          // `stream: true` on the DECODER as well: a multi-byte character can be
          // split across two network chunks, and decoding each in isolation
          // turns one é into two replacement characters.
          const text = decoder.decode(value, { stream: true })
          if (text === '') continue
          whole += text
          send({ type: 'chunk', text })
          if (closed) return
        }
        whole += decoder.decode()
        if (timer !== null) clearTimeout(timer)
        send({ type: 'done', ok: true, status: response.status, text: whole })
      } catch (error) {
        if (timer !== null) clearTimeout(timer)
        const aborted = error && error.name === 'AbortError'
        send({
          type: 'done',
          ok: false,
          status: 0,
          text: '',
          reason: aborted
            ? 'The model provider stopped sending before the answer was finished.'
            : `The extension could not reach the model provider: ${String(error && error.message ? error.message : error)}`,
        })
      }
    })()
  })
})

/** Where the crash-reporting choice and the worker's own crash log live. */
const CRASH_ON = 'jojo.crash.on'
const CRASH_LOG = 'jojo.crash.log'
/** Enough to see a pattern, too few to grow without end. */
const CRASH_LOG_MAX = 20

/** A sentence from whatever was thrown. */
function reasonOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One handler failure, kept only when the person has crash reporting on —
 * the default is off, and this records nothing until they say otherwise. What
 * is kept is the verb and the message: never a URL, a body or a page.
 */
async function recordCrash(verb, error) {
  try {
    const stored = await chrome.storage.local.get([CRASH_ON, CRASH_LOG])
    if (stored[CRASH_ON] !== true) return
    const log = Array.isArray(stored[CRASH_LOG]) ? stored[CRASH_LOG] : []
    log.push({ at: new Date().toISOString(), verb: String(verb ?? ''), message: reasonOf(error).slice(0, 300) })
    await chrome.storage.local.set({ [CRASH_LOG]: log.slice(-CRASH_LOG_MAX) })
  } catch {
    // A crash log that crashes has nothing left to report to.
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  /* ------------------------- the popup's own verbs ------------------------ */

  /*
   * These five are answered only for the extension's OWN pages.
   *
   * The test is the sender's own URL: an extension page reports
   * `chrome-extension://<this id>/…`, while a content script reports the WEB
   * page it is running in, whatever that page is. So this admits the popup and
   * anything else served out of this extension, and admits no page on the web —
   * jojo's own included.
   *
   * `!sender.tab` would also identify the popup and was the first version, but
   * it refuses an extension page opened in a tab, which is what an options page
   * is and what makes any of this testable.
   *
   * The check matters because these verbs are not the careful, narrow ones the
   * web app gets: `jojo:capture-tab` runs a script in a tab of its choosing and
   * `jojo:set-routing` changes what the relays will carry.
   */
  const fromOwnPage =
    sender?.id === chrome.runtime.id &&
    typeof sender.url === 'string' &&
    sender.url.startsWith(chrome.runtime.getURL(''))

  /*
   * Every async handler below runs through this, and it always ANSWERS.
   *
   * They were `void (async () => { … sendResponse(…) })(); return true` with no
   * catch, so anything that threw — a storage read, a badge on a tab that had
   * closed — rejected into nowhere, the channel stayed open with no reply, and
   * the caller sat out its whole timeout (90 s for "From link") before saying
   * the extension had not answered. Now a throw answers `{ ok: false, reason }`
   * at once, and is kept for the crash log when the person has that on.
   */
  const guarded = (body) => {
    void body().catch((error) => {
      void recordCrash(message?.type, error)
      try {
        sendResponse({ ok: false, status: 0, text: '', reason: reasonOf(error) })
      } catch {
        // The caller has gone; there is nobody left to tell.
      }
    })
    return true
  }

  if (message?.type === 'jojo:list-captures' && fromOwnPage) {
    return guarded(async () => {
      const queued = await read()
      // WITHOUT `html`. A capture is a whole inlined page — often megabytes —
      // and the popup only ever draws a title, an address and a size. Sending
      // the bodies would cost a structured clone of the entire queue every time
      // the popup opens, to render nothing with them.
      sendResponse({
        captures: queued.map((c) => ({
          id: c.id,
          url: c.url,
          title: c.title,
          capturedAt: c.capturedAt,
          bytes: byteLength(c.html ?? ''),
          dropped: c.dropped ?? 0,
        })),
      })
    })
  }

  if (message?.type === 'jojo:delete-capture' && fromOwnPage) {
    return guarded(async () => {
      const id = typeof message.id === 'string' ? message.id : ''
      const kept = await withQueue(async () => {
        const queued = (await read()).filter((c) => c.id !== id)
        await chrome.storage.local.set({ [QUEUE]: queued })
        return queued
      })
      await chrome.action.setBadgeText({ text: kept.length > 0 ? String(kept.length) : '' })
      sendResponse({ ok: true, remaining: kept.length })
    })
  }

  if (message?.type === 'jojo:clear-captures' && fromOwnPage) {
    return guarded(async () => {
      await withQueue(() => chrome.storage.local.set({ [QUEUE]: [] }))
      await chrome.action.setBadgeText({ text: '' })
      sendResponse({ ok: true, remaining: 0 })
    })
  }

  /*
   * One kept page, WITH its body — for the popup's Save button.
   *
   * `jojo:list-captures` deliberately omits `html` (a queue of multi-megabyte
   * pages is a large structured clone to draw a list of titles). Saving needs
   * exactly one body, so it is asked for by id, when it is wanted. Gated like
   * every other popup verb: only a page served from this extension may ask.
   */
  if (message?.type === 'jojo:get-capture' && fromOwnPage) {
    return guarded(async () => {
      const id = typeof message.id === 'string' ? message.id : ''
      const found = (await read()).find((c) => c.id === id)
      sendResponse(
        found
          ? { ok: true, url: found.url, title: found.title, capturedAt: found.capturedAt, html: found.html }
          : { ok: false, reason: 'That page is no longer kept.' },
      )
    })
  }

  if (message?.type === 'jojo:capture-tab' && fromOwnPage) {
    return guarded(async () => {
      const tabId = typeof message.tabId === 'number' ? message.tabId : null
      if (tabId === null) {
        sendResponse({ ok: false, reason: 'No page to capture.' })
        return
      }
      // capture() reports its own outcome. This used to answer `ok: true`
      // unconditionally, which is how a page that was never stored came back
      // to the popup as "Kept.".
      sendResponse(await capture(tabId))
    })
  }

  if (message?.type === 'jojo:get-routing' && fromOwnPage) {
    return guarded(async () => {
      sendResponse({ routing: await routing(), hosts: MODEL_HOSTS })
    })
  }

  if (message?.type === 'jojo:set-routing' && fromOwnPage) {
    return guarded(async () => {
      const current = await routing()
      const next = {
        reader: {
          enabled:
            typeof message.reader?.enabled === 'boolean'
              ? message.reader.enabled
              : current.reader.enabled,
          endpoint:
            typeof message.reader?.endpoint === 'string' && message.reader.endpoint.trim()
              ? message.reader.endpoint.trim()
              : current.reader.endpoint,
        },
        // Only hosts the allowlist already names can be switched at all, so a
        // crafted message cannot add a route by writing a key.
        models: Object.fromEntries(
          MODEL_HOSTS.map((host) => [
            host,
            typeof message.models?.[host] === 'boolean'
              ? message.models[host]
              : current.models[host],
          ]),
        ),
        network: typeof message.network === 'boolean' ? message.network : current.network,
      }
      await chrome.storage.local.set({ [ROUTING]: next })
      sendResponse({ routing: next })
    })
  }

  /*
   * Is the reader actually answering?
   *
   * An MCP `initialize` rather than a HEAD or a bare GET: markitdown-mcp
   * answers a GET with 307 and a HEAD with a redirect too, so either would
   * report "reachable" for a server that cannot speak the protocol. A handshake
   * that returns a `result` is the only answer that means what the dot claims.
   */
  if (message?.type === 'jojo:probe-reader' && fromOwnPage) {
    return guarded(async () => {
      const url =
        typeof message.endpoint === 'string' && message.endpoint.trim()
          ? message.endpoint.trim()
          : (await routing()).reader.endpoint
      if (!isLoopback(url)) {
        sendResponse({ ok: false, reason: 'The reader address has to be on this machine.' })
        return
      }
      const answer = await relay(
        {
          url,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'jojo-extension', version: chrome.runtime.getManifest().version },
            },
          }),
        },
        'reader',
      )
      sendResponse({
        ok: answer.ok === true && /"result"/.test(answer.text ?? ''),
        status: answer.status ?? 0,
        reason: answer.reason ?? null,
      })
    })
  }

  if (message?.type === 'jojo:take-captures') {
    return guarded(async () => {
      // Handed over, NOT deleted.
      //
      // Emptying the queue here was a real loss: jojo validates every envelope
      // through `readCapture` after receiving it, and a capture it refuses was
      // already gone — the user saw "could not be kept" with nothing left to
      // retry and no way to find out why. The queue now shrinks only on
      // `jojo:ack-captures`, which names the ids that were actually filed.
      const queued = await read()
      sendResponse({ captures: queued })
    })
  }
  if (message?.type === 'jojo:ack-captures') {
    return guarded(async () => {
      const kept = new Set(Array.isArray(message.ids) ? message.ids : [])
      const left = await withQueue(async () => {
        const remaining = (await read()).filter((c) => !kept.has(c.id))
        await chrome.storage.local.set({ [QUEUE]: remaining })
        return remaining
      })
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
    })
  }
  if (message?.type === 'jojo:peek-captures') {
    return guarded(async () => {
      sendResponse({ count: (await read()).length })
    })
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
  /*
   * Reading a document through the reader running on this machine.
   *
   * WHY THIS IS HERE AT ALL. markitdown-mcp sends no CORS headers and answers
   * the preflight with 405, so a page cannot POST to it across ports however
   * local both are. The dev server sidesteps that by proxying `/reader/mcp`, so
   * the request is same-origin — but a hosted copy has no proxy to use, and an
   * https:// page is additionally barred from `127.0.0.1` by Chrome's Local
   * Network Access gate. Between them those two rules mean the deployed app can
   * never talk to a local reader from the page.
   *
   * An extension is the one part of jojo that is not a page. It fetches under
   * its own `host_permissions` rather than the page's origin, which is exactly
   * why board scanning already lives here. This is the same move for documents.
   *
   * LOOPBACK ONLY, and that restriction is the point rather than caution. This
   * relays a request written by the page, so without it any script that got onto
   * jojo's origin could use the extension's privileges to fetch anything on the
   * web and read the answer — an open proxy wearing jojo's permissions.
   * `scanBoard` is deliberately different: opening a public page IS its feature,
   * and it has its own guards. Reading a document has no business leaving this
   * machine, so it cannot.
   */
  if (message?.type === 'jojo:read-document') {
    return guarded(async () => {
      const request = message.request
      const url = typeof request?.url === 'string' ? request.url : ''
      // The switch, before the address check. Somebody who turned the reader
      // relay off wants to be told that, not told their address is wrong.
      const routes = await routing()
      if (!routes.reader.enabled) {
        sendResponse({
          ok: false,
          status: 0,
          text: '',
          reason:
            'Document reading is switched off in the jojo extension. ' +
            'Open the extension and turn "Document reader" back on.',
        })
        return
      }
      if (!isLoopback(url)) {
        sendResponse({
          ok: false,
          status: 0,
          text: '',
          reason:
            'The reader address has to be on this machine — http://127.0.0.1 or http://localhost. ' +
            'The extension only relays to loopback.',
        })
        return
      }
      /*
       * And it has to be THE reader — the address saved in this extension's
       * popup — not any port on this machine. Loopback alone let a page reach
       * every local service the person runs, with any method, and read the
       * answer. Same port, any loopback spelling: see `sameLoopbackServer`.
       */
      if (!sameLoopbackServer(url, routes.reader.endpoint)) {
        sendResponse({
          ok: false,
          status: 0,
          text: '',
          reason:
            `The extension only relays documents to the reader address saved in it (${routes.reader.endpoint}). ` +
            'If MarkItDown is listening somewhere else, open the jojo extension and change the Document reader address to match.',
        })
        return
      }
      sendResponse(await relay(request, 'reader'))
    })
  }

  /*
   * The MCP link: the jojo tab talking to `jojo-bridge` on this machine, which
   * is how an MCP client such as Claude Code reaches the tab's records.
   *
   * Its own verb rather than a second use of `jojo:read-document`, for the
   * reason the model verb below gives: different gates. A read is stopped by the
   * popup's "Document reader" switch, which is about sending documents to
   * MarkItDown. Somebody who turns that off has not asked for the link to stop
   * — and would be told "Document reading is switched off" by something that has
   * nothing to do with documents. The link is turned on and off in jojo's own
   * Settings, which is where the person who wants it went to turn it on.
   *
   * LOOPBACK ONLY, for the same reason as a read: the page composed this
   * request, and the extension's own permissions are the whole web.
   */
  if (message?.type === 'jojo:mcp-link') {
    return guarded(async () => {
      const request = message.request
      const url = typeof request?.url === 'string' ? request.url : ''
      // Loopback AND jojo-bridge's own port — see JOJO_BRIDGE_ADDRESS.
      if (!isLoopback(url) || !sameLoopbackServer(url, JOJO_BRIDGE_ADDRESS)) {
        sendResponse({
          ok: false,
          status: 0,
          text: '',
          reason: `jojo-bridge has to be at ${JOJO_BRIDGE_ADDRESS} — the extension only relays the link there.`,
        })
        return
      }
      sendResponse(await relay(request, 'jojo-bridge'))
    })
  }

  /*
   * A model request, relayed for the same reason a document read is.
   *
   * Separate from `jojo:read-document` rather than one verb with a mode, because
   * the two have different allowlists and keeping each minimal is the point: a
   * reader may only ever be on this machine, and a model may be on this machine
   * OR at one of the providers in the table. One verb taking a flag would be one
   * place to get that wrong.
   */
  if (message?.type === 'jojo:call-model') {
    return guarded(async () => {
      const request = message.request
      const url = typeof request?.url === 'string' ? request.url : ''
      const refusal = await modelRefusal(url)
      if (refusal) {
        sendResponse({ ok: false, status: 0, text: '', reason: refusal })
        return
      }
      sendResponse(await relay(request, 'model provider'))
    })
  }

  if (message?.type === 'jojo:scan-board') {
    return guarded(async () => {
      const url = typeof message.url === 'string' ? message.url : ''
      if (!/^https?:\/\//i.test(url)) {
        sendResponse({ ok: false, reason: 'That is not an address I can open.' })
        return
      }
      // See `isLocalTarget`: a tab with the person's cookies is not opened on
      // their own machine or network for a page to read.
      if (isLocalTarget(url)) {
        sendResponse({ ok: false, reason: 'That address is on this machine or your own network, so it was not opened.' })
        return
      }
      sendResponse(await scanBoard(url))
    })
  }

  /*
   * The app's "From link": one address, opened, rendered and handed back.
   *
   * Bounded like the scan — a content script on jojo's own origin is the only
   * sender, and the only thing it can ask for is one http(s) page opened and
   * read — and for the same reason: opening a public page IS the feature.
   */
  if (message?.type === 'jojo:capture-url') {
    return guarded(async () => {
      const url = typeof message.url === 'string' ? message.url : ''
      if (!/^https?:\/\//i.test(url)) {
        sendResponse({ ok: false, reason: 'That is not an address I can open.' })
        return
      }
      if (isLocalTarget(url)) {
        sendResponse({ ok: false, reason: 'That address is on this machine or your own network, so it was not opened.' })
        return
      }
      sendResponse(await capturePage(url))
    })
  }

  /*
   * The crash-reporting choice, which `bridge.js` has forwarded since protocol 4
   * and nothing here answered — so the verb fell through to `return false` and
   * every caller got "message port closed". The page owns the choice and pushes
   * it; this keeps it, clears the log when asked, and hands back what it has.
   */
  if (message?.type === 'jojo:crash-reporting') {
    return guarded(async () => {
      const stored = await chrome.storage.local.get([CRASH_ON, CRASH_LOG])
      const on = typeof message.on === 'boolean' ? message.on : stored[CRASH_ON] === true
      const kept = message.clear === true || !on ? [] : (Array.isArray(stored[CRASH_LOG]) ? stored[CRASH_LOG] : [])
      await chrome.storage.local.set({ [CRASH_ON]: on, [CRASH_LOG]: kept })
      sendResponse({ on, crashes: kept })
    })
  }
  return false
})
