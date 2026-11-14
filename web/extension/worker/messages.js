/**
 * Which verbs this worker answers, and for whom.
 */

import { onCrashReporting, recordCrash } from './crash.js'
import { onAckCaptures, onCaptureUrl, onPeekCaptures, onScanBoard, onTakeCaptures } from './page-verbs.js'
import {
  onCaptureTab,
  onClearCaptures,
  onDeleteCapture,
  onGetCapture,
  onGetRouting,
  onListCaptures,
  onProbeReader,
  onSetRouting,
} from './popup-verbs.js'
import { onCallModel, onMcpLink, onReadDocument } from './relay-verbs.js'
import { reasonOf } from './util.js'

/** The popup's own verbs, answered only for pages served from this extension. */
export const OWN_PAGE_VERBS = new Map([
  ['jojo:list-captures', onListCaptures],
  ['jojo:delete-capture', onDeleteCapture],
  ['jojo:clear-captures', onClearCaptures],
  ['jojo:get-capture', onGetCapture],
  ['jojo:capture-tab', onCaptureTab],
  ['jojo:get-routing', onGetRouting],
  ['jojo:set-routing', onSetRouting],
  ['jojo:probe-reader', onProbeReader],
])

/** The verbs jojo's page sends through `bridge.js`, answered for any sender. */
export const PAGE_VERBS = new Map([
  ['jojo:take-captures', onTakeCaptures],
  ['jojo:ack-captures', onAckCaptures],
  ['jojo:peek-captures', onPeekCaptures],
  ['jojo:read-document', onReadDocument],
  ['jojo:mcp-link', onMcpLink],
  ['jojo:call-model', onCallModel],
  ['jojo:scan-board', onScanBoard],
  ['jojo:capture-url', onCaptureUrl],
  ['jojo:crash-reporting', onCrashReporting],
])

/**
 * The jojo tab asking for what has been captured.
 *
 * `bridge.js` is the only sender — it is a content script on jojo's own origins
 * — and it relays through `window.postMessage`, so the app never needs to know
 * the extension's id. That matters more than it looks: an unpacked extension
 * gets a fresh id on every load, and a delivery path keyed on the id would work
 * for a published build and for nobody developing against it.
 */
export function onMessage(message, sender, sendResponse) {
  /*
   * `OWN_PAGE_VERBS` are answered only for the extension's OWN pages.
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

  const verb = (fromOwnPage ? OWN_PAGE_VERBS.get(message?.type) : undefined) ?? PAGE_VERBS.get(message?.type)
  if (verb === undefined) return false
  return guarded(() => verb(message, sendResponse))
}
