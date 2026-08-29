import { CalendarDays, ChevronRight, CircleCheck, Plus, Trash2 } from 'lucide-react'
import { DAY_DOT, DAY_TEXT, startLabel } from '@/components/calendar/marks'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { MONTH_LABELS, stepMonth } from '@/data/calendar'
import type { CalendarMonth } from '@/data/calendar'
import { isoOf, partsOf, shortDate, timeLabel } from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'
import { KIND_ICON, KIND_LABEL, markOf } from '@/lib/timeline-visuals'
import { TODAY_PARTS } from '@/lib/today'
import { cn } from '@/lib/utils'

/** The same trick `REVEAL_IN_CELL` plays in DayCell.tsx, on a list row. Written
    out twice because Tailwind scans for whole class names — a group name
    spliced in at runtime emits no CSS. */
const REVEAL_IN_ROW =
  'pointer-events-none opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100'

export function DayRail({
  month,
  selected,
  selectedISO,
  events,
  restOfMonth,
  focus,
  isCurrentMonth,
  onSelectDay,
  onGoTo,
  onAdd,
  onOpen,
  onDelete,
}: {
  month: CalendarMonth
  selected: number
  selectedISO: string
  /** What is on the selected day, already sorted. */
  events: TimelineItem[]
  /** Everything later in the month than the selected day. */
  restOfMonth: TimelineItem[]
  /** The item a link arrived naming, tinted until the highlight decays. */
  focus: string | undefined
  isCurrentMonth: boolean
  onSelectDay: (day: number, focus?: string) => void
  onGoTo: (next: { year: number; month: number }) => void
  onAdd: (iso: string) => void
  onOpen: (item: TimelineItem) => void
  onDelete: (item: TimelineItem) => void
}) {
  /*
   * The current month, for the way back out of a month you paged to.
   *
   * Named in the render rather than at module scope: `TODAY_PARTS` is
   * reassigned at the local midnight (`@/lib/today`), and as a module const
   * this label was sampled once at import. That is invisible on 30 of 31 nights
   * and wrong on the one that matters — a session left open across 31 Oct sent
   * "Back to October" to a button that calls `onGoTo` with the live parts and
   * lands you in November.
   */
  const todayMonth = `${MONTH_LABELS[TODAY_PARTS.month - 1]} ${TODAY_PARTS.year}`

  const isLastDay = selected === month.days
  const nextMonth = stepMonth(month.year, month.month, 1)

  return (
    <Panel className="min-w-0">
      <PanelTitle hint={shortDate(selectedISO)}>
        {selected === month.today ? 'Today' : 'Selected day'}
      </PanelTitle>

      {events.length === 0 ? (
        <EmptyState
          className="py-6"
          icon={CalendarDays}
          title={`Nothing on ${shortDate(selectedISO)}`}
          description="Add an interview, a deadline or a block of prep and it shows up here and on the grid."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => onAdd(selectedISO)}>
                <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                Add event
              </Button>
              {/* An empty day in a month you paged to is the easiest place
                  to get lost: nothing on screen names where "now" is. */}
              {isCurrentMonth ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onGoTo({ year: TODAY_PARTS.year, month: TODAY_PARTS.month })}
                >
                  Back to {todayMonth}
                </Button>
              )}
            </div>
          }
        />
      ) : (
        <ul className="divide-y divide-hairline">
          {events.map((e) => {
            const mark = markOf(e)
            const done = mark === 'done'
            const Icon = done ? CircleCheck : KIND_ICON[e.kind]
            return (
              <li
                key={e.id}
                className={cn(
                  'group/row flex items-start gap-3 py-3',
                  // Marks the item a link named, so arriving from search or
                  // from a reminder lands on something, not just on a date.
                  // The tint decays and the parameter clears with it — see
                  // use-arrival-highlight.ts.
                  e.id === focus && 'arrival-highlight -mx-2 rounded-md px-2',
                )}
              >
                <Icon
                  className={cn('mt-0.5 size-4 shrink-0', DAY_TEXT[mark])}
                  strokeWidth={1.7}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  {/* The way in to editing it. Everything on this grid was
                      read-only before, so a wrong time could only be fixed
                      from a list on another page. */}
                  <button
                    type="button"
                    onClick={() => onOpen(e)}
                    className={cn(
                      'block max-w-full cursor-pointer truncate text-left text-sm transition-colors hover:text-accent',
                      done && 'text-text-3 line-through decoration-1',
                    )}
                  >
                    {e.title}
                  </button>
                  <div className="mt-0.5 text-xs text-text-3">
                    {[timeLabel(e) ?? 'All day', done ? 'Done' : null, e.detail]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-xs text-text-3">{KIND_LABEL[e.kind]}</span>
                  <button
                    type="button"
                    onClick={() => onDelete(e)}
                    aria-label={`Delete ${e.title}`}
                    title="Delete event"
                    className={cn(
                      'grid size-7 cursor-pointer place-items-center rounded-md border border-transparent text-text-3 hover:border-danger-border hover:bg-danger-soft hover:text-danger',
                      REVEAL_IN_ROW,
                    )}
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.9} aria-hidden />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-4 border-t border-hairline pt-3.5">
        <div className="mb-2 text-xs tracking-wide text-text-3 uppercase">
          Rest of {month.label}
        </div>

        {restOfMonth.length === 0 ? (
          <EmptyState
            className="py-6"
            icon={CalendarDays}
            title={
              isLastDay
                ? `${shortDate(selectedISO)} is the last day of the month`
                : `Nothing after ${shortDate(selectedISO)}`
            }
            description={
              isLastDay
                ? `Nothing sits after it. Page forward to plan into ${MONTH_LABELS[nextMonth.month - 1]}.`
                : `The rest of ${month.label} is clear. Anything you add after this day lands here.`
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {/* An "add" here has to land on a day this list would show,
                    or pressing it leaves the same empty state on screen.
                    On the last day of the month no such day exists, so the
                    honest offer is the next month rather than a new event. */}
                {isLastDay ? (
                  <Button size="sm" onClick={() => onGoTo(nextMonth)}>
                    <ChevronRight className="size-3.5" strokeWidth={2} aria-hidden />
                    Go to {MONTH_LABELS[nextMonth.month - 1]}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => onAdd(isoOf(month.year, month.month, selected + 1))}
                  >
                    <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                    Add event
                  </Button>
                )}
              </div>
            }
          />
        ) : (
          <ul className="space-y-1">
            {restOfMonth.slice(0, 4).map((e) => {
              const day = partsOf(e.date).d
              const mark = markOf(e)
              const done = mark === 'done'
              const start = startLabel(e)
              return (
                <li key={e.id}>
                  {/* Selects the day and names the item, so the row leads
                      somewhere rather than reporting that a date exists. */}
                  <button
                    type="button"
                    onClick={() => onSelectDay(day, e.id)}
                    title={`Go to ${month.label} ${day}`}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-left text-xs transition-colors hover:bg-row-hover"
                  >
                    <span
                      className={cn('size-1.5 shrink-0 rounded-full', DAY_DOT[mark])}
                      aria-hidden
                    />
                    {start ? <span className="tabular shrink-0 text-text-3">{start}</span> : null}
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-text-2',
                        done && 'text-text-3 line-through decoration-1',
                      )}
                    >
                      {e.title}
                    </span>
                    <span className="tabular shrink-0 font-mono text-xs text-text-3">
                      {month.label.slice(0, 3)} {day}
                    </span>
                  </button>
                </li>
              )
            })}
            {restOfMonth.length > 4 ? (
              <li className="px-1 pt-1 text-xs text-text-3">
                +{restOfMonth.length - 4} more later this month
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </Panel>
  )
}
