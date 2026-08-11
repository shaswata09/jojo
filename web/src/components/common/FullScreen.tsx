import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Maximize2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TOAST_STACK_SELECTOR, deferFocusReturn } from '@/lib/toast-context'
import { cn } from '@/lib/utils'

/**
 * The control that opens a panel full screen.
 *
 * Icon-only and sized to the other trailing controls on a panel header, so it
 * joins the row rather than announcing itself. `title` and `aria-label` carry
 * the whole name, since there is no text.
 */
export function ExpandButton({
  onClick,
  label,
  className,
}: {
  onClick: () => void
  /** What gets bigger — "Open the preview full screen", not "Expand". */
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'pressable grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border border-transparent text-text-3 transition-colors hover:border-hairline hover:bg-well hover:text-text-1',
        className,
      )}
    >
      <Maximize2 className="size-3.5" strokeWidth={1.9} aria-hidden />
    </button>
  )
}

/**
 * A panel, taking the whole window.
 *
 * Built on the app's Dialog rather than the Fullscreen API. `requestFullscreen`
 * hands the screen to the browser: our own chrome disappears, Escape is
 * intercepted by the browser instead of by us, and on iOS Safari it does not
 * exist for arbitrary elements at all. A dialog at viewport size gives the same
 * result with the app's own overlay, focus trap and Escape behaviour, which is
 * what every other overlay here already does.
 *
 * The content is REMOUNTED rather than moved: a `<dialog>` cannot adopt a live
 * node without re-parenting it, and re-parenting an `<iframe>` reloads its
 * document anyway. Callers should keep their state above this component so the
 * remount costs a scroll position at worst — never the user's text.
 */
export function FullScreenDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Announced to screen readers; not drawn unless it earns its place. */
  description?: string
  children: ReactNode
}) {
  /**
   * Mounted only while open, rather than sitting in the tree at `open={false}`.
   *
   * This is the fix for a panel that would not close. Radix holds a closing
   * surface until its exit animation reports `animationend`, and at this size
   * that event never arrived: measured `data-state="closed"`, `getAnimations()`
   * empty, `open` already false, and the panel still filling the screen — so
   * Escape and the close button both looked dead while the state behind them
   * had already changed. Every other dialog in the app closes normally, so it
   * is this size that provokes it rather than the shared component.
   *
   * Removing the subtree skips the wait. Radix's own effects still run on
   * unmount, so the scroll lock and the focus scope are released as usual.
   *
   * What does NOT still run is `onCloseAutoFocus`. Radix fires that as part of
   * closing, and this panel never closes — it vanishes — so `dialog.tsx`'s
   * whole focus-restoration path is skipped, and pressing Escape left focus on
   * a node that had just been removed: `document.activeElement` measured BODY,
   * and the next Tab started again from the top of the page. That is what the
   * surface below restores by hand, and why it is a separate component: the
   * restoration is an effect, and an effect cannot live after the early return.
   */
  if (!open) return null

  return (
    <FullScreenSurface onOpenChange={onOpenChange} title={title} description={description}>
      {children}
    </FullScreenSurface>
  )
}

function FullScreenSurface({
  onOpenChange,
  title,
  description,
  children,
}: {
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
}) {
  /**
   * Captured during render, not in an effect.
   *
   * By the time any effect here runs, Radix's own focus scope has already moved
   * focus into the panel, so an effect would record the panel. The first render
   * of this component is the last moment `document.activeElement` is still the
   * control the user pressed to open it.
   */
  const openerRef = useRef<HTMLElement | null>(null)
  if (openerRef.current === null) {
    const active = document.activeElement
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null
  }

  /**
   * Hands focus back on the way out, standing in for the `onCloseAutoFocus`
   * this panel's early unmount skips.
   *
   * A layout effect for the reason `toast.tsx` gives: cleanup has to run while
   * the node is still connected, or the question "does the panel still hold
   * focus?" is always answered no.
   */
  useLayoutEffect(() => {
    const opener = openerRef.current
    return () => {
      // A write on the way out — Save note, then Escape — puts an Undo in the
      // toast stack and the stack takes focus so the Undo is reachable. Taking
      // it back now would withdraw the Undo a frame after offering it, so the
      // trigger is handed to the toast to use when it goes. Same contract
      // `dialog.tsx` uses.
      if (document.activeElement?.closest(TOAST_STACK_SELECTOR)) {
        deferFocusReturn(opener?.isConnected ? opener : null)
        return
      }
      if (opener?.isConnected) {
        opener.focus({ preventScroll: true })
        return
      }
      // The opener went with the record it belonged to. `<main>` is
      // `tabIndex={-1}` for this (`AppShell.tsx`) — resuming the tab order in
      // the content beats resuming it at the skip link.
      document.getElementById('main')?.focus({ preventScroll: true })
    }
  }, [])

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        // `data-closed:animate-none` belongs with the early return above: with
        // no exit animation there is nothing for Radix to wait on either. Kept
        // as a second guard, and right on its own terms — a window-sized
        // surface scaling out is more movement than closing a panel deserves.
        // The rest overrides the shared max-width; this one is the window.
        className="flex h-[94dvh] w-[96vw] max-w-none flex-col gap-3 sm:max-w-none data-closed:animate-none"
        aria-describedby={undefined}
        /**
         * Keep the opening focus off the content.
         *
         * Left to itself the focus goes to the first focusable child, which for
         * the PDF panel is the `<iframe>` — measured `activeElement: IFRAME`.
         * Focus then sits in another document, where Escape never reaches this
         * one, so the keyboard route out disappears the moment the panel opens.
         * Focusing the panel keeps Escape working and leaves the close button
         * one Tab away.
         */
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus()
        }}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="truncate font-mono text-sm">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="sr-only">{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        {/* min-h-0 so a child that scrolls scrolls inside this box rather than
            growing it past the viewport it was sized against. */}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
