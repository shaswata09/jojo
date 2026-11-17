import { CalendarDays, ChevronRight, CircleCheck, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DAY_DOT, DAY_TEXT, startLabel } from '@/components/calendar/marks'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { stepMonth } from '@/data/calendar'
import type { CalendarMonth } from '@/data/calendar'
import { isoOf, partsOf, timeLabel } from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'
import { KIND_ICON, markOf } from '@/lib/timeline-visuals'
import { TODAY_PARTS } from '@/lib/today'
import { cn } from '@/lib/utils'
import { useDomain } from '@/i18n/domain'

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
  hiddenOnDay = 0,
  onShowAllKinds,
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
  /** Events on the selected day whose type the grid's legend has switched off. */
  hiddenOnDay?: number
  onShowAllKinds?: () => void
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
  const { t } = useTranslation('calendar')
  const domain = useDomain()
  const monthName = domain.month(month.month)
  // Beside a day number: «5 ноября», not «5 ноябрь».
  const monthOfDay = domain.monthOfDay(month.month)
  const todayMonth = t('rail.monthYear', {
    month: domain.month(TODAY_PARTS.month),
    year: TODAY_PARTS.year,
  })

  const isLastDay = selected === month.days
  const nextMonth = stepMonth(month.year, month.month, 1)

  return (
    <Panel className="min-w-0">
      <PanelTitle hint={domain.shortDate(selectedISO)}>
        {selected === month.today ? t('rail.today') : t('rail.selectedDay')}
      </PanelTitle>

      {/* A day whose every event is switched off is not an empty day. Saying
          "Nothing on 14 Oct" there would be the legend's choice presented as
          a fact about the calendar, so it says what is hidden and how to get
          it back instead. */}
      {events.length === 0 && hiddenOnDay > 0 ? (
        <EmptyState
          className="py-6"
          icon={CalendarDays}
          title={t('rail.hiddenTitle', { date: domain.shortDate(selectedISO) })}
          description={t('rail.hiddenDescription', { count: hiddenOnDay })}
          action={
            onShowAllKinds ? (
              <Button variant="outline" size="sm" onClick={onShowAllKinds}>
                {t('rail.showAllTypes')}
              </Button>
            ) : undefined
          }
        />
      ) : events.length === 0 ? (
        <EmptyState
          className="py-6"
          icon={CalendarDays}
          title={t('rail.emptyTitle', { date: domain.shortDate(selectedISO) })}
          description={t('rail.emptyDescription')}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => onAdd(selectedISO)}>
                <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                {t('rail.addEvent')}
              </Button>
              {/* An empty day in a month you paged to is the easiest place
                  to get lost: nothing on screen names where "now" is. */}
              {isCurrentMonth ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onGoTo({ year: TODAY_PARTS.year, month: TODAY_PARTS.month })}
                >
                  {t('rail.backTo', { month: todayMonth })}
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
                    dir="auto"
                    onClick={() => onOpen(e)}
                    className={cn(
                      'block max-w-full cursor-pointer truncate text-start text-sm transition-colors hover:text-accent',
                      done && 'text-text-3 line-through decoration-1',
                    )}
                  >
                    {e.title}
                  </button>
                  <div className="mt-0.5 text-xs text-text-3">
                    {[
                      timeLabel(e) ?? t('chip.allDay'),
                      done ? t('grid.marks.done') : null,
                      e.detail,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-xs text-text-3">{domain.kind(e.kind)}</span>
                  <button
                    type="button"
                    onClick={() => onDelete(e)}
                    aria-label={t('rail.deleteNamed', { title: e.title })}
                    title={t('rail.delete')}
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
          {t('rail.restOf', { month: monthName })}
        </div>

        {restOfMonth.length === 0 ? (
          <EmptyState
            className="py-6"
            icon={CalendarDays}
            title={
              isLastDay
                ? t('rail.lastDayTitle', { date: domain.shortDate(selectedISO) })
                : t('rail.nothingAfterTitle', { date: domain.shortDate(selectedISO) })
            }
            description={
              isLastDay
                ? t('rail.lastDayDescription', { month: domain.month(nextMonth.month) })
                : t('rail.nothingAfterDescription', { month: monthName })
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {/* An "add" here has to land on a day this list would show,
                    or pressing it leaves the same empty state on screen.
                    On the last day of the month no such day exists, so the
                    honest offer is the next month rather than a new event. */}
                {isLastDay ? (
                  <Button size="sm" onClick={() => onGoTo(nextMonth)}>
                    <ChevronRight
                      className="size-3.5 rtl:-scale-x-100"
                      strokeWidth={2}
                      aria-hidden
                    />
                    {t('rail.goToMonth', { month: domain.month(nextMonth.month) })}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => onAdd(isoOf(month.year, month.month, selected + 1))}
                  >
                    <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                    {t('rail.addEvent')}
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
                    title={t('rail.goToDay', {
                      label: t('grid.dayLabel', { month: monthOfDay, day }),
                    })}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-start text-xs transition-colors hover:bg-row-hover"
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
                      {t('rail.shortDay', { month: domain.monthShort(month.month), day })}
                    </span>
                  </button>
                </li>
              )
            })}
            {restOfMonth.length > 4 ? (
              <li className="px-1 pt-1 text-xs text-text-3">
                {t('rail.moreLater', { count: restOfMonth.length - 4 })}
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </Panel>
  )
}
