import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayCell } from '@/components/calendar/DayCell'
import { MonthPicker } from '@/components/calendar/MonthPicker'
import { Panel } from '@/components/common/Panel'
import { MONTH_LABELS, WEEKDAYS, stepMonth } from '@/data/calendar'
import type { CalendarMonth } from '@/data/calendar'
import { isoOf, shortDate } from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'
import { markOf } from '@/lib/timeline-visuals'
import type { Mark } from '@/lib/timeline-visuals'
import { TODAY_PARTS } from '@/lib/today'
import { cn } from '@/lib/utils'

export function MonthGrid({
  month,
  monthItems,
  eventsFor,
  selected,
  dotsOnly,
  tall,
  isCurrentMonth,
  onGoTo,
  onSelectDay,
  onAdd,
  onOpen,
}: {
  month: CalendarMonth
  /** Everything in the month, for the key under the grid. */
  monthItems: TimelineItem[]
  /** Day of the month → what is on it, already sorted. */
  eventsFor: Map<number, TimelineItem[]>
  selected: number
  dotsOnly: boolean
  tall: boolean
  isCurrentMonth: boolean
  onGoTo: (next: { year: number; month: number }) => void
  onSelectDay: (day: number) => void
  onAdd: (iso: string) => void
  onOpen: (item: TimelineItem) => void
}) {
  /**
   * Today, as the Today button's tooltip spells it.
   *
   * Recomposed from `TODAY_PARTS` rather than imported from `TODAY` so the
   * marker sits on the same day as the grid, which pages by `{year, month}`.
   *
   * IN THE RENDER, not at module scope, and that is the fix rather than the
   * style. `TODAY_PARTS` is reassigned at the local midnight (`@/lib/today`),
   * and a module-level const derived from it was sampled once when this file
   * was first imported — measured with fake timers from 23:50, twenty minutes
   * later the pin had moved to the 13th and this tooltip still read "12 Oct"
   * beside a grid whose today marker had moved. One `isoOf` per render is not a
   * cost worth freezing a date for.
   */
  const todayISO = isoOf(TODAY_PARTS.year, TODAY_PARTS.month, TODAY_PARTS.day)

  // Leading blanks so the 1st lands on its weekday, the days, then enough
  // trailing blanks to finish the week. Both ends render as real (empty) cells:
  // October 2026 starts on a Thursday and ends on a Saturday, and with nothing
  // drawn in those slots the grid lost its top-left and bottom-right corners —
  // MON/TUE/WED headed thin air and the frame read as a rendering fault.
  const trailing = (7 - ((month.startsOn + month.days) % 7)) % 7
  const cells = [
    ...Array.from({ length: month.startsOn }, () => null),
    ...Array.from({ length: month.days }, (_, i) => i + 1),
    ...Array.from({ length: trailing }, () => null),
  ]

  /**
   * The key under the grid, built from what this month actually contains.
   *
   * It replaces a legend of seven kind icons — none of which the grid ever
   * drew — with the marks that are really on it. Filtered by presence rather
   * than listed unconditionally: a key promising an overdue colour in a month
   * that has nothing overdue is the same invented data the empty-state law
   * bans, one step removed.
   */
  const marksPresent = new Set(monthItems.map(markOf))
  const markKey = [
    {
      key: 'overdue',
      swatch: 'border-danger-border bg-danger-soft',
      label: 'Overdue',
      struck: false,
    },
    {
      key: 'soon',
      swatch: 'border-warning-border bg-warning-soft',
      label: 'Due within 48 hours',
      struck: false,
    },
    {
      key: 'done',
      swatch: 'border-hairline-strong bg-transparent',
      label: 'Done',
      struck: true,
    },
  ].filter((entry) => marksPresent.has(entry.key as Mark))

  return (
    <Panel className="min-w-0">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-base font-medium">
          {month.label} <span className="text-text-3">{month.year}</span>
        </h2>
        <MonthPicker year={month.year} month={month.month} onPick={onGoTo} />

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onGoTo(stepMonth(month.year, month.month, -1))}
            aria-label="Previous month"
            className="grid size-7 cursor-pointer place-items-center rounded-full border border-hairline bg-well text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1"
          >
            <ChevronLeft className="size-4" strokeWidth={1.8} />
          </button>

          {/* A word, not a 6px dot between two arrows. The dot carried
              its whole meaning in a tooltip, and the one state it did
              show — filled or hollow — was indistinguishable from a
              decorative separator.

              It is not disabled on the current month: from October 20 it
              still walks you back to October 12, which is the more common
              reason to press it. Recessed instead, so "already here"
              reads as a pressed control rather than a dead one. */}
          <button
            type="button"
            onClick={() => onGoTo({ year: TODAY_PARTS.year, month: TODAY_PARTS.month })}
            aria-current={isCurrentMonth ? 'date' : undefined}
            title={
              isCurrentMonth
                ? `Back to ${shortDate(todayISO)}`
                : `Go to ${MONTH_LABELS[TODAY_PARTS.month - 1]} ${TODAY_PARTS.year}`
            }
            className={cn(
              'h-7 cursor-pointer rounded-full border px-2.5 text-xs transition-colors',
              isCurrentMonth
                ? 'border-accent-border bg-accent-soft text-accent'
                : 'border-hairline bg-well text-text-2 hover:border-hairline-strong hover:text-text-1',
            )}
          >
            Today
          </button>

          <button
            type="button"
            onClick={() => onGoTo(stepMonth(month.year, month.month, 1))}
            aria-label="Next month"
            className="grid size-7 cursor-pointer place-items-center rounded-full border border-hairline bg-well text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1"
          >
            <ChevronRight className="size-4" strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Two versions, because the long one described a room the reader
          is not in below `lg`: there is no grid "beside" anything when
          the panels are stacked, no pointer to drag with, and no keyboard
          to fall back to. */}
      <p className="mb-3 text-xs text-text-3 lg:hidden">Tap a day to see what is on it.</p>
      <p className="mb-3 hidden text-xs text-text-3 lg:block">
        Pick a day to list it beside the grid. Click an event to edit it, or drag it onto another
        day — dragging needs a pointer, so the date field inside the event is the keyboard route.
      </p>

      <div className="grid grid-cols-7 gap-1" role="presentation">
        {WEEKDAYS.map((label) => (
          <div key={label} className="pb-1 text-center text-xs text-text-3 uppercase">
            {label.slice(0, 1)}
            <span className="hidden sm:inline">{label.slice(1)}</span>
          </div>
        ))}

        {cells.map((day, i) => {
          // Outline only, no fill: it completes the frame without
          // offering itself as a day you could drop something on.
          if (day === null)
            return (
              <div key={`blank-${i}`} aria-hidden className="rounded-md border border-hairline" />
            )

          const iso = isoOf(month.year, month.month, day)
          return (
            <DayCell
              key={day}
              day={day}
              iso={iso}
              label={`${month.label} ${day}`}
              items={eventsFor.get(day) ?? []}
              isToday={day === month.today}
              isSelected={day === selected}
              dotsOnly={dotsOnly}
              tall={tall}
              onSelect={() => onSelectDay(day)}
              onAdd={() => onAdd(iso)}
              onOpen={onOpen}
            />
          )
        })}
      </div>

      {/* A key to the grid, not a filter of it. The divider goes with the
          key when the month has none of these marks, rather than ruling a
          line under nothing. */}
      {markKey.length > 0 ? (
        <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-hairline pt-3.5">
          {markKey.map((entry) => (
            <li key={entry.key} className="flex items-center gap-1.5 text-xs text-text-2">
              <span
                aria-hidden
                className={cn('size-2.5 shrink-0 rounded-[2px] border', entry.swatch)}
              />
              <span className={cn(entry.struck && 'line-through decoration-1')}>{entry.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  )
}
