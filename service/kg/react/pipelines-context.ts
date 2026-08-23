/**
 * L4 — the pipelines engine, shared by whatever wants to look at it.
 *
 * `usePipelines` used to be called by the Job Scout page directly, which made a
 * pipeline's lifetime that page's lifetime — its interval was cleared and its
 * round aborted the moment you navigated away. The file's own header promised
 * the opposite ("a pipeline is a loop that ticks while the app is running"), and
 * the panel's caption told the user "they work while this tab is open". Both
 * were true of the tab and false of the route.
 *
 * So the engine is mounted once, above the router, and the page reads it. Same
 * correction as the Assistant's, for the same reason and in the same shape: work
 * that is supposed to outlive a screen cannot be owned by one.
 *
 * The PROVIDER is app-side rather than here, because what it has to inject is
 * app-side — which model to call and how to read a job board are both platform
 * work this package may not do. This file is only the seam.
 */

import { createContext, useContext } from 'react'
import type { PipelinesState } from './use-pipelines'

export const PipelinesContext = createContext<PipelinesState | null>(null)

export function usePipelinesState(): PipelinesState {
  const state = useContext(PipelinesContext)
  if (!state) {
    throw new Error('usePipelinesState must be used inside a PipelinesProvider.')
  }
  return state
}
