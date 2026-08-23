/**
 * L4 — the running conversations, as a SEPARATE context.
 *
 * Separate from KgContext for the reason `status-context.ts` gives about its
 * own: this ticks on every token-ish event of every run, and folding it into the
 * graph context would re-render every consumer of the graph — dozens of files —
 * each time an agent said a word.
 *
 * It must be mounted ABOVE the router. That is the whole point: a run keyed by
 * conversation is only useful if it outlives the page that started it, and every
 * other provider in this app that owns something outliving a route — the toasts,
 * the dialog host, the store itself — is mounted at the same level for the same
 * reason.
 */

import { createContext, useContext, useSyncExternalStore } from 'react'
import type { AgentRun, AgentRuns } from './agent-runs'
import type { NodeId } from '../core/model'

export const AgentRunsContext = createContext<AgentRuns | null>(null)

export function useAgentRuns(): AgentRuns {
  const runs = useContext(AgentRunsContext)
  if (!runs) {
    throw new Error('useAgentRuns must be used inside an AgentRunsProvider.')
  }
  return runs
}

/**
 * One conversation's live state, or undefined when it is not running.
 *
 * `getSnapshot` returns the stored object, which the registry replaces only when
 * something changed — so React's reference comparison settles rather than
 * looping. A getter that rebuilt the object per call would re-render forever,
 * which is the failure `kg-context.ts` documents for the graph snapshot.
 */
export function useAgentRun(threadId: NodeId | null): AgentRun | undefined {
  const runs = useAgentRuns()
  return useSyncExternalStore(
    runs.subscribe,
    () => (threadId === null ? undefined : runs.get(threadId)),
    () => undefined,
  )
}

/** Which conversations are working, for a list that wants to say so. */
export function useBusyThreads(): readonly NodeId[] {
  const runs = useAgentRuns()
  return useSyncExternalStore(runs.subscribe, runs.busyThreads, runs.busyThreads)
}

/**
 * Every run parked on a person, for a host that renders the question.
 *
 * App-wide rather than per-page: a destructive call reached after the user
 * walked away has to be answerable from wherever they are, or the run waits
 * forever and the exchange is never saved.
 */
export function useWaitingRuns(): readonly AgentRun[] {
  const runs = useAgentRuns()
  return useSyncExternalStore(runs.subscribe, runs.waiting, runs.waiting)
}
