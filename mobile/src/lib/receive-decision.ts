/**
 * Which way "Replace everything on this phone?" was answered — decided once,
 * where it can be run.
 *
 * `ui/ConfirmSheet.tsx`'s confirm button is `onPress={() => { onClose();
 * onConfirm() }}`, so a panel that puts work in `onClose` runs that work on the
 * way to confirming. `ReceivePanel` put its whole DECLINE path there: null the
 * plan, drop the session, zero the byte count, and show "Nothing was changed.
 * Scan the code again to receive." Tapping **Replace** ran all four and then
 * started the restore — `applyPending` still held the plan through its render
 * closure, so the phone was being overwritten while the screen said nothing had
 * changed, and a restore that then failed had its message written over that one.
 * Measured end to end; both handlers fire, in that order, on every confirm.
 *
 * `receive-landing.ts` already documents this ordering, for the latch it broke.
 * This is the other half of the same trap, and the reason the answer is now
 * RECORDED by both handlers rather than acted on by either: whichever arrives
 * second cannot undo the decision, because confirming is not something a close
 * can take back.
 */

import type { RestorePlan } from '@jojo/service/core/backup'

export type SheetAnswer = 'unanswered' | 'declined' | 'confirmed'

/**
 * What the panel says after a refusal.
 *
 * The sentence matters as much as the state: the person has just been told the
 * transfer arrived, and silence after "no" reads as "no" having failed.
 */
export const DECLINED_MESSAGE = 'Nothing was changed. Scan the code again to receive.'

/**
 * Folds one handler call into the answer so far.
 *
 * Confirming is sticky and closing is not, which is what makes this independent
 * of the order the two arrive in. Order-independence is the point rather than a
 * bonus: it is a fact about a component in another file, it is not visible from
 * here, and it has already changed once.
 *
 * What it does NOT survive, and what a reader should know before moving either
 * call: the two must land in the SAME commit. `ConfirmSheet`'s confirm button
 * calls both synchronously in one press handler, so React batches them and the
 * panel's effect runs once, with 'confirmed'. Replayed with the two calls in
 * separate commits, the effect sees 'closed' first, declines, drops the session
 * and nulls the plan — and the confirm that follows finds no plan and waits, so
 * the restore is silently skipped. That is a safe failure rather than the
 * destructive one this replaced, and it is not reachable from a synchronous
 * handler; it is written down because 'sticky' reads like a stronger promise
 * than it is, and the fix for it is a `pending` that outlives the answer, not a
 * change here.
 */
export function recordAnswer(current: SheetAnswer, event: 'closed' | 'confirmed'): SheetAnswer {
  if (current === 'confirmed') return 'confirmed'
  return event === 'confirmed' ? 'confirmed' : 'declined'
}

export type ReceiveAction =
  /** Nothing has been answered, or there is no backup waiting to be answered about. */
  | { kind: 'wait' }
  /** Drop the pairing and say so. Nothing is written. */
  | { kind: 'decline'; message: string }
  /** Write it. This destroys every record on the phone. */
  | { kind: 'apply'; plan: RestorePlan }

/**
 * The one destructive branch in the panel, taken in one place.
 *
 * `plan === null` is `wait` for BOTH answers rather than a decline: Android's
 * back button and the backdrop both reach `onClose`, so a stray close arriving
 * after a restore has started must not repaint "Nothing was changed." over the
 * transfer-complete screen.
 */
export function actionFor(answer: SheetAnswer, plan: RestorePlan | null): ReceiveAction {
  if (answer === 'unanswered' || plan === null) return { kind: 'wait' }
  return answer === 'confirmed'
    ? { kind: 'apply', plan }
    : { kind: 'decline', message: DECLINED_MESSAGE }
}
