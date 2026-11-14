/**
 * The relay verbs: a document to the reader, the MCP link to jojo-bridge, and a
 * model request to a provider — each hop pinned to the one place it may go.
 */

import { relay } from './relay.js'
import { JOJO_BRIDGE_ADDRESS, modelRefusal, routing } from './routing.js'
import { isLoopback, sameLoopbackServer } from './targets.js'

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
export async function onReadDocument(message, sendResponse) {
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
export async function onMcpLink(message, sendResponse) {
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
export async function onCallModel(message, sendResponse) {
  const request = message.request
  const url = typeof request?.url === 'string' ? request.url : ''
  const refusal = await modelRefusal(url)
  if (refusal) {
    sendResponse({ ok: false, status: 0, text: '', reason: refusal })
    return
  }
  sendResponse(await relay(request, 'model provider'))
}
