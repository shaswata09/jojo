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
export async function injectIntoOpenTabs() {
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
