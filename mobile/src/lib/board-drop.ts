import { STAGES } from '@jojo/service/data/seed'
import type { Stage } from '@jojo/service/data/seed'

/**
 * Which stage a finished board drag actually moved the card to, if any.
 *
 * The `released` half is the reason this is a function rather than an array
 * read. `Gesture.Pan().onEnd` is NOT the release callback it reads as: gesture
 * handler calls it for CANCELLED and FAILED too — `onEnd?.(event, false)` in
 * `eventReceiver.ts` — whenever the gesture had reached ACTIVE. So the board
 * committed the move for a drag the finger never let go of: a call arriving
 * mid-drag, a rotation, the card's gesture being rebuilt because the store
 * updated under it, or a parent handler taking the touch, each landed the card
 * in whichever column it happened to be over and posted the "moved to
 * Interview" toast for a move nobody made.
 *
 * A cancel is not a drop over the origin column either — it is a drop that did
 * not happen — but both answer `null` here, and the caller does its state
 * cleanup either way. Restoring the board is what a cancel and a drop share;
 * moving the record is what only a release earns.
 *
 * `hovered` is -1 when no column was ever hovered (a lift with no movement),
 * which lands on the same answer through the bounds check.
 */
export function dropStage(hovered: number, released: boolean): Stage | null {
  if (!released) return null
  const column = STAGES[hovered]
  return column ? column.id : null
}
