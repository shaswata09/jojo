import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useReducedMotion } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'

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
          className={cn(
            'fixed top-0 right-0 bottom-0 z-40 flex w-[520px] max-w-[calc(100vw-3rem)] flex-col overflow-y-auto border-l border-hairline bg-page px-4 pb-5 shadow-[var(--shadow-raised)] outline-none sm:px-5',
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
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
