/**
 * L4 — the context object, the useKg() guard, and the one subscription.
 *
 * Layer rule: `kg/react` is the only layer that imports React.
 *
 * `useGraph()` is the only subscription that RENDERS. Every hook below it reads
 * the snapshot this one returns and projects from that, so one commit is one
 * re-render pass rather than one per collection — which is what the old store
 * got for free by being a single `useReducer`, and what a second state-setting
 * subscriber would quietly take away.
 *
 * Stated that way rather than as "the only subscriber", which this comment used
 * to claim and which is false: `StoreProvider` in `src/lib/store.tsx` also calls
 * `repo.subscribe`, to ask for persistent storage after the user's first real
 * write. That one is fine precisely because it sets no React state — it flips a
 * local boolean and fires a browser request — so the property worth defending
 * survives it. Anyone adding a subscriber should check it against that property,
 * not against a count they can falsify in one grep.
 */

import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Instant } from '../core/model'
import type { GraphSnapshot } from '../core/snapshot'
import type { Repository } from '../repo/repository'
import type { ToolRuntime } from '../tools/runtime'
import type { Projections } from './projections'

export type KgContextValue = {
  repo: Repository
  runtime: ToolRuntime
  /**
   * The clock, injected from outside `kg` (D26).
   *
   * The reasoning here used to be that the demo's today was PINNED and the graph
   * must not read the wall clock past it. That reversed: the app runs on the
   * wall clock (`TODAY` in `src/lib/today.ts`, from `now()`), and it is the
   * fixtures that move — `seedOffset` in `@/data/timeline` shifts the seed's
   * `SEED_TODAY` to meet whatever day it actually is.
   *
   * The injection survives the reversal, so do not undo it while tidying the
   * premise away. What it buys now is that `kg` names no clock at all: a
   * layer that called `Date.now()` directly would be untestable without faking
   * time globally, would drift from the `today` every label on screen is
   * measured against, and would break the RN and Electron shells that supply
   * their own. `check-platform.mjs` enforces the same rule from outside.
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
