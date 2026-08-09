import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Panel } from '@/components/common/Panel'
import { TODAY, WEEKDAYS, buildMonth, stepMonth } from '@/data/calendar'
import { TODAY as TODAY_ISO, daysBetween, isoOf, partsOf } from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'
import { useDialogs } from '@/lib/dialogs-context'
import { applicationsPath, calendarPath, formatSort, vaultPath } from '@/lib/links'
import { useApplications, useTimeline } from '@/lib/store-context'
import { KIND_ICON } from '@/lib/timeline-visuals'
import { cn } from '@/lib/utils'

const MONTH_TODAY = `${buildMonth(TODAY.year, TODAY.month).label} ${TODAY.day}`

/**
 * What a day is marked with — the Calendar route's four marks, by the same two
 * thresholds, so the two grids cannot disagree about the same date.
 *
 * This panel was the last place still reading the seed's `TimelineItem.urgency`,
 * a priority somebody typed in by hand. It painted Oct 15 — three days out —
 * overdue red while the week strip 200px below called Oct 12 amber, and it kept
 * a ticked-off reminder's red dot under a toast that said the thing was off the
 * dashboard. Completed is checked first and outranked by nothing: a finished
 * item is not past due, whatever its date says.
 */
type Mark = 'done' | 'overdue' | 'soon' | 'none'

function markOf(item: TimelineItem): Mark {
  if (item.completedOn) return 'done'
  const gap = daysBetween(TODAY_ISO, item.date)
  if (gap < 0) return 'overdue'
  // Today and tomorrow are the only two days amber may claim.
  return gap <= 1 ? 'soon' : 'none'
}

/** Hollow for done, exactly as the calendar draws it. */
const MARK_DOT: Record<Mark, string> = {
  done: 'border border-text-3 bg-transparent',
  overdue: 'bg-danger',
  soon: 'bg-warning',
  none: 'bg-text-3',
}

const MARK_TEXT: Record<Mark, string> = {
  done: 'text-text-3',
  overdue: 'text-danger',
  soon: 'text-warning',
  none: 'text-text-3',
}

