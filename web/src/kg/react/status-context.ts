/**
 * L4 — StorePhase and PersistenceHealth, as a SEPARATE context.
 *
 * Separate from KgContext on purpose: health ticks on every drain, and folding it
 * into the graph context would re-render every consumer of the graph — 47 files
 * import one of those hooks directly — each time a write succeeded.
 *
 * `phaseOf` in `src/lib/store.tsx` is the only producer, and it emits four of the
 * five arms below: 'loading', 'ready', 'unavailable' and 'corrupt'. 'seeding' is
 * emitted NOWHERE. It is here because §3.5 specifies it, and it has stayed
 * unreachable through four waves — so treat it as a spec arm awaiting a producer,
 * not as a state anything has ever been in. (The paragraph this replaces claimed
 * the opposite of all of that: that the phase was only ever 'ready', which was
 * true in Wave 1 only, and that 'seeding' was the arm that must not be
 * discovered late. It is the one arm that never arrived.)
 *
 * `StoreGate` does not switch on this union. It reads `useBoot()` from
 * `@/lib/boot-context` and switches on `BootState`, which is a different and
 * richer type — it carries the session and the rescued rows, neither of which
 * belongs in a public reading. Worth knowing before adding an arm here and
 * expecting the gate to grow one.
 */

import { createContext, useContext } from 'react'
import type { StoreMeta } from '@/kg/repo/meta'
import type { PersistenceHealth } from '@/kg/repo/repository'

export type StorePhase =
  | { phase: 'loading' }
  | { phase: 'seeding' }
  | { phase: 'ready'; dataSet: StoreMeta['dataSet']; hydratedAt: number }
  | { phase: 'unavailable'; reason: 'blocked' | 'unsupported' }
  | { phase: 'corrupt'; detail: string; rescued: boolean }

export type StoreStatus = { boot: StorePhase; health: PersistenceHealth }

export const StatusContext = createContext<StoreStatus | null>(null)

export function useStoreStatus(): StoreStatus {
  const ctx = useContext(StatusContext)
  if (!ctx) throw new Error('useStoreStatus must be used inside <StoreStatusProvider>')
  return ctx
}
