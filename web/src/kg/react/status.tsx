/**
 * L4 — the status provider, mounted OUTSIDE KgProvider.
 *
 * Boot phase and persistence health. First paint shows real chrome plus skeleton
 * panels — no counts, no zeros, no empty states, no spinner. An escalating UI
 * creates the anxiety it is meant to relieve, so nothing escalates before 600ms.
 *
 * Outside `KgProvider` and not inside it because health ticks on every drain of
 * the write queue: a banner that said "saving…" from inside the graph context
 * would have re-rendered every board, every list and every chart to do it.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PersistenceHealth, Repository } from '@/kg/repo/repository'
import { StatusContext } from './status-context'
import type { StorePhase, StoreStatus } from './status-context'

export type StoreStatusProviderProps = {
  repo: Repository
  boot: StorePhase
  children: ReactNode
}

export function StoreStatusProvider({ repo, boot, children }: StoreStatusProviderProps) {
  const health = usePersistenceHealth(repo)
  const value = useMemo<StoreStatus>(() => ({ boot, health }), [boot, health])
  return <StatusContext value={value}>{children}</StatusContext>
}

/**
 * Subscribed rather than polled, and read through state rather than
 * `useSyncExternalStore`'s snapshot.
 *
 * `repo.health` is a getter over a mutable object in the queue, so it returns a
 * new reading each drain and `useSyncExternalStore` would have compared two
 * fresh objects and re-rendered forever. Copying it into state on the tick is
 * the version that settles.
 *
 * The cost, which is the constraint on any future fix: what is on screen is a
 * COPY taken at the last tick, so the banner cannot self-correct on an unrelated
 * re-render (AUDIT A5). If the queue's health ever changes without notifying —
 * a field mutated in place, a path that returns early before `notifyHealth` —
 * the banner keeps showing the stale reading indefinitely rather than for one
 * frame. `subscribeHealth` firing on every transition is load-bearing here, not
 * merely an optimisation over polling.
 */
function usePersistenceHealth(repo: Repository): PersistenceHealth {
  const [health, setHealth] = useState<PersistenceHealth>(() => repo.health)
  useEffect(() => repo.subscribeHealth(setHealth), [repo])
  return health
}
