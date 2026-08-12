/**
 * L4 — StorePhase and PersistenceHealth, as a SEPARATE context.
 *
 * Separate from KgContext on purpose: health ticks on every drain, and folding it
 * into the graph context would re-render all 34 consumers each time a write
 * succeeded.
 *
 * In Wave 1 the phase is only ever 'ready'. The store is compiled into memory
 * synchronously, so there is nothing to wait for and no way to be blocked or
 * corrupt — but the union is the full one from §3.5 and `StoreGate` is written
 * against all of it, because the arm that appears in Wave 2 is the one that must
 * not be discovered late: `phase !== 'ready'` has to mean no consumer of the
 * graph is mounted, and a gate that only ever saw one arm would be a gate nobody
 * had tested.
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
