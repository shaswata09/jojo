/**
 * How far one arrow press should move a row that has been picked up.
 *
 * dnd-kit's own keyboard handling moves the dragged thing a flat 25 pixels per
 * press, which is right for a free canvas and wrong for a list: a merge row is
 * 50px tall, so reordering by keyboard took four presses per position and
 * reported nothing in between — measured, not guessed. A list has positions
 * rather than pixels, and one press should be one position.
 *
 * Pure: it is handed the boxes and returns a distance, so the arithmetic that
 * decides where a row lands can be checked without a browser or a drag.
 */

export type RowBox = {
  readonly id: string
  /** Viewport top, as dnd-kit measures its droppables. */
  readonly top: number
}

/**
 * The vertical distance to the next row in `direction`, or null at the end.
 *
 * Null rather than zero: the caller returns `void` to dnd-kit for it, which
 * leaves the drag exactly where it is. Returning a zero delta instead would be
 * a move of no distance, and dnd-kit answers that by re-running collision
 * detection and announcing the same row again.
 *
 * The rows are sorted here rather than trusted, because `droppableRects` is a
 * Map in registration order — which is DOM order only until a row is removed
 * and another added, and this is exactly the list where that happens.
 */
export function rowStep(
  rows: readonly RowBox[],
  currentId: string,
  direction: -1 | 1,
): number | null {
  const ordered = [...rows].sort((a, b) => a.top - b.top)
  const index = ordered.findIndex((row) => row.id === currentId)
  if (index < 0) return null
  const from = ordered[index]
  const to = ordered[index + direction]
  if (!from || !to) return null
  return to.top - from.top
}
