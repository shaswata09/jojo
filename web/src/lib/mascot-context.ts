import { createContext, useContext } from 'react'

/**
 * The gesture vocabulary. `idle` is the resting state; everything else is a
 * one-shot that plays and falls back to idle.
 *
 * Whole-body only. The arm joints were tried and abandoned: see spline-rig.ts
 * for what the measurements actually showed.
 */
export type MascotPose =
  | 'idle'
  | 'nod' // agreement, "done", a saved change
  | 'shake' // refusal, "nothing found", a failed action
  | 'bow' // greeting, thanks — plays itself when the robot first appears
  | 'leanIn' // curiosity, paying attention
  | 'wobble' // uncertainty, "hmm"
  | 'bounce' // pleased, a small win
  | 'spin' // delight, a milestone
  | 'recoil' // surprise, an error
  | 'startle' // attention — a reminder coming due
  | 'dance' // a result worth celebrating at length

/**
 * How long each one-shot runs, in ms. Single source of truth: the 3D rig reads
 * it to size its curves and the SVG fallback feeds it straight into
 * `animation-duration`, so the two renderers cannot drift apart.
 */
export const POSE_MS: Record<MascotPose, number> = {
  idle: 0,
  nod: 900,
  shake: 700,
  bow: 1400,
  leanIn: 1300,
  wobble: 1100,
  bounce: 1100,
  spin: 1200,
  recoil: 700,
  startle: 500,
  dance: 2600,
}

/** Every gesture, in the order a person would want to try them. */
export const GESTURES: { pose: Exclude<MascotPose, 'idle'>; label: string }[] = [
  { pose: 'nod', label: 'Nod' },
  { pose: 'shake', label: 'Shake' },
  { pose: 'bow', label: 'Bow' },
  { pose: 'leanIn', label: 'Lean in' },
  { pose: 'wobble', label: 'Wobble' },
  { pose: 'bounce', label: 'Bounce' },
  { pose: 'spin', label: 'Spin' },
  { pose: 'recoil', label: 'Recoil' },
  { pose: 'startle', label: 'Startle' },
  { pose: 'dance', label: 'Dance' },
]

export type MascotContextValue = {
  pose: MascotPose
  /**
   * Increments on every `play()`. Replaying the pose that is already running
   * leaves `pose` unchanged, so the CSS class never toggles and the browser has
   * no reason to restart the animation — this counter is what tells the mascot
   * a fresh gesture was asked for.
   */
  seq: number
  /** Plays a gesture, then returns to idle. A second call interrupts the first. */
  play: (pose: MascotPose) => void
}

/**
 * Defaults to a no-op rather than null.
 *
 * Every caller of `play()` is decorating something — a save, an empty result.
 * A decorative flourish must never be able to take down the page that triggered
 * it, so a missing provider degrades to silence instead of throwing.
 */
export const MascotContext = createContext<MascotContextValue>({
  pose: 'idle',
  seq: 0,
  play: () => {},
})

export function useMascot() {
  return useContext(MascotContext)
}
