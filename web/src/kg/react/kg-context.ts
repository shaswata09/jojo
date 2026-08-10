/**
 * L4 — the context object, the useKg() guard, and the one subscription.
 *
 * Layer rule: `kg/react` is the only layer that imports React.
 *
 * `useGraph()` is the ONLY place anything subscribes to the repository. Every
 * hook below it reads the snapshot it returns and projects from that, so one
 * commit is one re-render pass rather than one per collection — which is what
 * the old store got for free by being a single `useReducer` and what a second
 * subscription would quietly take away.
 */

import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Instant } from '@/kg/core/model'
import type { GraphSnapshot } from '@/kg/core/snapshot'
import type { Repository } from '@/kg/repo/repository'
import type { ToolRuntime } from '@/kg/tools/runtime'
import type { Projections } from './projections'

export type KgContextValue = {
  repo: Repository
  runtime: ToolRuntime
  /**
   * The clock, injected from outside `src/kg` (D26).
   *
   * It is on the context rather than read from a module because the demo's
   * pinned today is a fixture decision: `TODAY` lives in `@/data/timeline` and
   * nothing under `src/kg` may import it. A tool stamping a completion with the
   * wall clock while every label on screen is measured against the seed's today
   * reads as "Completed in 10 months".
   */
  now: () => Instant
  /**
   * The epoch-keyed projections, created once per provider.
   *
   * On the context rather than at module scope because they close over `today`
   * and hold a cache: two providers in one process — a test, or a future
   * side-by-side comparison — would otherwise serve each other's rows, and the
   * cache would never be collected.
   */
  projections: Projections
  /** 'YYYY-MM-DD' from `now()`, read once so no two rows disagree about it. */
  today: string
}

export const KgContext = createContext<KgContextValue | null>(null)

export function useKg(): KgContextValue {
  const ctx = useContext(KgContext)
  if (!ctx) throw new Error('useKg must be used inside <KgProvider>')
  return ctx
}

/**
 * The committed graph, re-read on every commit.
 *
 * `repo.getSnapshot()` mints a fresh reading per commit and returns the same one
 * in between, which is exactly the contract `useSyncExternalStore` compares on.
 * The snapshot underneath is mutated in place and never rebuilt, so a provider
 * that handed the mutable object back would return one reference forever and not
 * a card in the app would ever re-render — a total, silent failure.
 */
export function useGraph(): GraphSnapshot {
  const { repo } = useKg()
  return useSyncExternalStore(repo.subscribe, repo.getSnapshot, repo.getSnapshot)
}
