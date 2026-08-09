import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * The last stop before something goes away.
 *
 * Cancel comes first in the DOM, which puts it left of the destructive action
 * in the footer and — the part that matters — makes it what Enter fires,
 * because Radix's focus scope lands on the first tabbable node. Pairing a
 * destructive default with the return key is how people delete things they
 * meant to keep.
 *
 * Pair with a toast carrying an Undo where the action is recoverable; this
 * dialog is for the ones that are not.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Required rather than optional: it is what names the dialog for assistive
   *  tech, and it is where the consequence gets spelled out. */
  description: ReactNode
  confirmLabel: string
  tone?: 'danger'
  onConfirm: () => void
}) {
  // Nothing at all while closed, and that is the whole point.
  //
  // Every other dialog in the app is mounted by `DialogHost` only while it is
  // open, so closing one tears the Radix tree down in the same commit. This one
  // was the exception: it stayed mounted with `open={false}` and left the
  // teardown to the exit animation, via Radix's Presence. When that animation
  // does not end — a background tab, a paused compositor, an animation cancelled
  // by a class change mid-flight — Presence never sends ANIMATION_END and the
  // panel is suspended forever: the portal stays, the app shell keeps the
  // `aria-hidden="true"` and the `pointer-events: none` Radix put on it, and
  // every control outside the dialog is gone for keyboard and screen reader
  // alike. One delete confirmation could lock a user out of the whole app, with
  // no way back short of a reload. Unmounting on close makes that unreachable —
  // the cost is the 150ms fade-out, which no other dialog here has either.
  if (!open) return null

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            variant={tone === 'danger' ? 'destructive' : 'default'}
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
