import { useState } from 'react'
import { Field } from '@/components/common/Field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SNOOZE_STEPS, anchorOf } from '@/components/vault/reminders/model'
import type { RowActions } from '@/components/vault/reminders/model'
import { addDays, bucketOf, shortDate, whenLabel } from '@/data/timeline'
import type { TimelineBucket, TimelineItem } from '@/data/timeline'
import { TODAY } from '@/lib/today'
import { cn } from '@/lib/utils'

const bucketText: Record<TimelineBucket, string> = {
  overdue: 'text-danger',
  today: 'text-warning',
  upcoming: 'text-text-3',
  done: 'text-text-3',
}

/** The two-line date block, shared by the snooze trigger and the inert copy. */
export function DateLines({ item }: { item: TimelineItem }) {
  return (
    <>
      <span
        className={cn(
          'block text-xs font-medium whitespace-nowrap',
          bucketText[bucketOf(item, TODAY)],
        )}
      >
        {whenLabel(item, TODAY)}
      </span>
      <span className="mt-0.5 block font-mono text-xs text-text-3">{shortDate(item.date)}</span>
    </>
  )
}

/**
 * Snooze, hung off the date the user is already looking at.
 *
 * Every option writes a new date and nothing else, so the row re-buckets and
 * physically moves from Overdue down into Upcoming. That journey is the
 * feedback — the grouping below is recomputed from `bucketOf` every render
 * precisely so it can happen.
 */
export function SnoozeMenu({ item, actions }: { item: TimelineItem; actions: RowActions }) {
  const [open, setOpen] = useState(false)
  // Seeded from the row so the calendar opens on the month the reminder is in
  // rather than on today, which for an overdue item is the wrong page.
  const [picked, setPicked] = useState(item.date)
  const anchor = anchorOf(item)
  const soon = anchor === TODAY

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Re-seeded on the way open, not just at mount. Snoozing rewrites the
        // row's date underneath this component, and a field still holding last
        // week's value would offer to move the reminder back there.
        if (next) setPicked(item.date)
        setOpen(next)
      }}
    >
      <PopoverTrigger
        title="Snooze or move this reminder"
        aria-label={`Snooze "${item.title}" — ${whenLabel(item, TODAY)}`}
        className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-right transition-colors hover:bg-well data-[state=open]:bg-well"
      >
        <DateLines item={item} />
      </PopoverTrigger>

      <PopoverContent align="end" className="w-60">
        <div className="px-0.5 text-xs tracking-wide text-text-3 uppercase">Snooze</div>
        <div className="flex flex-col">
          {SNOOZE_STEPS.map((step) => (
            <button
              key={step.days}
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1.5 text-xs text-text-2 transition-colors hover:bg-well hover:text-text-1"
              onClick={() => {
                setOpen(false)
                actions.snooze(item, step.days)
              }}
            >
              <span className="flex-1 text-left">{soon ? step.soon : step.later}</span>
              <span className="font-mono text-text-3">{shortDate(addDays(anchor, step.days))}</span>
            </button>
          ))}
        </div>

        <span aria-hidden className="h-px bg-hairline" />

        {/* No `min` on the input. An overdue reminder opens this field holding a
            date that is already past, and a minimum of today would mark it
            invalid before anyone touched it — and moving something back a day
            is a legitimate correction, not a snooze. */}
        <Field
          label="Pick a date"
          type="date"
          value={picked}
          onChange={(event) => {
            const iso = event.target.value
            setPicked(iso)
            if (!iso || iso === item.date) return
            setOpen(false)
            actions.moveTo(item, iso)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
