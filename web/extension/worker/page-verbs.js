/**
 * The verbs jojo's own page sends through `bridge.js`: draining the capture
 * queue, and the two that open a tab — a board scan and "From link".
 */

import { capturePage } from './capture.js'
import { QUEUE, read, withQueue } from './queue.js'
import { scanBoard } from './scan-board.js'
import { isLocalTarget } from './targets.js'

export async function onTakeCaptures(message, sendResponse) {
  // Handed over, NOT deleted.
  //
  // Emptying the queue here was a real loss: jojo validates every envelope
  // through `readCapture` after receiving it, and a capture it refuses was
  // already gone — the user saw "could not be kept" with nothing left to
  // retry and no way to find out why. The queue now shrinks only on
  // `jojo:ack-captures`, which names the ids that were actually filed.
  const queued = await read()
  sendResponse({ captures: queued })
}

export async function onAckCaptures(message, sendResponse) {
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
}

export async function onPeekCaptures(message, sendResponse) {
  sendResponse({ count: (await read()).length })
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
export async function onScanBoard(message, sendResponse) {
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
}

/*
 * The app's "From link": one address, opened, rendered and handed back.
 *
 * Bounded like the scan — a content script on jojo's own origin is the only
 * sender, and the only thing it can ask for is one http(s) page opened and
 * read — and for the same reason: opening a public page IS the feature.
 */
export async function onCaptureUrl(message, sendResponse) {
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
}
