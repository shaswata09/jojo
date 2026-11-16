import { createContext, useContext } from 'react'

/**
 * The gesture vocabulary. `idle` is the resting state; everything else is a
 * one-shot that plays and falls back to idle.
 *
 * First whole-body only, by the owner's choice (Q033): arm gestures on the
 * old Spline robot read as a limb flailing near a robot. With a rigged model
 * the owner allowed the arms back (2026-11-15) — the dance pumps its fists, a
 * shrug opens them — while the five gestures they dropped stay dropped, and
 * every gesture still moves the body or head. Seven more came the same day
 * (Flex to Robot dance), with the eyes able to wink, close and turn to hearts,
 * and seven hand gestures after them (Jazz hands to Drumroll, Q319).
 * See `robot-rig.ts`.
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
  | 'shrug' // "no idea" — nothing to suggest, an empty search
  | 'lookAround' // searching, scanning
  | 'hopSpin' // a big win
  | 'stretch' // waking up, a long task finished
  | 'flex' // strength — a hard thing done
  | 'jab' // fighting spirit — a punch combo
  | 'powerUp' // charging up, then a burst — starting something big
  | 'doze' // nodding off, then jolting awake — a long wait
  | 'wink' // a shared joke, "got it"
  | 'love' // heart eyes — something lovely
  | 'robot' // the robot dance: stiff, ticking arms
  | 'jazz' // jazz hands — ta-da!
  | 'point' // "over there" — look at this
  | 'hero' // hands on hips — ready for anything
  | 'handsUp' // hands up — "I give up", a mistake owned
  | 'disco' // the up-and-across disco point
  | 'typing' // busy at a keyboard — working on it
  | 'drumroll' // a drumroll — the big reveal

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
  shrug: 1300,
  lookAround: 2400,
  hopSpin: 1900,
  stretch: 2000,
  flex: 1800,
  jab: 2000,
  powerUp: 2200,
  doze: 2800,
  wink: 1100,
  love: 2200,
  robot: 2400,
  jazz: 2000,
  point: 1800,
  hero: 2000,
  handsUp: 2000,
  disco: 2600,
  typing: 2000,
  drumroll: 2000,
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
  { pose: 'shrug', label: 'Shrug' },
  { pose: 'lookAround', label: 'Look around' },
  { pose: 'hopSpin', label: 'Hop spin' },
  { pose: 'stretch', label: 'Stretch' },
  { pose: 'flex', label: 'Flex' },
  { pose: 'jab', label: 'Punch combo' },
  { pose: 'powerUp', label: 'Power up' },
  { pose: 'doze', label: 'Doze off' },
  { pose: 'wink', label: 'Wink' },
  { pose: 'love', label: 'Love' },
  { pose: 'robot', label: 'Robot dance' },
  { pose: 'jazz', label: 'Jazz hands' },
  { pose: 'point', label: 'Point' },
  { pose: 'hero', label: 'Hero pose' },
  { pose: 'handsUp', label: 'Hands up' },
  { pose: 'disco', label: 'Disco' },
  { pose: 'typing', label: 'Typing' },
  { pose: 'drumroll', label: 'Drumroll' },
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
