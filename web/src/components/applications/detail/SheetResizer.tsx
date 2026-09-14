import { useCallback } from 'react'
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { cn } from '@/lib/utils'
import {
  MAX_SHEET_WIDTH,
  MIN_SHEET_WIDTH,
  maxWidthFor,
  nudgeWidth,
  widthFromPointer,
} from '@/lib/sheet-width'

/**
 * The grab strip down the sheet's left edge.
 *
 * `role="separator"` with `aria-valuenow` is the window-splitter pattern, and
 * it is what makes this reachable without a mouse: a separator that is
 * focusable is, by that role, expected to move on the arrow keys. A `<div>`
 * with a pointer handler would be a control a keyboard cannot see at all.
 *
 * Four pixels wide, with a twelve-pixel hit area hanging off either side. The
 * visible line matches the border it replaces; the target is what a pointer
 * actually has to hit, and 4px is well under what anyone can reliably aim at.
 */
export function SheetResizer({
  width,
  onWidth,
  onReset,
  className,
}: {
  width: number
  onWidth: (width: number) => void
  /** Double-click: back to the width it always opened at. */
  onReset: () => void
  className?: string
}) {
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Left button only: a right-click here should open the context menu, and
      // a two-finger scroll should not start a drag.
      if (event.button !== 0) return
      event.preventDefault()
      const handle = event.currentTarget
      /*
       * Pointer capture, so the drag survives the pointer leaving the 4px
       * strip — which it does immediately, because the strip moves with the
       * edge and the hand is always slightly ahead of it. Without capture the
       * events go to whatever is underneath and the drag dies on the first
       * fast movement.
       */
      handle.setPointerCapture(event.pointerId)

      const move = (moveEvent: PointerEvent) => {
        onWidth(widthFromPointer(moveEvent.clientX, window.innerWidth))
      }
      const stop = () => {
        handle.releasePointerCapture?.(event.pointerId)
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', stop)
        handle.removeEventListener('pointercancel', stop)
        // The page is free to select text again.
        document.body.style.removeProperty('user-select')
        document.body.style.removeProperty('cursor')
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', stop)
      handle.addEventListener('pointercancel', stop)

      /*
       * Dragging across a page of text selects all of it otherwise, and the
       * selection persists after the drop. Set on `body` rather than on the
       * sheet because the pointer spends the drag outside the sheet, and kept
       * for the cursor too so it does not flicker back to a caret over text.
       */
      document.body.style.setProperty('user-select', 'none')
      document.body.style.setProperty('cursor', 'col-resize')
    },
    [onWidth],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const viewport = window.innerWidth
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        onWidth(nudgeWidth(width, event.key === 'ArrowLeft' ? -1 : 1, viewport, event.shiftKey))
        return
      }
      // Home and End mean the extremes on every slider; a separator is one.
      if (event.key === 'Home') {
        event.preventDefault()
        onWidth(maxWidthFor(viewport))
      } else if (event.key === 'End') {
        event.preventDefault()
        onWidth(MIN_SHEET_WIDTH)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        onReset()
      }
    },
    [onReset, onWidth, width],
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the record panel"
      aria-valuenow={width}
      aria-valuemin={MIN_SHEET_WIDTH}
      aria-valuemax={MAX_SHEET_WIDTH}
      tabIndex={0}
      title="Drag to resize — double-click to reset"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      /*
       * `fixed`, positioned from the right by the sheet's own width.
       *
       * Not `absolute`. The sheet is `overflow-y-auto`, and an absolutely
       * positioned child of a scroll container scrolls with its content — the
       * handle would ride up out of view as soon as a long record was scrolled,
       * which is exactly when somebody wants more width. Fixed pins it to the
       * viewport, and since the sheet is itself fixed to the right edge, its
       * left border is always `width` from the right of the window.
       */
      style={{ right: width }}
      className={cn(
        // Centred on the sheet's left border: half of the 12px strip each side.
        'group fixed top-0 bottom-0 z-50 -mr-1.5 w-3 cursor-col-resize touch-none',
        // No focus RING: a 12px strip the height of the screen outlined in
        // accent is a wall. The line itself thickens and colours instead, which
        // is the same signal in the shape of the control.
        'outline-none',
        className,
      )}
    >
      {/* The line. Transparent until hover or focus, so the sheet's own border
          is what shows at rest and the edge does not read as a second control
          competing with the record's header. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-transparent transition-colors group-hover:bg-accent group-focus-visible:bg-accent"
      />
    </div>
  )
}
