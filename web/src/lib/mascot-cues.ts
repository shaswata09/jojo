/**
 * Which gesture the mascot plays when an application moves forward a column.
 *
 * Its own module because nothing here mounts a component in a test, so the two
 * decisions — is this move an advance, and which gesture does it draw — have to
 * sit somewhere vitest can reach. The wiring is in
 * `components/applications/use-row-actions.tsx`, the one path a stage change
 * takes.
 */
import { STAGES, type Stage } from '@/data/seed'
import type { MascotPose } from '@/lib/mascot-context'

/**
 * The three an advance can draw, written against the pose vocabulary so
 * renaming a gesture there is a compile error here rather than a robot that
 * silently stops moving.
 *
 * Kept short on purpose. These are the poses that read as approval — `shake`
 * and `recoil` would read as a verdict on the application — and `dance` already
 * runs 2600ms against `nod`'s 900, so a wider pool would mostly add length.
 */
export const ADVANCE_GESTURES = ['nod', 'spin', 'dance'] as const satisfies readonly MascotPose[]

export type AdvanceGesture = (typeof ADVANCE_GESTURES)[number]

/**
 * Later in the board's own column order — and not into the last column.
 *
 * `STAGES` is what the board maps over, so "the next column" is an index in it
 * rather than a second list that could drift. Closed is the exception: it sits
 * last, so by index alone every drag into it advances, but an application
 * closes as `rejected`, `withdrawn` or `ghosted` far more often than
 * `accepted`, and the stage on its own does not say which — `outcome` is asked
 * for separately. A dance over a rejection is worse than no dance, so the last
 * column is the one forward move that draws nothing.
 */
export function isAdvance(from: Stage, to: Stage): boolean {
  if (to === 'closed') return false
  const column = (stage: Stage) => STAGES.findIndex((s) => s.id === stage)
  return column(to) > column(from)
}

/**
 * One of the three, never the one that just played.
 *
 * `roll` is the caller's random number in [0, 1), passed in rather than taken
 * from `Math.random()` here so a test can pin the choice. Excluding `previous`
 * makes the randomness more visible rather than less: uniform picks from three
 * repeat often enough that two dances in a row read as a stuck animation
 * instead of a coin flip.
 */
export function advanceGesture(roll: number, previous?: AdvanceGesture | null): AdvanceGesture {
  const pool = ADVANCE_GESTURES.filter((gesture) => gesture !== previous)
  // Clamped, and NaN folded to 0, before it indexes: a roll off the end would
  // otherwise miss the pool and fall to the last resort below, which is the one
  // value that can be the gesture that just played.
  const spread = Number.isFinite(roll) ? roll * pool.length : 0
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(spread)))
  return pool[index] ?? ADVANCE_GESTURES[0]
}
