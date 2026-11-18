import { useEffect, useState } from 'react'

/**
 * One tab of this browser elected to do a piece of background work, with
 * handover when it closes.
 *
 * The MCP link already elects one tab (`runElected` in `mcp-link.ts`); this is
 * the same Web Lock idea for work that is not a loop with an end — the scout's
 * scheduled rounds and the background reader. Every open tab used to run both:
 * a due round started once per tab, so each tab made its own model calls and
 * opened its own board tabs, and each round's commit reached the other tab as
 * a remote change that cleared its undo stack while the person did nothing.
 *
 * The lock is held for as long as the tab wants it, and the browser releases a
 * closed or crashed tab's lock itself — which is the handover: the next tab in
 * line is granted it and starts the work. No heartbeat, no storage key that a
 * dead tab leaves behind.
 *
 * Without `navigator.locks` (every browser jojo supports has it; a test
 * environment may not) the tab leads, which is how it behaved before.
 */

/**
 * Waits in line for `name`, calls `onLead` once this tab holds it, and holds it
 * until `signal` aborts. Resolves when the lock is let go, or at once when the
 * wait itself was aborted.
 */
export async function waitToLead(
  name: string,
  signal: AbortSignal,
  onLead: () => void,
  locks: LockManager | undefined = typeof navigator === 'undefined' ? undefined : navigator.locks,
): Promise<void> {
  if (signal.aborted) return
  if (locks === undefined) {
    onLead()
    return
  }
  try {
    await locks.request(name, { signal }, () => {
      /*
       * Asked again, because Chrome grants a request that was aborted in the
       * same task it was made: it stays in the queue (see `useTabLeader`).
       * Granted after its wait was called off, it must not lead — the lock is
       * let go at once below, as the signal is already aborted. The hook
       * guards this too; this keeps the function's own promise for any caller
       * (review 3, coverage-4).
       */
      if (!signal.aborted) onLead()
      return new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => resolve(), { once: true })
      })
    })
  } catch {
    // Aborted while waiting in line: the tab is closing, or stopped wanting it.
  }
}

/**
 * Out of line the moment the page is hidden for navigation, and back in line
 * when it is shown again from the back/forward cache. Returns what stops
 * listening.
 *
 * `withdraw` runs synchronously on `pagehide` — a state update would not
 * render before the page is frozen. Measured: a waiting tab that navigated
 * away left its old document's request queued, and on handover that frozen
 * document was granted the lock and held it until the browser evicted it from
 * the back/forward cache (ten seconds for a reload; indefinitely, in one
 * measurement, for a same-tab navigation). `askAgain` runs on a `pageshow`
 * that restored the page from that cache, whose request was withdrawn.
 *
 * Shared by every Web Lock election in the app — the scout's (`useTabLeader`)
 * and the MCP link's (`McpLinkProvider`), which lacked it (review 3,
 * multitab-2).
 */
export function withdrawOnPageHide(
  withdraw: () => void,
  askAgain: () => void,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  const onHide = () => {
    withdraw()
  }
  const onShow = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) askAgain()
  }
  target.addEventListener('pagehide', onHide)
  target.addEventListener('pageshow', onShow)
  return () => {
    target.removeEventListener('pagehide', onHide)
    target.removeEventListener('pageshow', onShow)
  }
}

/** The lock the scout's scheduler and background reader are elected by. */
export const SCOUT_LOCK = 'jojo-scout'

/**
 * Whether this tab holds `name`. False while it waits behind another tab, true
 * from the moment that tab closes and the lock passes here.
 */
export function useTabLeader(name: string): boolean {
  const [leader, setLeader] = useState(false)
  /** Bumped when the page comes back from the back/forward cache, to ask again. */
  const [shown, setShown] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    /*
     * A task later, not at once. Measured in Chrome: a queued request aborted
     * in the same task it was made stays in the queue — and React's
     * development double-mount does exactly that, so every waiting tab held
     * two places in line. The orphan is harmless (granted, it lets go at once,
     * its signal being aborted) but it is a place in line nobody is standing
     * in. Started after the first mount's cleanup, only the real one is made.
     */
    const start = window.setTimeout(() => {
      void waitToLead(name, controller.signal, () => {
        if (!controller.signal.aborted) setLeader(true)
      })
    }, 0)
    // See `withdrawOnPageHide`. A page restored from the cache asks again (`shown`).
    const stopListening = withdrawOnPageHide(
      () => {
        window.clearTimeout(start)
        controller.abort()
      },
      () => {
        setShown((n) => n + 1)
      },
    )
    return () => {
      stopListening()
      window.clearTimeout(start)
      controller.abort()
      setLeader(false)
    }
  }, [name, shown])

  return leader
}
