import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { cn } from '@/lib/utils'
import { MIN_SHEET_WIDTH, maxWidthFor, nudgeWidth, widthFromPointer } from '@/lib/sheet-width'

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
/** A drag in flight: what to release, and the listener to unbind. */
type LiveDrag = {
  readonly handle: HTMLDivElement
  readonly pointerId: number
  readonly handler: EventListener
}

export function SheetResizer({
  width,
  max,
  onWidth,
  onReset,
  className,
}: {
  width: number
  /**
   * The widest THIS window allows, which is usually less than the hard cap.
   *
   * Passed in rather than recomputed here, because the sheet already tracks the
   * viewport and a second resize listener would be a second answer to the same
   * question. Announcing the constant instead was measured wrong: in a 1150px
   * window the handle said its maximum was 1100 while Home stopped at 805, so a
   * screen reader reported a value the control could never reach.
   */
  max: number
  onWidth: (width: number) => void
  /** Double-click: back to the width it always opened at. */
  onReset: () => void
  className?: string
}) {
  /**
   * The drag in flight, so it can be torn down from somewhere other than the
   * events that normally end it.
   *
   * Two measured failures made this necessary, and both left the WHOLE PAGE
   * unusable rather than just the panel:
   *
   * 1. The handle unmounting mid-drag. Press the grip, drag, and press Escape:
   *    Radix dismisses the sheet on a document-level keydown, React removes this
   *    node, and per the Pointer Events spec removing the capture target
   *    implicitly releases capture — so the `pointerup` retargets to `<body>`
   *    and the teardown bound to this element never runs. Measured: the page
   *    kept `user-select: none` and `cursor: col-resize` afterwards, so nothing
   *    anywhere could be selected or copied. The unmount effect below is what
   *    closes it; the same path fires when a window resize flips `resizable`.
   * 2. A `pointerup` that is never delivered at all — alt-tab while holding the
   *    button. Measured: the drag stayed live and the sheet then resized on
   *    plain hover with no button held, 700 -> 760 -> 900.
   */
  const drag = useRef<LiveDrag | null>(null)

  const endDrag = useCallback(() => {
    const live = drag.current
    if (!live) return
    // Cleared FIRST, so a re-entrant call — `lostpointercapture` firing inside
    // `releasePointerCapture` — cannot run the teardown twice.
    drag.current = null
    try {
      live.handle.releasePointerCapture(live.pointerId)
    } catch {
      // Already released, which is the normal case on a clean pointerup. A
      // NotFoundError here must not skip the body styles below.
    }
    for (const type of ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
      live.handle.removeEventListener(type, live.handler)
    }
    document.body.style.removeProperty('user-select')
    document.body.style.removeProperty('cursor')
  }, [])

  // The guarantee. Whatever ends the drag — Escape, the record closing, the
  // breakpoint changing — the global styles come off with this component.
  useEffect(() => endDrag, [endDrag])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Left button only: a right-click here should open the context menu, and
      // a two-finger scroll should not start a drag.
      if (event.button !== 0) return
      event.preventDefault()
      endDrag()
      const handle = event.currentTarget
      /*
       * Pointer capture, so the drag survives the pointer leaving the strip —
       * which it does immediately, because the strip moves with the edge and the
       * hand is always slightly ahead of it.
       */
      handle.setPointerCapture(event.pointerId)

      /*
       * One listener for all four events. `pointerup`, `pointercancel` and
       * `lostpointercapture` all mean the same thing here — stop — and
       * `lostpointercapture` is the one the spec guarantees fires whenever
       * capture ends for any reason.
       */
      const handler = (raw: Event) => {
        if (raw.type !== 'pointermove') {
          endDrag()
          return
        }
        const moveEvent = raw as PointerEvent
        // No button held means the release happened somewhere this element never
        // heard about. Ending here is what stops the panel resizing on hover.
        if (moveEvent.buttons === 0) {
          endDrag()
          return
        }
        onWidth(widthFromPointer(moveEvent.clientX, window.innerWidth))
      }

      drag.current = { handle, pointerId: event.pointerId, handler }
      for (const type of ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
        handle.addEventListener(type, handler)
      }

      /*
       * Dragging across a page of text selects all of it otherwise, and the
       * selection persists after the drop. Set on `body` because the pointer
       * spends the drag outside the sheet, and the cursor with it so it does not
       * flicker back to a caret over text.
       */
      document.body.style.setProperty('user-select', 'none')
      document.body.style.setProperty('cursor', 'col-resize')
    },
    [endDrag, onWidth],
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
        return
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
      aria-valuemax={max}
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
        /*
         * No focus RING in normal use: a 12px strip the height of the screen
         * outlined in accent is a wall. The line and the grip colour instead,
         * which is the same signal in the shape of the control.
         *
         * Under forced colours that substitute vanishes — the OS repaints every
         * border and background from its own palette, so focused and at rest
         * came out pixel-identical (measured: same white border, same black
         * line, `outline-style: none` in both). There, and only there, the ring
         * comes back, because an outline is the one thing forced-colors mode
         * keeps under the page's control.
         */
        'outline-none forced-colors:focus-visible:[outline:2px_solid_Highlight] forced-colors:focus-visible:[outline-offset:-3px]',
        className,
      )}
    >
      {/* The full-height line. Still transparent at rest — it is the edge being
          highlighted during a drag, not the thing that advertises the control.
          That job belongs to the grip below. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-transparent transition-colors group-hover:bg-accent group-focus-visible:bg-accent"
      />

      {/*
       * The grip, and it is VISIBLE AT REST. That is the whole of its job.
       *
       * A bare edge that happens to respond to dragging is a control nobody
       * finds: there is nothing on screen saying the panel can be resized, and
       * the `col-resize` cursor only appears once the pointer is already on the
       * two pixels that would have shown it. A capsule of dots is the shape
       * every drawer, splitter and sheet uses for exactly this, so it reads as
       * a handle before it is touched.
       *
       * Centred on the VIEWPORT, not on the record: the strip is `fixed` and
       * full height, so the middle of the screen is the middle of the edge at
       * every scroll position and every record length.
       */}
      <span
        aria-hidden
        className="absolute top-1/2 left-1/2 flex h-9 w-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-hairline-strong bg-panel shadow-sm transition-colors group-hover:border-accent group-focus-visible:border-accent"
      >
        {/*
         * Two columns of four. `gap-[3px]` and 2px dots put the whole grid at
         * 7×17 inside a 14×36 capsule — the spacing has to be in pixels rather
         * than on the spacing scale, because the smallest step there is 4px and
         * a 4px gap makes eight dots taller than the capsule holding them.
         */}
        <span className="grid grid-cols-2 gap-[3px]">
          {Array.from({ length: 8 }, (_, dot) => (
            <span
              key={dot}
              className="size-[2px] rounded-full bg-text-3 transition-colors group-hover:bg-text-1 group-focus-visible:bg-text-1"
            />
          ))}
        </span>
      </span>
    </div>
  )
}
