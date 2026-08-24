/**
 * The only thing that runs on jojo's own origin, and it carries no data of its
 * own.
 *
 * The app cannot talk to the extension directly: `chrome.runtime` is not exposed
 * to a page, and `externally_connectable` would work only for a build whose id
 * is fixed — an unpacked extension, which is how anybody developing this loads
 * it, gets a fresh id every time. So the app posts a message to its own window,
 * this relays it, and neither side has to know an id.
 *
 * ## Where this runs, and why the list in the manifest is long
 *
 * `matches` is the ONLY thing standing between this bridge and a page that is
 * not jojo. There is no second check available: a content script cannot ask a
 * page to prove who it is, and anything the page could show it, a hostile page
 * on the same origin could show it too. So the list is the security boundary
 * and it is written out rather than wildcarded.
 *
 * It names two things. The DEPLOYED origin — without it the extension is
 * invisible to the hosted app, which is the copy most people use, and every
 * reader call from it fails with "the extension did not answer" while the
 * extension sits there installed and working. And the DEV PORTS, listed one by
 * one.
 *
 * The dev entries used to be a single wildcard-port pattern for localhost, which
 * looks equivalent and is not: it handed this bridge to every page on every
 * local server. Any
 * second dev server, any local tool with a reflected-content endpoint, could
 * post one message and take the whole capture queue, or drive a fetch through
 * the worker in a tab carrying the user's cookies. Vite's range covers the
 * ports below; a project that needs another adds it here deliberately.
 *
 * The `event.source !== window` check below is the other half, and it is about
 * frames rather than origins: it refuses a message from an embedded document,
 * so a page jojo happens to iframe cannot ask on jojo's behalf.
 */

const REQUEST = 'jojo:capture-request'
const REPLY = 'jojo:capture-reply'

/*
 * `protocol` is NOT the version, and it exists because the version cannot do
 * this job.
 *
 * The manifest version is what a person reads and is deliberately pinned — it
 * does not move when this bridge learns a new verb. So a page had no way to
 * tell a bridge that speaks `read`/`model` from one that predates them, and an
 * old bridge does not refuse an unknown shape: it picks the closest verb it
 * knows, forwards a peek, and the page reports a transport error about a server
 * that was never contacted.
 *
 * That is not hypothetical. An unpacked extension never auto-updates, so a
 * bridge from before `read` existed went on coercing an absent body to `''`, and
 * every relayed GET failed with "Request with GET/HEAD method cannot have body"
 * — blamed on the model provider. Nobody seeing that could guess the answer was
 * to press Reload on chrome://extensions.
 *
 * Bump this whenever the SHAPE crossing this boundary changes. The page carries
 * the minimum it needs and names the fix when the number is short.
 *
 *   1 — capture only: peek, take, ack
 *   2 — + scan (job boards)
 *   3 — + read and model (relayed requests; a body only when there is one)
 *   4 — + crash (one crash-reporting choice, governing both halves)
 */
