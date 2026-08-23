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
    typeof data.scan === 'string'
      ? 'jojo:scan-board'
      : data.ack !== undefined
        ? 'jojo:ack-captures'
        : data.take === true
          ? 'jojo:take-captures'
          : 'jojo:peek-captures'

  // Only these three fields cross, and only ever from this shape. Forwarding
  // the request wholesale would let anything on jojo's own page hand the worker
  // fields it never validated.
  chrome.runtime.sendMessage({ type: wanted, ids: data.ack, url: data.scan }, (response) => {
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
