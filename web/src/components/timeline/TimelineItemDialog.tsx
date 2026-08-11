import { ItemForm } from '@/components/timeline/dialog/ItemForm'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { TimelineItem } from '@/data/timeline'

/**
 * Write a reminder or a calendar entry. One dialog, because they are one record.
 *
 * A `TimelineItem` with `remind` on shows in the Vault's reminders list, and the
 * same item on its date shows on the calendar — so a separate "add event" dialog
 * would be a second write path into a single array, and the two would drift the
 * way the five old dated types did. `mode` changes exactly three things: the
 * dialog's title, which field leads, and what `kind` and `remind` start as.
 * Everything below that point is identical, deliberately.
 */
export type TimelineItemDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'reminder' | 'event'
  /** Pass one with an `id` to edit; anything else prefills a new record. */
  initial?: Partial<TimelineItem>
  onSaved?: (item: TimelineItem) => void
}

export function TimelineItemDialog({
  open,
  onOpenChange,
  mode,
  initial,
  onSaved,
}: TimelineItemDialogProps) {
  const editing = initial?.id !== undefined
  const noun = mode === 'reminder' ? 'reminder' : 'event'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${noun}` : `New ${noun}`}</DialogTitle>
          {/* Identical in both modes on purpose: explaining that these are the
              same record is the whole reason there is one dialog. */}
          <DialogDescription>
            One record either way — it lands on the calendar for the date you give it, and in the
            Vault's reminders list while the switch beside the title is on.
          </DialogDescription>
        </DialogHeader>
        {/* The form is a child so it mounts with the dialog: its state is seeded
            from `initial` once, and a fresh open starts from the props rather
            than from whatever was typed and abandoned last time. */}
        <ItemForm mode={mode} initial={initial} onOpenChange={onOpenChange} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  )
}
