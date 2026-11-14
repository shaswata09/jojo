/**
 * A badge on one tab, best effort. The tab may have closed since the capture
 * started — `setBadgeText` then REJECTS, and that rejection escaped every
 * handler that awaited it, so the reply never came and the caller sat out its
 * whole timeout. A badge is decoration; it never decides an outcome.
 */
export async function badge(tabId, text, title) {
  try {
    await chrome.action.setBadgeText({ tabId, text })
    if (title !== undefined) await chrome.action.setTitle({ tabId, title })
  } catch {
    // The tab is gone. Nothing to mark.
  }
}
