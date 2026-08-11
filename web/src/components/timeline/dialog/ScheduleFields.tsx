import { useId } from 'react'
import { Field, FormField, SettingRow } from '@/components/common/Field'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { addDays } from '@/data/timeline'
import { TODAY } from '@/lib/today'
import { cn } from '@/lib/utils'

/**
 * Quick dates, measured from `TODAY` rather than from a `new Date()` here.
 *
 * `TODAY` is the wall clock, read once per page load in `@/lib/today`, and every
 * bucket, countdown and relative label in the app is measured against that same
 * read. A second read in this module would be a day out from all of them for the
 * few seconds either side of midnight, and "Today" is the one label that must
 * never file a reminder under Overdue the moment it is saved. Same reason the
 * date field defaults to `TODAY`.
 *
 * "In 7 days" rather than "In a week": the app has exactly one relative
 * vocabulary — Today / Tomorrow / in N days — and a second spelling for the same
 * gap is how "24d left" and "3 weeks ago" got into the old screens.
 */
const QUICK_DATES = [
  { label: 'Today', iso: TODAY },
  { label: 'Tomorrow', iso: addDays(TODAY, 1) },
  { label: 'In 7 days', iso: addDays(TODAY, 7) },
]

const DURATIONS = [
  { mins: 15, label: '15 min' },
  { mins: 30, label: '30 min' },
  { mins: 45, label: '45 min' },
  { mins: 60, label: '1 hour' },
  { mins: 90, label: '1.5 hours' },
  { mins: 120, label: '2 hours' },
  { mins: 180, label: '3 hours' },
]

/** When it happens: the date, and — with All day off — the hour grid slot. */
export function ScheduleFields({
  date,
  onDateChange,
  dateError,
  allDay,
  onAllDayChange,
  time,
  onTimeChange,
  duration,
  onDurationChange,
}: {
  date: string
  onDateChange: (next: string) => void
  dateError?: string
  allDay: boolean
  onAllDayChange: (next: boolean) => void
  time: string
  onTimeChange: (next: string) => void
  duration: number
  onDurationChange: (next: number) => void
}) {
  const allDayId = useId()
  const durationId = useId()

  return (
    <>
      <div className="space-y-1.5">
        <Field
          label="Date"
          type="date"
          required
          error={dateError}
          value={date}
          onChange={(event) => onDateChange(event.target.value)}
        />
        <div className="flex flex-wrap gap-1.5">
          {QUICK_DATES.map((quick) => {
            const on = date === quick.iso
            return (
              <Button
                key={quick.label}
                type="button"
                size="xs"
                variant="outline"
                aria-pressed={on}
                onClick={() => onDateChange(quick.iso)}
                // The pressed chip used to be `secondary`, which on this palette
                // meant the same grey with the border taken away — selection
                // signalled by *removing* an edge. Now it fills.
                className={cn(
                  on && 'bg-accent-soft font-medium text-accent ring-1 ring-accent-border',
                )}
              >
                {quick.label}
              </Button>
            )
          })}
        </div>
      </div>

      <SettingRow
        label={<label htmlFor={allDayId}>All day</label>}
        description="Off gives it a start time and a length, and puts it on the calendar's hour grid."
        control={<Switch id={allDayId} checked={allDay} onCheckedChange={onAllDayChange} />}
      />

      {allDay ? null : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Start time"
            type="time"
            value={time}
            onChange={(event) => onTimeChange(event.target.value)}
          />
          <FormField label="Length" htmlFor={durationId}>
            <select
              id={durationId}
              value={duration}
              onChange={(event) => onDurationChange(Number(event.target.value))}
              className="h-8 w-full cursor-pointer rounded-lg border border-input bg-transparent px-2 text-sm text-text-1 transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {DURATIONS.map((d) => (
                <option key={d.mins} value={d.mins}>
                  {d.label}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      )}
    </>
  )
}
