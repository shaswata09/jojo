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
 * The origin check is the reason this file is short and boring. It is injected
 * only into localhost by the manifest's `matches`, and it additionally refuses
 * any message whose `source` is not this window — so a framed page cannot ask
 * for the queue, and neither can anything else on the tab.
 */

const REQUEST = 'jojo:capture-request'
const REPLY = 'jojo:capture-reply'

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
    data.read !== undefined && data.read !== null
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
  const read =
    data.read && typeof data.read === 'object'
      ? {
          url: typeof data.read.url === 'string' ? data.read.url : '',
          method: typeof data.read.method === 'string' ? data.read.method : 'POST',
          headers:
            data.read.headers && typeof data.read.headers === 'object' ? data.read.headers : {},
          body: typeof data.read.body === 'string' ? data.read.body : '',
        }
      : undefined

  chrome.runtime.sendMessage({ type: wanted, ids: data.ack, url: data.scan, request: read }, (response) => {
    // A disconnected service worker is a normal state, not a failure: MV3 stops
    // it when idle. Reading lastError is what stops it logging as unchecked.
    const failed = chrome.runtime.lastError
    window.postMessage(
      {
        type: REPLY,
        id: data.id,
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
  })
})

// Announced once so the app can tell "no extension" from "extension with
// nothing queued" — two states that otherwise look identical and want
// completely different sentences on screen.
//
// The version rides along because an unpacked extension never auto-updates:
// this is the only way a user finds out theirs is older than the app expects,
// and it costs one field.
window.postMessage(
  { type: 'jojo:capture-ready', version: chrome.runtime.getManifest().version },
  window.location.origin,
)
