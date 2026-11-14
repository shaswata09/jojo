/** Waiting on a background tab the worker opened: its load, then its settle. */

/** How long a board gets to load before the attempt is abandoned. */
export const LOAD_TIMEOUT_MS = 25000

/**
 * How long to wait after `complete` before reading the page.
 *
 * `complete` means the document finished loading, which on a board that renders
 * its results client-side is the moment BEFORE there are any results. There is
 * no event for "the framework has finished", so this is a wait, and it is the
 * least honest number in the extension. Two and a half seconds is measured
 * against LinkedIn and Workday on a warm connection; a slower board returns
 * fewer rows rather than wrong ones, which is the right way round.
 */
export const SETTLE_MS = 2500

/** Resolves when the tab reports itself loaded, or when the wait runs out. */
export function waitForLoad(tabId) {
  return new Promise((resolve) => {
    let done = false
    const finish = (loaded) => {
      if (done) return
      done = true
      chrome.tabs.onUpdated.removeListener(onUpdated)
      clearTimeout(timer)
      resolve(loaded)
    }
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') finish(true)
    }
    const timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS)
    chrome.tabs.onUpdated.addListener(onUpdated)
    // It may already be there — a cached page can complete before the listener
    // is attached, and then nothing would ever fire.
    chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === 'complete') finish(true)
      },
      () => finish(false),
    )
  })
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
