import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Field } from '@/components/common/Field'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SnoozeSteps } from '@/components/common/SnoozeSteps'
import type { RowActions } from '@/components/vault/reminders/model'
import { bucketOf } from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'
import { BUCKET_TEXT } from '@/components/common/timeline-buckets'
import { TODAY } from '@/lib/today'
import { cn } from '@/lib/utils'
import { useDomain } from '@/i18n/domain'
import { isWholeDate } from '@/lib/date-draft'

/** The two-line date block, shared by the snooze trigger and the inert copy. */
export function DateLines({ item }: { item: TimelineItem }) {
  const domain = useDomain()
  return (
    <>
      <span
        className={cn(
          'block text-xs font-medium whitespace-nowrap',
          BUCKET_TEXT[bucketOf(item, TODAY)],
        )}
      >
        {domain.when(item, TODAY)}
      </span>
      <span className="mt-0.5 block font-mono text-xs text-text-3">
        {domain.shortDate(item.date)}
      </span>
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
  const { t } = useTranslation('vault')
  const domain = useDomain()
  const [open, setOpen] = useState(false)
  // Seeded from the row so the calendar opens on the month the reminder is in
  // rather than on today, which for an overdue item is the wrong page.
  const [picked, setPicked] = useState(item.date)
  const movable = isWholeDate(picked) && picked !== item.date

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
        title={t('reminders.snooze.title')}
        aria-label={t('reminders.snooze.label', {
          title: item.title,
          when: domain.when(item, TODAY),
        })}
        className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-end transition-colors hover:bg-well data-[state=open]:bg-well"
      >
        <DateLines item={item} />
      </PopoverTrigger>

      <PopoverContent align="end" className="w-60">
        <div className="px-0.5 text-xs tracking-wide text-text-3 uppercase">
          {t('reminders.snooze.heading')}
        </div>
        <div className="flex flex-col">
          {/* `dated`: this menu hangs off the reminder's own date, so a step has
              to name the day it lands on rather than a duration. */}
          <SnoozeSteps
            date={item.date}
            spell="dated"
            onPick={(days) => {
              setOpen(false)
              actions.snooze(item, days)
            }}
          />
        </div>

        <span aria-hidden className="h-px bg-hairline" />

        {/* No `min` on the input. An overdue reminder opens this field holding a
            date that is already past, and a minimum of today would mark it
            invalid before anyone touched it — and moving something back a day
            is a legitimate correction, not a snooze.

            `picked` is a draft, moved only on Enter or the Move button. The
            field opens holding a whole date, so every keystroke in one segment
            (a '2' in the month, an arrow key) is another whole date, and
            moving on change sent the reminder to the first of them. */}
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            // The popover is portalled, but React still bubbles the submit up
            // the component tree to whatever form the row sits in.
            event.stopPropagation()
            if (!movable) return
            setOpen(false)
            actions.moveTo(item, picked)
          }}
        >
          <Field
            label={t('reminders.snooze.pickDate')}
            type="date"
            value={picked}
            onChange={(event) => setPicked(event.target.value)}
          />
          <Button type="submit" variant="outline" className="self-end" disabled={!movable}>
            {t('reminders.snooze.move')}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