const BRIDGE_PROTOCOL = 4

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data
  if (typeof data !== 'object' || data === null) return
  if (data.type !== REQUEST) return

  // Four verbs on one channel: look, take, confirm what was kept — and, unlike
  // the other three, ask for something to be fetched. The ack is what lets the
  // worker keep a refused capture instead of destroying it.
  //
  // The verb is chosen from the request's SHAPE rather than from a name it
  // carries, so a page cannot name a message type the worker was not expecting.
  // `scan` is checked first because it is the only one with an argument, and a
  // scan request has no `ack` and no `take` to fall through to.
  const wanted =
    data.crash !== undefined && data.crash !== null
      ? 'jojo:crash-reporting'
      : data.model !== undefined && data.model !== null
        ? 'jojo:call-model'
        : data.read !== undefined && data.read !== null
          ? 'jojo:read-document'
          : typeof data.scan === 'string'
            ? 'jojo:scan-board'
            : data.ack !== undefined
              ? 'jojo:ack-captures'
              : data.take === true
                ? 'jojo:take-captures'
                : 'jojo:peek-captures'

  // Only these three fields cross, and only ever from this shape. Forwarding
  // the request wholesale would let anything on jojo's own page hand the worker
  // fields it never validated.
  /*
   * `read` carries a whole request — url, method, headers, body — where the
   * others carry a field or nothing. It is rebuilt here field by field rather
   * than passed through, for the same reason the line below names its three:
   * the worker must never receive a shape the page composed freely. Anything
   * else on the object is dropped, and the worker checks the url again anyway.
   */
  // Both relayed verbs carry the same shape, so one rebuilder serves both.
  const relayed = data.model && typeof data.model === 'object' ? data.model : data.read
  const read =
    relayed && typeof relayed === 'object'
      ? {
          url: typeof relayed.url === 'string' ? relayed.url : '',
          method: typeof relayed.method === 'string' ? relayed.method : 'POST',
          headers: relayed.headers && typeof relayed.headers === 'object' ? relayed.headers : {},
          /*
           * OMITTED when there is none, not coerced to ''.
           *
           * An empty string is still a body, and `fetch` throws on a GET that
           * has one: "Request with GET/HEAD method cannot have body". The model
           * list is a GET, so every connection test through the relay died on
           * this — and the message blamed the server for not running.
           */
          ...(typeof relayed.body === 'string' && relayed.body !== ''
            ? { body: relayed.body }
            : {}),
        }
      : undefined

  // Only the two fields the crash verb takes cross, on the same terms as the
  // rest: the worker must never receive a shape the page composed freely.
  const crash =
    data.crash && typeof data.crash === 'object'
      ? {
          on: typeof data.crash.on === 'boolean' ? data.crash.on : undefined,
          clear: data.crash.clear === true,
        }
      : undefined

  chrome.runtime.sendMessage(
    {
      type: wanted,
      ids: data.ack,
      url: data.scan,
      request: read,
      on: crash ? crash.on : undefined,
      clear: crash ? crash.clear : undefined,
    },
    (response) => {
      // A disconnected service worker is a normal state, not a failure: MV3 stops
      // it when idle. Reading lastError is what stops it logging as unchecked.
      const failed = chrome.runtime.lastError
      window.postMessage(
        {
          type: REPLY,
          id: data.id,
          // On every reply, not only on the announce: READY fires when the
          // bridge loads, which for a tab that was already open is never.
          protocol: BRIDGE_PROTOCOL,
          // The crash verb answers with the stored setting and the kept list.
          crashOn: failed ? false : response?.on === true,
          crashes: failed ? [] : (response?.crashes ?? []),
          captures: failed ? [] : (response?.captures ?? []),
          count: failed ? 0 : (response?.count ?? response?.remaining ?? 0),
          // A scan answers with rows and a reason instead of captures and a
          // count. Both shapes ride the one reply, because the page correlates on
          // `id` and already knows which question it asked.
          rows: failed ? null : (response?.rows ?? null),
          ok: failed ? false : response?.ok === true,
          // A read answers with an HTTP status and a body. Carried on the same
          // reply as everything else, because the page correlates on `id` and
          // already knows which question it asked.
          status: failed ? 0 : (response?.status ?? 0),
          text: failed ? '' : (response?.text ?? ''),
          error: failed ? failed.message : (response?.reason ?? null),
        },
        window.location.origin,
      )
    },
  )
})

// Announced once so the app can tell "no extension" from "extension with
// nothing queued" — two states that otherwise look identical and want
// completely different sentences on screen.
//
// The version rides along because an unpacked extension never auto-updates:
// this is the only way a user finds out theirs is older than the app expects,
// and it costs one field.
window.postMessage(
  {
    type: 'jojo:capture-ready',
    version: chrome.runtime.getManifest().version,
    protocol: BRIDGE_PROTOCOL,
  },
  window.location.origin,
)