/** An ISO date in the shape the calendar route reads it. */
const partsAsParams = (iso: string) => {
  const { y, m, d } = partsOf(iso)
  return { y, m, d }
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
  const { all, stageCounts } = useApplications()
  const { all: items, forMonth, overdue } = useTimeline()
  const { open } = useDialogs()
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

  /**
   * The counters, derived rather than written down — and every one of them a
   * link, because a number you cannot act on is trivia.
   *
   * They were a fixed `summary` of 37/21/4 that no longer matched anything the
   * store held, so adding an application moved every list on the page except
   * the number claiming to count them.
   *
   * Two changes worth knowing about. "Applications" is gone: the total was the
   * least useful of the four (the pipeline panel below already breaks it down)
   * and it has been swapped for *Done today*, which is the only counter here
   * that goes up as you work. And "Follow-ups due" is now *Overdue*, counting
   * every past-due dated item rather than only the chases — the panel beside it
   * groups them the same way, and two counts of the same rows that disagree is
   * the exact defect this pass exists to remove.
   *
   * The destinations are the honest ones, not the exact ones: no filter selects
   * two stages at once, so "Screens & interviews" opens the table sorted by
   * stage, where those rows sit together.
   */
  const stats = useMemo(() => {
    const countOf = (id: string) => stageCounts.find((s) => s.id === id)?.count ?? 0
    const oldestOverdue = overdue[0]
    return [
      {
        label: 'Active',
        value: String(all.length - countOf('closed')),
        to: applicationsPath(),
      },
      {
        label: 'Screens & interviews',
        value: String(countOf('screen') + countOf('interview')),
        to: applicationsPath({ view: 'table', sort: formatSort('stage', 'asc') }),
      },
      {
        label: 'Overdue',
        value: String(overdue.length),
        // Lands on the day the oldest one was due rather than on this month,
        // which is where you have to go to deal with it.
        to: oldestOverdue ? calendarPath(partsAsParams(oldestOverdue.date)) : calendarPath(),
        alert: overdue.length > 0,
      },
      {
        label: 'Done today',
        value: String(items.filter((i) => i.completedOn === TODAY_ISO).length),
        to: vaultPath({ tool: 'reminders' }),
      },
    ]
  }, [all, items, stageCounts, overdue])

  const monthEvents = useMemo(() => forMonth(view.year, view.month), [forMonth, view])

  /** day -> its events, so the grid and the agenda read from one source. */
  const eventsByDay = useMemo(() => {
    const map = new Map<number, typeof monthEvents>()
    for (const e of monthEvents) {
      const day = partsOf(e.date).d
      const list = map.get(day)
      if (list) list.push(e)
      else map.set(day, [e])
    }
    return map
  }, [monthEvents])

  const eventDays = useMemo(() => {
    const map = new Map<number, Mark>()
    // `done` ranks below everything, so a day whose work is finished shows the
    // hollow marker and a day with one live item still shows that item's colour.
    const rank = { overdue: 3, soon: 2, none: 1, done: 0 } as const
    for (const e of monthEvents) {
      // Keep the most urgent marker when a day holds several events.
      const day = partsOf(e.date).d
      const mark = markOf(e)
      const current = map.get(day)
      if (!current || rank[mark] > rank[current]) map.set(day, mark)
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

      {/* Row 1 — counters, two up. Each is one link covering the figure and its
          label: two adjacent links to the same place would be two tab stops
          reading the same thing. */}
      {/* A list, not the <dl> it was: a description list cannot hold an anchor
          between the group and its <dt>/<dd>, and the figure and the label have
          to be one link or they become two tab stops saying the same thing. */}
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {stats.map((s) => (
          <li key={s.label} className="min-w-0">
            <Link
              to={s.to}
              className="group flex items-baseline gap-1.5 rounded-sm underline-offset-4 hover:underline"
            >
              <span
                className={cn(
                  'tabular text-xl font-semibold tracking-[-0.02em]',
                  // Red is past due and nothing else, so it appears only when
                  // something actually is. A permanently red zero is decoration.
                  s.alert && 'text-danger',
                )}
              >
                {s.value}
              </span>
              <span className="min-w-0 truncate text-xs text-text-2 group-hover:text-accent">
                {s.label}
              </span>
            </Link>
          </li>
        ))}
      </ul>

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
            // Carries the month and day this panel is showing, now that the
            // calendar reads them from the URL — paging forward here and then
            // landing back on today was the old behaviour.
            to={calendarPath({ y: view.year, m: view.month, d: selected })}
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
              const mark = eventDays.get(day)
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
                  // reader nothing about which month or what is on the day —
                  // including the hollow dot's "everything here is ticked off".
                  aria-label={`${month.label} ${day}${
                    count ? `, ${count} event${count > 1 ? 's' : ''}` : ', no events'
                  }${mark === 'done' ? ', all done' : ''}`}
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
                        : // A day is emphasised while it still holds work. Once
                          // its last item is ticked off it drops back to plain,
                          // which is the numeral half of the hollow dot below.
                          mark && mark !== 'done'
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
                    {mark ? <span className={cn('size-1 rounded-full', MARK_DOT[mark])} /> : null}
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
              <p className="text-xs text-text-3">
                Nothing planned.{' '}
                <button
                  type="button"
                  // The empty day is the moment you want to fill it, and until
                  // now this was the one dead end left on the panel: a picker
                  // that could select a day and then do nothing with it.
                  onClick={() =>
                    open('timelineItem', {
                      mode: 'event',
                      initial: { date: isoOf(view.year, view.month, selected) },
                    })
                  }
                  className="cursor-pointer text-accent underline-offset-2 hover:underline"
                >
                  Add something
                </button>
                .
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {dayEvents.map((e) => {
                  const Icon = KIND_ICON[e.kind]
                  const mark = markOf(e)
                  return (
                    <li key={e.id} className="flex gap-2">
                      <Icon
                        className={cn('mt-0.5 size-3.5 shrink-0', MARK_TEXT[mark])}
                        strokeWidth={1.8}
                        aria-hidden
                      />
                      {/* The row opens the item. It named one and left you to
                          find it on the calendar, which is two navigations to
                          correct a time. */}
                      <button
                        type="button"
                        onClick={() =>
                          open('timelineItem', {
                            mode: e.remind ? 'reminder' : 'event',
                            initial: e,
                          })
                        }
                        className="min-w-0 cursor-pointer rounded-sm text-left transition-colors hover:text-accent"
                      >
                        {/* Struck and greyed once ticked off, the same as the
                            calendar draws it — the row stays because the day
                            still held it, but it is no longer something owed. */}
                        <span
                          className={cn(
                            'block truncate text-xs text-text-1',
                            mark === 'done' && 'text-text-3 line-through decoration-1',
                          )}
                        >
                          {e.title}
                        </span>
                        <span className="block truncate text-xs text-text-3">{e.detail}</span>
                      </button>
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
