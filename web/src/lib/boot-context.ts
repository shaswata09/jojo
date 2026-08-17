/**
 * What the boot gate knows, and the four things only it can do about a bad boot.
 *
 * Separate from `StoreStatusProvider` (`kg/react/status.tsx`) rather than folded
 * into it, because that provider takes a `Repository` and two of the states below
 * do not have one: while IndexedDB is still answering there is no repository yet,
 * and a corrupt store never produces one at all. A gate that read its phase from
 * a provider it could only mount once the phase was `ready` would be a gate that
 * cannot see the cases it exists for.
 *
 * `StorePhase` is still the public reading — it is what §3.5 specifies and what
 * `useStoreStatus()` serves to anything inside the app. This is the layer above:
 * the composition root's own view, held before and outside the graph.
 */

import { createContext, useContext } from 'react'
import type { Session } from '@jojo/service/repo/boot'
import type { Rows } from '@jojo/service/storage/driver'
import type { DataSetChoice } from '@/lib/data-set'

export type BootState =
  /** IndexedDB has not answered yet. No consumer of the graph may be mounted. */
  | { phase: 'loading' }
  /**
   * `firstRun` is D24's answer, carried up rather than re-derived.
   *
   * It is `outcome: 'first-run'` — the meta row was ABSENT when this tab opened
   * — and it is the only thing the first-run fork may key off. The tempting
   * alternative is `useStoreAdmin().isEmpty`, which is a reading of the graph and
   * says "yes" to a user who chose *Start empty* and came back: the modal would
   * then reappear on every reload, asking them to make a decision they already
   * made and cannot get out of, which is precisely the bug the meta row exists
   * to prevent.
   *
   * It goes false the moment the choice is taken, so the modal leaves with the
   * decision rather than waiting for a reload to notice.
   */
  | { phase: 'ready'; session: Session; hydratedAt: number; firstRun: boolean }
  /**
   * Storage refused us, and the session behind this is the in-memory one.
   *
   * The app runs. It just cannot promise anything, which is what the banner says
   * — §5's demoable for this wave is that a private-browsing window "shows an
   * honest banner and still runs", and a wall instead of the app would make a
   * browser setting look like a broken build.
   */
  | {
      phase: 'unavailable'
      reason: 'blocked' | 'unsupported'
      detail: string
      session: Session
      hydratedAt: number
    }
  /**
   * The store is there and cannot be read. There is deliberately no session.
   *
   * Reseeding to make the app look healthy is the single worst outcome available
   * here (R-1), so this arm carries no repository at all: there is nothing for a
   * card to render from and nothing that could quietly write over what is on
   * disk. `rescued` is whatever rows came back before the read failed, and the
   * recovery panel offers them as a download before anything else.
   */
  | { phase: 'corrupt'; detail: string; rescued: Rows | null }

export type BootValue = {
  state: BootState
  /**
   * Another tab is upgrading the database and this tab has closed its connection.
   *
   * Not a phase: it arrives long after boot, on a session that was working a
   * second ago, and the records on screen are still the ones the user was
   * reading. Only the saving has stopped — which is why it is a banner with a
   * reload in it rather than a state that replaces the app.
   */
  interrupted: boolean
  /**
   * True while a retry, a start-fresh or a data-set write is in flight, so
   * whatever is on screen can say so and stop taking the same press twice.
   */
  busy: boolean
  /**
   * The first-run fork is open: no meta row was found and nobody has chosen yet.
   *
   * False for every returning user, false while the store is still hydrating —
   * there is no `firstRun` to read until boot has answered — and false on the
   * in-memory session an `unavailable` boot hands back, because nothing chosen
   * there could be remembered and asking would be a promise this app cannot
   * keep.
   */
  needsDataChoice: boolean
  /**
   * Writes the chosen set of records AND the meta row that remembers it.
   *
   * One entry point for both callers — the first-run fork and Settings — because
   * they are the same write and the only difference is who is asking. Resolves
   * `true` when the store now holds the choice; `false` means the write failed
   * and a toast has already said so, which is what lets the first-run modal stay
   * open rather than dismissing itself over a store it did not manage to change.
   */
  chooseDataSet: (choice: DataSetChoice) => Promise<boolean>
  /** `resetBoot()` and a FRESH driver — a failed boot closed the old one. */
  retry: () => void
  /** Deletes the database and boots again. Never reachable without a confirmation. */
  startFresh: () => void
  /**
   * Disposes the session so nothing holds the database open.
   *
   * Settings' "clear browser storage" is the only caller: `deleteDatabase` with
   * our own connection open fires `blocked` and queues the delete until the tab
   * closes, so the wipe reported success and the records were still there on the
   * next load. The caller reloads immediately afterwards — after this returns
   * there is a React tree above a repository whose driver is shut.
   */
  closeStore: () => void
}

export const BootContext = createContext<BootValue | null>(null)

export function useBoot(): BootValue {
  const ctx = useContext(BootContext)
  if (!ctx) throw new Error('useBoot must be used inside <StoreProvider>')
  return ctx
}

/** The session, when the state has one. `null` while loading and when corrupt. */
export const sessionOf = (state: BootState): Session | null =>
  state.phase === 'ready' || state.phase === 'unavailable' ? state.session : null
