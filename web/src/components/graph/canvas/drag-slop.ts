/**
 * Whether a press has become a drag.
 *
 * Measured from where the press STARTED, not from the previous move: a slow
 * drag arrives as many moves of a unit or two each, and comparing step by step
 * never crossed the threshold, so a node dragged slowly across the canvas was
 * unpinned and selected on release as if it had been clicked.
 */

/** Pointer travel, in canvas units, that turns a click into a drag. */
export const DRAG_SLOP = 3

export type Point = { x: number; y: number }

export function pastSlop(pressedAt: Point, now: Point, slop: number = DRAG_SLOP): boolean {
  return Math.hypot(now.x - pressedAt.x, now.y - pressedAt.y) > slop
}
