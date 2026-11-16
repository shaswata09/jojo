import { useSyncExternalStore } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { TOUR_STEPS } from '@/components/tour/steps'
import { report } from '@/lib/analytics'

/**
 * Whether the tour is running, and on which step — at module scope, so the
 * two places that start it (the first-run offer and How to use) and the
 * overlay that shows it can all reach it without a shared provider: the
 * offer is an overlay beside the navigator, How to use is a screen inside it.
 *
 * WHERE PROGRESS LIVES. AsyncStorage, beside the onboarding flags — not the
 * graph. "How far through a tutorial you are" is not a record the user
 * authored: in the graph it would show in the audit log as a write they did
 * not make, ride along in a backup and cross to the other device on Transfer.
 * The stored step is clamped on read, because steps get added and removed and
 * a stale number must not strand anyone on a step that no longer exists.
 */
const PROGRESS_KEY = 'jojo/tour/step'

type TourState = { active: boolean; step: number; dir: 1 | -1 }

let state: TourState = { active: false, step: 0, dir: 1 }
const listeners = new Set<() => void>()

function set(next: TourState): void {
  state = next
  for (const l of listeners) l()
}

export function useTourState(): TourState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** The saved step, clamped; 0 when there is none or it no longer exists. */
export async function readProgress(): Promise<number> {
  try {
    const parsed = Number.parseInt((await AsyncStorage.getItem(PROGRESS_KEY)) ?? '', 10)
    return Number.isFinite(parsed) && parsed > 0 && parsed < TOUR_STEPS.length ? parsed : 0
  } catch {
    return 0
  }
}

/** Opens the tour — at the saved step unless told where. */
export async function startTour(from?: number): Promise<void> {
  const step = from ?? (await readProgress())
  set({ active: true, step, dir: 1 })
  void report('tour_used', { outcome: 'started' })
}

export function goToStep(step: number): void {
  const at = Math.min(Math.max(step, 0), TOUR_STEPS.length - 1)
  set({ active: true, step: at, dir: at < state.step ? -1 : 1 })
  void AsyncStorage.setItem(PROGRESS_KEY, String(at)).catch(() => {})
}

/** Closed early: the place is kept, and How to use offers to resume. */
export function leaveTour(): void {
  set({ ...state, active: false })
}

/** Finished: the bookmark is cleared, so the next run starts at the start. */
export function finishTour(): void {
  void AsyncStorage.removeItem(PROGRESS_KEY).catch(() => {})
  set({ active: false, step: 0, dir: 1 })
  void report('tour_used', { outcome: 'finished' })
}
