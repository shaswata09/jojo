import { i18next } from '@/i18n/i18n'
import { createContext, useContext } from 'react'

/**
 * The gesture vocabulary. `idle` is the resting state; everything else is a
 * one-shot that plays and falls back to idle.
 *
 * First whole-body only, by the owner's choice (Q033): arm gestures on the
 * old Spline robot read as a limb flailing near a robot. With a rigged model
 * the owner allowed the arms back (2026-11-15) — the dance pumps its fists, a
 * shrug opens them — and every gesture still moves the body or head. Of the
 * five gestures they dropped, Hello came back as Hi (a right-hand wave, the
 * greeting on load) at their request; the other four stay dropped. Seven more came the same day
 * (Flex to Robot dance), with the eyes able to wink, close and turn to hearts,
 * and seven hand gestures after them (Jazz hands to Drumroll, Q319).
 * See `robot-rig.ts`.
 */
export type MascotPose =
  | 'idle'
  | 'nod' // agreement, "done", a saved change
  | 'shake' // refusal, "nothing found", a failed action
  | 'hi' // a wave of the right hand — the robot's hello as the page first loads
  | 'bow' // greeting, thanks
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
  hi: 2000,
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
  {
    pose: 'nod',
    get label() {
      return i18next.t('messages:move.nod')
    },
  },
  {
    pose: 'shake',
    get label() {
      return i18next.t('messages:move.shake')
    },
  },
  {
    pose: 'hi',
    get label() {
      return i18next.t('messages:move.hi')
    },
  },
  {
    pose: 'bow',
    get label() {
      return i18next.t('messages:move.bow')
    },
  },
  {
    pose: 'leanIn',
    get label() {
      return i18next.t('messages:move.leanIn')
    },
  },
  {
    pose: 'wobble',
    get label() {
      return i18next.t('messages:move.wobble')
    },
  },
  {
    pose: 'bounce',
    get label() {
      return i18next.t('messages:move.bounce')
    },
  },
  {
    pose: 'spin',
    get label() {
      return i18next.t('messages:move.spin')
    },
  },
  {
    pose: 'recoil',
    get label() {
      return i18next.t('messages:move.recoil')
    },
  },
  {
    pose: 'startle',
    get label() {
      return i18next.t('messages:move.startle')
    },
  },
  {
    pose: 'dance',
    get label() {
      return i18next.t('messages:move.dance')
    },
  },
  {
    pose: 'shrug',
    get label() {
      return i18next.t('messages:move.shrug')
    },
  },
  {
    pose: 'lookAround',
    get label() {
      return i18next.t('messages:move.lookAround')
    },
  },
  {
    pose: 'hopSpin',
    get label() {
      return i18next.t('messages:move.hopSpin')
    },
  },
  {
    pose: 'stretch',
    get label() {
      return i18next.t('messages:move.stretch')
    },
  },
  {
    pose: 'flex',
    get label() {
      return i18next.t('messages:move.flex')
    },
  },
  {
    pose: 'jab',
    get label() {
      return i18next.t('messages:move.jab')
    },
  },
  {
    pose: 'powerUp',
    get label() {
      return i18next.t('messages:move.powerUp')
    },
  },
  {
    pose: 'doze',
    get label() {
      return i18next.t('messages:move.doze')
    },
  },
  {
    pose: 'wink',
    get label() {
      return i18next.t('messages:move.wink')
    },
  },
  {
    pose: 'love',
    get label() {
      return i18next.t('messages:move.love')
    },
  },
  {
    pose: 'robot',
    get label() {
      return i18next.t('messages:move.robot')
    },
  },
  {
    pose: 'jazz',
    get label() {
      return i18next.t('messages:move.jazz')
    },
  },
  {
    pose: 'point',
    get label() {
      return i18next.t('messages:move.point')
    },
  },
  {
    pose: 'hero',
    get label() {
      return i18next.t('messages:move.hero')
    },
  },
  {
    pose: 'handsUp',
    get label() {
      return i18next.t('messages:move.handsUp')
    },
  },
  {
    pose: 'disco',
    get label() {
      return i18next.t('messages:move.disco')
    },
  },
  {
    pose: 'typing',
    get label() {
      return i18next.t('messages:move.typing')
    },
  },
  {
    pose: 'drumroll',
    get label() {
      return i18next.t('messages:move.drumroll')
    },
  },
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
