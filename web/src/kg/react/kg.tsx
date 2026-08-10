/**
 * L4 — KgProvider.
 *
 * WHAT THIS PROVIDER DOES NOT DO
 *
 * It does not fetch, own state, derive anything, or decide when the app is
 * ready. `useSyncExternalStore(repo.subscribe, repo.getSnapshot)` — in
 * `kg-context.ts`, called once — is its only subscription, and the boot gate
 * lives in a separate provider so a persistence-health tick does not re-render
 * every consumer. It does not create the repository either: it is handed one
 * that is already open, which is why there is no loading branch in this file.
 *
 * It does not know what platform it is on. It used to: the ⌘Z binding read
 * `window` directly from here, which made the whole shared React layer
 * unmountable outside a browser. Both platform behaviours arrive through the
 * `Host` port and default to the headless host, so a renderer that supplies
 * nothing still mounts.
 *
 * And it does not read a clock. `now` is a prop (D26) — `src/lib/today.ts`
 * supplies the web one — because the day every projection is measured against is
 * a decision the app shell makes, not one this layer may make for it.
 *
 *
 * A RELOAD IS NO LONGER THE RESET BUTTON
 *
 * For anyone arriving from the reducer era, or from a comment written in it:
 * records are in IndexedDB from Wave 2 onward. "Just reload it" was honest
 * recovery advice while the store lived in a `useReducer` and it is now the
 * advice that loses nothing and fixes nothing — the same graph is rehydrated
 * from disk, corruption included. The recovery paths are the ones
 * `StoreRecovery` offers: export what could be read, or start fresh, both
 * explicit and both destructive on purpose.
 *
 * The consequences reach further than the copy. A derived value written into
 * `props` used to be self-correcting because the next reload wiped it; it now
 * persists and starts lying (D25 — `daysAgo` is the worked example). An undo
 * stack is no longer bounded by the session. And "it works after a refresh" has
 * stopped being evidence that anything was fixed.
 */

import { useCallback, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Instant } from '@/kg/core/model'
import { dayOf } from '@/kg/core/project'
import type { Repository } from '@/kg/repo/repository'
import { createToolRuntime } from '@/kg/tools/runtime'
import type { ToolRuntime } from '@/kg/tools/runtime'
import { headlessHost } from './host'
import type { Host, UndoDirection } from './host'
import { KgContext } from './kg-context'
import type { KgContextValue } from './kg-context'
import { createProjections } from './projections'
import { useToast } from './toast'

export type KgProviderProps = {
  repo: Repository
  /** Injected from outside `src/kg` (D26). `src/lib/today.ts` is the web one. */
  now: () => Instant
  /**
   * The platform. Omitted means headless — no shortcuts, no flush on suspend.
   *
   * Defaulting to the WEB host would have been the smaller diff and the wrong
   * one: this module would then import a module that reads `window`, putting the
   * DOM back inside `src/kg` through the import graph. The web app passes
   * `webHost` at its single mount point (`src/lib/store.tsx`) instead.
   */
  host?: Host
  children: ReactNode
}

export function KgProvider({ repo, now, host = headlessHost, children }: KgProviderProps) {
  // The calendar day the whole projection layer is measured against. Read once
  // per provider: `daysAgo` and every bucket label are relative to it, and a
  // value that changed between two projections in the same render would put two
  // cards on screen disagreeing about what "today" was.
  //
  // Through `dayOf`, not `.slice(0, 10)`. Slicing takes the UTC day out of the
  // instant, which was harmless while `now` was pinned to local noon and wrong
  // the moment it became the real clock: after 5pm in Austin every row on the
  // dashboard would have been measured against tomorrow, so today's reminders
  // read as overdue and a record touched a minute ago read as "1 day ago".
  const today = dayOf(now())

  const runtime = useMemo(() => createToolRuntime({ repo, now }), [repo, now])
  const projections = useMemo(() => createProjections(today), [today])

  const value = useMemo<KgContextValue>(
    () => ({ repo, runtime, now, projections, today }),
    [repo, runtime, now, projections, today],
  )

  useHostBindings(host, repo, runtime)

  return <KgContext value={value}>{children}</KgContext>
}

/**
 * The two things the platform tells us, and what the graph does about each.
 *
 * One hook rather than two so the whole surface `kg/react` exposes to a host is
 * readable in one screen. If a third binding ever lands here, that is the signal
 * to re-read `host.ts` and ask whether it is really graph state — a port that
 * grows to cover everything is `window` with extra steps.
 */
function useHostBindings(host: Host, repo: Repository, runtime: ToolRuntime) {
  const { toast } = useToast()

  const onUndoRequest = useCallback(
    (direction: UndoDirection) => {
      const result = direction === 'redo' ? runtime.redo() : runtime.undo()
      if (!result.ok) {
        // Said out loud rather than swallowed. A shortcut that does nothing and
        // reports nothing reads as a shortcut that is not wired up, and the next
        // thing the user does is press it again.
        toast({ title: result.errors[0]?.message ?? 'Nothing to undo.' })
        return
      }
      toast({
        title: result.announcement.title,
        ...(result.announcement.description === undefined
          ? {}
          : { description: result.announcement.description }),
      })
    },
    [runtime, toast],
  )

  useEffect(() => host.onUndoRequest(onUndoRequest), [host, onUndoRequest])

  // Wired in Wave 1, when the driver was still in RAM and a flush had nothing to
  // save. The alternative was to add it alongside the IndexedDB driver — which is
  // how a durability seam comes to be designed at the same moment it first
  // matters, against a queue whose failure modes nobody has watched. Bound early,
  // it was exercised by every session for a wave before it had to work.
  useEffect(() => host.onSuspend(() => repo.flush()), [host, repo])
}
