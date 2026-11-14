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
 *
 * This file is only the entry point: it registers the worker's three listeners,
 * synchronously and at the top level as MV3 requires, and everything they call
 * lives in `worker/`. One module per job:
 *
 *   - `messages.js`      which verbs are answered, and for whom
 *   - `popup-verbs.js`   the popup's own verbs: the queue, Capture, routing
 *   - `page-verbs.js`    jojo's page: draining the queue, scan, "From link"
 *   - `relay-verbs.js`   a document, the MCP link, a model request
 *   - `model-stream.js`  the streaming model relay, over a Port
 *   - `relay.js`         the one-request hop all three relays share
 *   - `routing.js`       the popup's switches and which model addresses pass
 *   - `targets.js`       this machine, the LAN, the same board, a sign-in wall
 *   - `capture.js`       the Capture button and "From link"
 *   - `inline.js`        the asset loop, with its cap and its deadline
 *   - `inline-css.js`    a fetched stylesheet, tokenised and made safe
 *   - `splice.js`        tokens spliced, strays removed, the final sweep
 *   - `scan-board.js`    a board opened in a tab, pressed and harvested
 *   - `tabs.js`          waiting on a background tab
 *   - `queue.js`         the capture queue and its lock
 *   - `crash.js`         the opt-in crash log
 *   - `badge.js`, `install.js`, `util.js`
 */

import { injectIntoOpenTabs } from './worker/install.js'
import { onMessage } from './worker/messages.js'
import { onModelStreamConnect } from './worker/model-stream.js'

// `onInstalled` also fires on update and on a reload of an unpacked extension,
// which is exactly when a developer needs this too.
chrome.runtime.onInstalled.addListener(() => {
  void injectIntoOpenTabs()
})

chrome.runtime.onConnect.addListener(onModelStreamConnect)

chrome.runtime.onMessage.addListener(onMessage)
