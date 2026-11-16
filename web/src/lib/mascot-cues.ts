/**
 * Which gesture the mascot plays for what you do in jojo — one table, so the
 * robot's reactions are decided in one place rather than scattered across
 * the call sites that trigger them.
 *
 * Its own module because nothing here mounts a component in a test: the
 * decisions sit where vitest can reach them, and each call site only says
 * which event happened (`play(CUES.applicationAdded)`).
 *
 * Replaces the random nod, spin or dance a board advance used to draw
 * (Q259): the owner asked for gestures that fit the action (2026-11-15) —
 * a draft sent off dances, an interview powers up, an offer hop-spins.
 */
import { STAGES, type Outcome, type Stage } from '@/data/seed'
import type { MascotPose } from '@/lib/mascot-context'

type Gesture = Exclude<MascotPose, 'idle'>

/**
 * Events outside the board, and what each plays. Written against the pose
 * vocabulary, so renaming a gesture is a compile error here rather than a
 * robot that silently stops moving.
 *
 * Restraint is the point. Only actions a person makes on purpose and would
 * like acknowledged are here — not every save — so a gesture still means
 * something. And never a celebration over bad news.
 */
export const CUES = {
  /** A new application saved, by hand or approved from the scout: a small win. */
  applicationAdded: 'bounce',
  /** A posting already in the applications, so nothing new was added: "no". */
  alreadyHave: 'shake',
  /** A reminder or task ticked off. */
  taskDone: 'nod',
  /** A backup written to disk — the one action that keeps everything safe. */
  backupSaved: 'flex',
  /** A scout pipeline run by hand: scanning the boards. */
  scoutStarted: 'lookAround',
  /** The assistant has started on a question. */
  assistantWorking: 'typing',
} as const satisfies Record<string, Gesture>

/**
 * The gesture for a move to another stage, or null for none.
 *
 * Each forward stage has its own, in step with what it means: sending a
 * draft off is the one people put off, so it dances; a screen is a small
 * yes; an interview is a fight to get ready for; an offer is a leap.
 *
 * Closing depends on why. An accepted offer is the best news there is; a
 * withdrawal or a declined offer is the person's own call, and gets a nod.
 * A rejection or a ghosting gets nothing — a dance over a rejection is worse
 * than no dance, which is why the board drew nothing for Closed before the
 * outcome was known (Q259), and why it still draws nothing for one.
 *
 * A move back down the board is a correction, not progress: nothing.
 */
export function stageGesture(from: Stage, to: Stage, outcome?: Outcome | null): Gesture | null {
  if (to === 'closed') {
    if (from === 'closed') return null
    if (outcome === 'accepted') return 'love'
    if (outcome === 'withdrawn' || outcome === 'declined') return 'nod'
    return null
  }
  if (to === 'draft' || !isAdvance(from, to)) return null
  return STAGE_GESTURE[to]
}

const STAGE_GESTURE: Record<Exclude<Stage, 'draft' | 'closed'>, Gesture> = {
  submitted: 'dance',
  screen: 'bounce',
  interview: 'powerUp',
  offer: 'hopSpin',
}

/**
 * Later in the board's own column order — and not into the last column.
 *
 * `STAGES` is what the board maps over, so "the next column" is an index in it
 * rather than a second list that could drift. Closed is the exception: it sits
 * last, so by index alone every move into it advances, but whether closing is
 * good news depends on the outcome — `stageGesture` decides that case.
 */
export function isAdvance(from: Stage, to: Stage): boolean {
  if (to === 'closed') return false
  const column = (stage: Stage) => STAGES.findIndex((s) => s.id === stage)
  return column(to) > column(from)
}
