import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Field, FormField, SettingRow } from '@/components/common/Field'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { addDays } from '@/data/timeline'
import { TODAY } from '@/lib/today'
import { cn } from '@/lib/utils'

/** The lengths offered, each with the catalog key that names it. */
const DURATIONS = [
  { mins: 15, key: 'min15' },
  { mins: 30, key: 'min30' },
  { mins: 45, key: 'min45' },
  { mins: 60, key: 'hour1' },
  { mins: 90, key: 'hour1_5' },
  { mins: 120, key: 'hour2' },
  { mins: 180, key: 'hour3' },
] as const

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
  const { t } = useTranslation('timeline')
  const allDayId = useId()
  const durationId = useId()

  /*
   * Quick dates, measured from `TODAY` rather than from a `new Date()` here.
   *
   * `TODAY` is the app's one wall-clock read (`@/lib/today`), and every bucket,
   * countdown and relative label is measured against it. A second read in this
   * module would be a day out from all of them for the few seconds either side
   * of midnight, and "Today" is the one label that must never file a reminder
   * under Overdue the moment it is saved. Same reason the date field defaults
   * to `TODAY`.
   *
   * IN THE RENDER, not at module scope. This was a module-level const, and the
   * comment above it said `TODAY` is "read once per page load" — true when the
   * pin was frozen at import, and false since it started moving at the local
   * midnight. Measured with fake timers on a dialog opened at 23:50 on 12 Oct
   * and used at 00:10: the pin read 2026-10-13 and these three chips still
   * offered 12/13/19 Oct, so the button labelled "Today" wrote YESTERDAY and
   * the reminder it created was overdue before it was saved. That is the exact
   * failure the paragraph above promises cannot happen, so it is now sampled
   * where the render is.
   *
   * Three `addDays` calls per render, on a dialog that renders when a person
   * types in it. Not memoised: the array is rebuilt only when this component
   * re-renders anyway, and a `useMemo` keyed on `TODAY` would have to name it
   * as a dependency that React cannot observe changing.
   *
   * "In 7 days" rather than "In a week": the app has exactly one relative
   * vocabulary — Today / Tomorrow / in N days — and a second spelling for the
   * same gap is how "24d left" and "3 weeks ago" got into the old screens.
   */
  const quickDates = [
    { label: t('schedule.quick.today'), iso: TODAY },
    { label: t('schedule.quick.tomorrow'), iso: addDays(TODAY, 1) },
    { label: t('schedule.quick.inWeek'), iso: addDays(TODAY, 7) },
  ]

  return (
    <>
      <div className="space-y-1.5">
        <Field
          label={t('schedule.date')}
          type="date"
          required
          error={dateError}
          value={date}
          onChange={(event) => onDateChange(event.target.value)}
        />
        <div className="flex flex-wrap gap-1.5">
          {quickDates.map((quick) => {
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
        label={<label htmlFor={allDayId}>{t('schedule.allDay.label')}</label>}
        description={t('schedule.allDay.description')}
        control={<Switch id={allDayId} checked={allDay} onCheckedChange={onAllDayChange} />}
      />

      {allDay ? null : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('schedule.startTime')}
            type="time"
            value={time}
            onChange={(event) => onTimeChange(event.target.value)}
          />
          <FormField label={t('schedule.length')} htmlFor={durationId}>
            <select
              id={durationId}
              value={duration}
              onChange={(event) => onDurationChange(Number(event.target.value))}
              className="h-8 w-full cursor-pointer rounded-lg border border-input bg-transparent px-2 text-sm text-text-1 transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {DURATIONS.map((d) => (
                <option key={d.mins} value={d.mins}>
                  {t(`schedule.durations.${d.key}`)}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      )}
    </>
  )
}
