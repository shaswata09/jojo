/**
 * The popup's own verbs: the queue it lists, saves from and clears, the tab
 * its Capture button reads, and the routing switches. `messages.js` answers
 * these only for pages served from this extension.
 */

import { MODEL_HOSTS } from '../policy.js'
import { capture } from './capture.js'
import { QUEUE, read, withQueue } from './queue.js'
import { relay } from './relay.js'
import { ROUTING, routing } from './routing.js'
import { isLoopback } from './targets.js'
import { byteLength } from './util.js'

export async function onListCaptures(message, sendResponse) {
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
}

export async function onDeleteCapture(message, sendResponse) {
  const id = typeof message.id === 'string' ? message.id : ''
  const kept = await withQueue(async () => {
    const queued = (await read()).filter((c) => c.id !== id)
    await chrome.storage.local.set({ [QUEUE]: queued })
    return queued
  })
  await chrome.action.setBadgeText({ text: kept.length > 0 ? String(kept.length) : '' })
  sendResponse({ ok: true, remaining: kept.length })
}

export async function onClearCaptures(message, sendResponse) {
  await withQueue(() => chrome.storage.local.set({ [QUEUE]: [] }))
  await chrome.action.setBadgeText({ text: '' })
  sendResponse({ ok: true, remaining: 0 })
}

/*
 * One kept page, WITH its body — for the popup's Save button.
 *
 * `jojo:list-captures` deliberately omits `html` (a queue of multi-megabyte
 * pages is a large structured clone to draw a list of titles). Saving needs
 * exactly one body, so it is asked for by id, when it is wanted. Gated like
 * every other popup verb: only a page served from this extension may ask.
 */
export async function onGetCapture(message, sendResponse) {
  const id = typeof message.id === 'string' ? message.id : ''
  const found = (await read()).find((c) => c.id === id)
  sendResponse(
    found
      ? { ok: true, url: found.url, title: found.title, capturedAt: found.capturedAt, html: found.html }
      : { ok: false, reason: 'That page is no longer kept.' },
  )
}

export async function onCaptureTab(message, sendResponse) {
  const tabId = typeof message.tabId === 'number' ? message.tabId : null
  if (tabId === null) {
    sendResponse({ ok: false, reason: 'No page to capture.' })
    return
  }
  // capture() reports its own outcome. This used to answer `ok: true`
  // unconditionally, which is how a page that was never stored came back
  // to the popup as "Kept.".
  sendResponse(await capture(tabId))
}

export async function onGetRouting(message, sendResponse) {
  sendResponse({ routing: await routing(), hosts: MODEL_HOSTS })
}

export async function onSetRouting(message, sendResponse) {
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
}

/*
 * Is the reader actually answering?
 *
 * An MCP `initialize` rather than a HEAD or a bare GET: markitdown-mcp
 * answers a GET with 307 and a HEAD with a redirect too, so either would
 * report "reachable" for a server that cannot speak the protocol. A handshake
 * that returns a `result` is the only answer that means what the dot claims.
 */
export async function onProbeReader(message, sendResponse) {
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
}
