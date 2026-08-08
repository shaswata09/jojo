import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  FileText,
  Plane,
  Users,
  Video,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Panel } from '@/components/common/Panel'
import { EVENT_YEAR, TODAY, WEEKDAYS, buildMonth, calendarEvents, stepMonth } from '@/data/calendar'
import { stats } from '@/data/seed'
import type { EventKind, Urgency } from '@/data/seed'
import { cn } from '@/lib/utils'

const MONTH_TODAY = `${buildMonth(TODAY.year, TODAY.month).label} ${TODAY.day}`

const dot: Record<Urgency, string> = {
  red: 'bg-danger',
  amber: 'bg-warning',
  gray: 'bg-text-3',
}

const urgencyText: Record<Urgency, string> = {
  red: 'text-danger',
  amber: 'text-warning',
  gray: 'text-text-3',
}

/** Same mapping ThisWeek uses, so an event looks the same wherever it appears. */
const kindIcon: Record<EventKind, LucideIcon> = {
  deadline: CalendarClock,
  interview: Video,
  visit: Plane,
  call: Users,
  prep: FileText,
}

/**
 * Counters and a month at a glance, stacked in one card.
 *
 * The counters were four square tiles with a vertically-centred numeral, which
 * left a large void in each and pushed the whole block to ~200px tall for four
 * numbers. Baseline-aligned figure + label costs a third of the height, and the
 * space it frees pays for something that actually carries information.
 *
 * The month is a picker rather than a read-only grid: the dots said a day held
 * something without ever saying what, so the only way to find out was to leave
 * the dashboard. Selecting a day now lists it beside the month.
 */
