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

/*
 * The board in a right-to-left language.
 *
 * Arabic mirrors the board: `STAGES[0]` is the rightmost column. The finger is
 * reported in physical window x, so counting columns from the left named the
 * mirror-image stage — the highlighted column and the stage written were both
 * wrong. The three helpers below count from the board's START edge instead (the
 * left in LTR, the right in RTL), so one formula serves both directions.
 *
 * The scroll offset is the awkward part, because the platforms disagree about
 * it in RTL. iOS reports and accepts a logical offset (from the start edge;
 * `RCTScrollViewComponentView` flips it), Android a physical one (`getScrollX`,
 * which starts at its maximum). `physical` names which kind `native` is.
 *
 * Worklets: the gesture and the edge auto-scroll call them on the UI thread.
 */

/** A native scroll offset as distance scrolled from the start edge — and back. */
export function startOffset(
  native: number,
  rtl: boolean,
  physical: boolean,
  contentW: number,
  viewportW: number,
): number {
  'worklet'
  if (!rtl || !physical) return native
  return Math.max(0, contentW - viewportW) - native
}

/** How far the finger is from the viewport's start edge. */
export function fromStartEdge(
  pointerX: number,
  viewportX: number,
  viewportW: number,
  rtl: boolean,
): number {
  'worklet'
  return rtl ? viewportX + viewportW - pointerX : pointerX - viewportX
}

/** The logical column under a point `fromStart + scrolled` into the board. */
export function columnAt(
  fromStart: number,
  scrolled: number,
  stride: number,
  count: number,
): number {
  'worklet'
  return Math.min(count - 1, Math.max(0, Math.floor((fromStart + scrolled) / stride)))
}

/**
 * The column under the finger, from everything the drag tracks.
 *
 * One function for both places that have to ask: the gesture's `onUpdate`, when
 * the finger moves, and the edge auto-scroll's frame callback, when the BOARD
 * moves under a finger held still. Only the first used to ask. Held at the edge,
 * the board scrolled two or three columns on while the highlight — and the
 * stage written on release — stayed on the column the finger had last moved
 * over (seen on an Android AVD, 2026-11-17).
 */
export function hoveredColumn(
  pointerX: number,
  viewportX: number,
  viewportW: number,
  nativeScroll: number,
  contentW: number,
  rtl: boolean,
  physical: boolean,
  stride: number,
  count: number,
): number {
  'worklet'
  return columnAt(
    fromStartEdge(pointerX, viewportX, viewportW, rtl),
    startOffset(nativeScroll, rtl, physical, contentW, viewportW),
    stride,
    count,
  )
}
