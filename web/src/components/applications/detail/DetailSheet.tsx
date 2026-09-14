import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useReducedMotion } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { readStored, writeStored } from '@/lib/storage'
import {
  MIN_SHEET_WIDTH,
  SHEET_WIDTH_KEY,
  canResizeAt,
  clampSheetWidth,
  maxWidthFor,
  parseStoredWidth,
} from '@/lib/sheet-width'
import { SheetResizer } from './SheetResizer'

/**
 * The open record, over the board rather than beside it.
 *
 * It used to be a flex sibling of the list, which squeezed a six-column board
 * into ~650px — two and a half stages on the page whose entire job is showing
 * all six. As a sheet the board keeps its width, and Escape and a backdrop
 * click get the meaning every user already expects them to have.
 *
 * Radix rather than a hand-rolled overlay, and this is the load-bearing part:
 * the record mounts its own dialogs — edit, stage transition, delete confirm —
 * and a bespoke focus trap listening on `document` would fight the trap Radix
 * puts around those, yanking Tab out of the confirm dialog and back into the
 * sheet. Radix keeps one layer stack, so Escape closes only the top of it.
 *
 * `modal={false}` is deliberate and costs a focus trap. A modal Radix layer
 * sets `pointer-events: none` on `document.body` and `aria-hidden` on
 * everything outside its portal — and the toast viewport lives in the React
 * tree under `#root`, not in a portal of its own. Modal, every Undo raised from
 * inside the record would be un-clickable and unspoken for as long as the sheet
 * stayed open, on the surface that mutates more than any other. A sheet you can
 * Tab out of is a smaller failure than an undo you cannot press.
 *
 * Built as its own file rather than as `components/ui/sheet.tsx`: it has exactly
 * one caller, and a primitive with one caller is a guess about the second.
 */
export function DetailSheet({
  name,
  onClose,
  children,
}: {
  /** The record's own name — the sheet's accessible name. */
  name: string
  onClose: () => void
  children: ReactNode
}) {
  const reducedMotion = useReducedMotion()
  const [width, setWidth] = useState(MIN_SHEET_WIDTH)
  const [resizable, setResizable] = useState(false)
  /** What this window allows right now — the handle announces it. */
  const [max, setMax] = useState(MIN_SHEET_WIDTH)

  /*
   * The stored width is read AFTER mount, not during render.
   *
   * `window.innerWidth` is the clamp's other half, and reading it while
   * rendering is a value the server — or a prerender — cannot have. Starting at
   * the minimum and widening on the first effect also means the sheet's
   * entrance animation plays at the width it has always used, so a restored
   * preference does not turn the slide-in into a stretch.
   */
  useEffect(() => {
    const apply = () => {
      const viewport = window.innerWidth
      setResizable(canResizeAt(viewport))
      setMax(maxWidthFor(viewport))
      setWidth((current) => {
        const wanted = parseStoredWidth(readStored(SHEET_WIDTH_KEY)) ?? current
        return clampSheetWidth(wanted, viewport)
      })
    }
    apply()
    // A window narrowed while the sheet is open must not leave it hanging off
    // the screen — the CSS `max-w` would hide the overflow, but `aria-valuenow`
    // and the stored preference would both still claim the old number.
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [])

  const onWidth = useCallback((next: number) => {
    setWidth(next)
    // Written on every change rather than on drop: a drag that ends by the
    // window losing focus never fires `pointerup`, and the preference would be
    // lost exactly when someone dragged and immediately switched away.
    writeStored(SHEET_WIDTH_KEY, String(next))
  }, [])

  const onReset = useCallback(() => onWidth(MIN_SHEET_WIDTH), [onWidth])

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      // index.css flattens every CSS animation and transition to 0.01ms under
      // this preference, so a CSS cross-fade would be no motion at all here.
      // A script animation is the one thing that reset cannot reach — the same
      // trick, for the same reason, as ui/dialog.tsx.
      if (node && reducedMotion) {
        node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' })
      }
    },
    [reducedMotion],
  )

  return (
    <DialogPrimitive.Root
      open
      modal={false}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogPrimitive.Portal>
        {/* A plain div, not `DialogPrimitive.Overlay`: Radix renders that one
            only in modal mode, so a non-modal sheet gets no backdrop from it at
            all. `data-slot` is not decoration — index.css swaps this wash for a
            solid scrim under prefers-reduced-transparency, keyed on exactly
            that attribute. A pointer-down here lands outside the content, which
            is what closes the sheet. */}
        <div
          aria-hidden
          data-slot="dialog-overlay"
          className={cn(
            'fixed inset-0 z-40 bg-black/10 supports-backdrop-filter:backdrop-blur-xs',
            !reducedMotion && 'animate-in duration-150 fade-in-0',
          )}
        />
        <DialogPrimitive.Content
          ref={setRef}
          data-slot="dialog-content"
          // The record has no description element of its own, and Radix logs a
          // warning for a missing one rather than leaving it out.
          aria-describedby={undefined}
          // Only Escape, the backdrop and the X close this. Focus leaving the
          // sheet must not: a toast that grabs its own Undo, or a popover the
          // record opens into a portal, would otherwise dismiss the record the
          // user is working in.
          onFocusOutside={(event) => event.preventDefault()}
          /*
           * Width as an inline style, with `max-w` kept in the class list. The
           * class is the safety net: between a window resize and the effect
           * that answers it, the inline number is stale for a frame, and
           * `calc(100vw - 3rem)` is what stops the sheet hanging off the screen
           * in that frame.
           */
          style={{ width }}
          className={cn(
            'fixed top-0 right-0 bottom-0 z-40 flex max-w-[calc(100vw-3rem)] flex-col overflow-y-auto border-l border-hairline bg-page px-4 pt-4 pb-5 shadow-[var(--shadow-raised)] outline-none sm:px-5 sm:pt-5',
            !reducedMotion &&
              'duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-open:animate-in data-open:slide-in-from-right-16 data-closed:animate-out data-closed:duration-150 data-closed:slide-out-to-right-16',
          )}
        >
          <DialogPrimitive.Title className="sr-only">{name}</DialogPrimitive.Title>

          {/* No close button here. The record's own header ends in one, and it
              already hands back through `onClose`, so the sheet adding a second
              put two dismissals sixty pixels apart — which reads as two
              different scopes ("close the record" versus "close the panel")
              when there is only one. The container keeps Escape and the
              backdrop; the visible control belongs in the record's own cluster,
              beside the flag and the overflow it shares a job with. */}
          {children}

          {/*
           * LAST in the DOM, and that is not cosmetic.
           *
           * Radix moves focus to the first focusable element inside the content
           * when the sheet opens. First in the tree, this handle took it:
           * opening a record put the caret on a resize grip instead of on the
           * record, the arrow keys resized the panel instead of moving through
           * it, and the grip sat permanently in its focus-visible state.
           * Measured, not guessed — `matches(':focus-visible')` was true on a
           * fresh load. Last in the tree, the record keeps the focus it always
           * had and the handle is reached by Tab, at the end, like any other
           * trailing control. It is `fixed`, so where it sits in the tree
           * changes nothing about where it is drawn.
           *
           * Hidden where it could do nothing: on a narrow window the sheet is
           * already at the only width it may have, and a handle that cannot
           * move is worse than none — it is a control that looks broken.
           */}
          {resizable ? (
            <SheetResizer width={width} max={max} onWidth={onWidth} onReset={onReset} />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