export function GlancePanel() {
  const [view, setView] = useState<{ year: number; month: number }>({
    year: TODAY.year,
    month: TODAY.month,
  })
  const month = useMemo(() => buildMonth(view.year, view.month), [view])
  const [selected, setSelected] = useState<number>(TODAY.day)

  /**
   * Paging keeps the day you were looking at, so stepping through months
   * compares like with like. Clamped to the new month's length — otherwise
   * paging off the 31st into a 30-day month selects a day that does not exist
   * and the agenda goes permanently blank. Returning to the current month
   * snaps back to today.
   */
  const goTo = useCallback((next: { year: number; month: number }) => {
    setView(next)
    setSelected((day) =>
      next.year === TODAY.year && next.month === TODAY.month
        ? TODAY.day
        : Math.min(day, buildMonth(next.year, next.month).days),
    )
  }, [])

  const isCurrentMonth = view.year === TODAY.year && view.month === TODAY.month

  const monthEvents = useMemo(
    // The seeded events carry a month but no year, so the year has to be
    // checked separately or October 2027 would show October 2026's deadlines.
    () => (view.year === EVENT_YEAR ? calendarEvents.filter((e) => e.month === view.month) : []),
    [view],
  )

  /** day -> its events, so the grid and the agenda read from one source. */
  const eventsByDay = useMemo(() => {
    const map = new Map<number, typeof monthEvents>()
    for (const e of monthEvents) {
      const list = map.get(e.day)
      if (list) list.push(e)
      else map.set(e.day, [e])
    }
    return map
  }, [monthEvents])

  const eventDays = useMemo(() => {
    const map = new Map<number, Urgency>()
    const rank = { red: 3, amber: 2, gray: 1 } as const
    for (const e of monthEvents) {
      // Keep the most urgent marker when a day holds several events.
      const current = map.get(e.day)
      if (!current || rank[e.urgency] > rank[current]) map.set(e.day, e.urgency)
    }
    return map
  }, [monthEvents])

  const cells = [
    ...Array.from({ length: month.startsOn }, () => null),
    ...Array.from({ length: month.days }, (_, i) => i + 1),
  ]

  const dayEvents = eventsByDay.get(selected) ?? []

  return (
    <Panel className="flex min-w-0 flex-col">
      <h2 className="sr-only">At a glance</h2>

      {/* Row 1 — counters, two up. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {stats.map((s) => (
          <div key={s.label} className="flex items-baseline gap-1.5">
            <dd
              className={cn(
                'tabular text-xl font-semibold tracking-[-0.02em]',
                s.alert && 'text-danger',
              )}
            >
              {s.value}
            </dd>
            <dt className="min-w-0 truncate text-xs text-text-2">{s.label}</dt>
          </div>
        ))}
      </dl>

      {/* Row 2 — the month and the selected day, side by side.
          A container query, not a viewport one: this card is the narrow column
          of the dashboard on large screens but full width on small ones, so its
          own width is the only thing that says whether two halves will fit.
          A `lg:` breakpoint would have split it exactly where it is narrowest. */}
      <div className="@container mt-4 border-t border-hairline pt-3.5">
        <div className="mb-2 flex items-center justify-between gap-1">
          <h3 className="min-w-0 truncate text-xs font-medium text-text-2">
            {month.label} <span className="text-text-3">{month.year}</span>
          </h3>

          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => goTo(stepMonth(view.year, view.month, -1))}
              aria-label="Previous month"
              className="grid size-6 cursor-pointer place-items-center rounded-sm text-text-3 hover:bg-well hover:text-text-1"
            >
              <ChevronLeft className="size-3.5" strokeWidth={2} aria-hidden />
            </button>

            {/* The dot doubles as a state read: filled while you are on the
                current month, hollow once you have paged away from it. */}
            <button
              type="button"
              onClick={() => goTo({ year: TODAY.year, month: TODAY.month })}
              aria-label="Go to current month"
              aria-current={isCurrentMonth ? 'date' : undefined}
              title={`${MONTH_TODAY} — current month`}
              className="grid size-6 cursor-pointer place-items-center rounded-sm hover:bg-well"
            >
              <span
                aria-hidden
                className={cn(
                  'size-1.5 rounded-full border',
                  isCurrentMonth ? 'border-accent bg-accent' : 'border-text-3 bg-transparent',
                )}
              />
            </button>

            <button
              type="button"
              onClick={() => goTo(stepMonth(view.year, view.month, 1))}
              aria-label="Next month"
              className="grid size-6 cursor-pointer place-items-center rounded-sm text-text-3 hover:bg-well hover:text-text-1"
            >
              <ChevronRight className="size-3.5" strokeWidth={2} aria-hidden />
            </button>
          </div>

          <Link
            to="/calendar"
            className="shrink-0 text-xs text-text-3 underline-offset-4 hover:text-accent hover:underline"
          >
            Open calendar
          </Link>
        </div>

        <div className="grid gap-x-4 gap-y-3 @[21rem]:grid-cols-2">
          {/* gap-x is load-bearing: without it the columns are exactly the
              width of a marker and adjacent circles butt together. */}
          <div className="grid grid-cols-7 gap-x-0.5 gap-y-1" role="presentation">
            {WEEKDAYS.map((d) => (
              <div key={d} className="pb-0.5 text-center text-xs text-text-3">
                {d.slice(0, 1)}
              </div>
            ))}

            {cells.map((day, i) => {
              if (day === null) return <div key={`blank-${i}`} aria-hidden />
              const urgency = eventDays.get(day)
              const isToday = day === month.today
              const isSelected = day === selected
              const count = eventsByDay.get(day)?.length ?? 0

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setSelected(day)}
                  aria-pressed={isSelected}
                  aria-current={isToday ? 'date' : undefined}
                  // The visible label is a bare numeral, which tells a screen
                  // reader nothing about which month or what is on the day.
                  aria-label={`${month.label} ${day}${
                    count ? `, ${count} event${count > 1 ? 's' : ''}` : ', no events'
                  }`}
                  className="flex cursor-pointer flex-col items-center gap-0.5 rounded-sm py-0.5"
                >
                  <span
                    className={cn(
                      // Fluid, not a fixed size-6: this card is the narrow
                      // column of the dashboard, so a 24px marker in a ~25px
                      // track left no daylight between neighbouring days and
                      // today's filled circle ran into the 13th. Capped at 20px
                      // and allowed to shrink with the column, it can never
                      // outgrow its track.
                      'tabular grid aspect-square w-full max-w-5 place-items-center rounded-full text-xs transition-colors',
                      isToday
                        ? 'bg-accent font-semibold text-[color:var(--accent-fg)]'
                        : urgency
                          ? 'font-medium text-text-1'
                          : 'text-text-3',
                      // Selection is a ring, not a fill, so it can coexist with
                      // today's filled marker. Suppressed when they coincide:
                      // fill plus ring plus offset gap renders as a bullseye,
                      // and on first load they always coincide.
                      isSelected &&
                        !isToday &&
                        'ring-2 ring-accent ring-offset-2 ring-offset-panel',
                      !isSelected && !isToday && 'hover:bg-well',
                    )}
                  >
                    {day}
                  </span>
                  {/* Fixed-height rail so rows stay aligned with or without a dot. */}
                  <span aria-hidden className="flex h-1 items-center">
                    {urgency ? <span className={cn('size-1 rounded-full', dot[urgency])} /> : null}
                  </span>
                </button>
              )
            })}
          </div>

          {/* The selected day. `aria-live` because the heading and the list both
              change under a click that happens somewhere else on the page. */}
          <div
            aria-live="polite"
            className="min-w-0 border-t border-hairline pt-3 @[21rem]:border-t-0 @[21rem]:border-l @[21rem]:pt-0 @[21rem]:pl-4"
          >
            <h4 className="mb-2 text-xs font-medium text-text-2">
              {month.label} {selected}
              {selected === month.today ? <span className="text-text-3"> · today</span> : null}
            </h4>

            {dayEvents.length === 0 ? (
              <p className="text-xs text-text-3">Nothing planned.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {dayEvents.map((e) => {
                  const Icon = kindIcon[e.kind]
                  return (
                    <li key={e.id} className="flex gap-2">
                      <Icon
                        className={cn('mt-0.5 size-3.5 shrink-0', urgencyText[e.urgency])}
                        strokeWidth={1.8}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block text-xs text-text-1">{e.title}</span>
                        <span className="block text-xs text-text-3">{e.detail}</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Panel>
  )
}
