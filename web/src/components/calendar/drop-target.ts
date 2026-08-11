import { closestCenter, pointerWithin, type CollisionDetection } from '@dnd-kit/core'

/** Namespaced so a droppable day can never collide with a timeline item's id. */
export const DAY_DROP_PREFIX = 'day:'

/** The grid's `gap-1`, in px. How far a release may miss a cell and still count. */
const CELL_GAP = 4

/**
 * The cell under the pointer, falling back to the nearest one you nearly hit.
 *
 * `pointerWithin` alone answers nothing while the pointer sits in the 4px gutter
 * between two cells, so a drop released there would be silently discarded — the
 * event snaps back and the user is told nothing. `closestCenter` catches those.
 *
 * But `closestCenter` measures from the dragged chip, not the pointer, and it
 * always names a winner — so releasing over the aria-hidden blanks that pad the
 * last row (or anywhere else off the grid) rescheduled the event to a day
 * nobody had pointed at: a drop in the corner right of Oct 31 landed on Oct 25,
 * a row up and five days early. Bounding it to cells the pointer is actually
 * touching keeps the gutter case and makes a drop on dead space a no-op, which
 * is the only honest reading of a release over nothing.
 */
export const dropTarget: CollisionDetection = (args) => {
  const under = pointerWithin(args)
  if (under.length > 0) return under

  const pointer = args.pointerCoordinates
  if (!pointer) return []

  return closestCenter(args).filter((collision) => {
    const rect = args.droppableRects.get(collision.id)
    if (!rect) return false
    return (
      pointer.x >= rect.left - CELL_GAP &&
      pointer.x <= rect.left + rect.width + CELL_GAP &&
      pointer.y >= rect.top - CELL_GAP &&
      pointer.y <= rect.top + rect.height + CELL_GAP
    )
  })
}
