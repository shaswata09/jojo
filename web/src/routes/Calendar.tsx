import { useMemo, useState } from 'react'
import {
  CalendarClock,
  CalendarSearch,
  ChevronLeft,
  ChevronRight,
  FileText,
  Plane,
  Users,
  Video,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { AllHidden, ChartLegend } from '@/components/charts/ChartLegend'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import {
  EVENT_YEAR,
  MONTH_LABELS,
  TODAY,
  WEEKDAYS,
  buildMonth,
  calendarEvents,
  stepMonth,
} from '@/data/calendar'
import type { EventKind, Urgency } from '@/data/seed'
import { useSeriesToggle } from '@/lib/use-series-toggle'
import { cn } from '@/lib/utils'

const kindIcon: Record<EventKind, LucideIcon> = {
  deadline: CalendarClock,
  interview: Video,
  visit: Plane,
  call: Users,
  prep: FileText,
}

/** Derived from the icon map, so a new kind cannot be missed by the legend. */
const EVENT_KINDS = Object.keys(kindIcon) as EventKind[]

const kindLabel: Record<EventKind, string> = {
  deadline: 'Deadline',
  interview: 'Interview',
  visit: 'Visit',
  call: 'Call',
  prep: 'Prep',
}

const dot: Record<Urgency, string> = {
  red: 'bg-danger',
  amber: 'bg-warning',
  gray: 'bg-text-3',
}

const text: Record<Urgency, string> = {
  red: 'text-danger',
  amber: 'text-warning',
  gray: 'text-text-3',
}

/**
 * Jump straight to a month.
 *
 * Stepping a year at a time and picking from twelve is faster than clicking an
 * arrow twelve times, which was the only route to next March before this.
 * Its own year state, so browsing forward in the picker does not move the
 * calendar behind it until a month is actually chosen.
 */
function MonthPicker({
  year,
  month,
  onPick,
}: {
  year: number
  month: number
  onPick: (next: { year: number; month: number }) => void
}) {
  const [open, setOpen] = useState(false)
  const [draftYear, setDraftYear] = useState(year)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Reopening should start from where the calendar actually is, not from
        // wherever the last browse left off.
        if (next) setDraftYear(year)
      }}
    >
      <PopoverTrigger
        aria-label="Go to month"
        title="Go to month"
        className="flex cursor-pointer items-center gap-1.5 rounded-full border border-hairline bg-well px-2.5 py-1 text-xs text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1 data-[state=open]:border-accent-border data-[state=open]:bg-accent-soft data-[state=open]:text-accent"
      >
        <CalendarSearch className="size-3.5" strokeWidth={1.8} aria-hidden />
        Go to month
      </PopoverTrigger>

      <PopoverContent align="start" className="w-60">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setDraftYear((y) => y - 1)}
            aria-label="Previous year"
            className="grid size-6 cursor-pointer place-items-center rounded-sm text-text-3 hover:bg-well hover:text-text-1"
          >
            <ChevronLeft className="size-3.5" strokeWidth={2} aria-hidden />
          </button>
          <span className="tabular text-sm font-medium">{draftYear}</span>
          <button
            type="button"
            onClick={() => setDraftYear((y) => y + 1)}
            aria-label="Next year"
            className="grid size-6 cursor-pointer place-items-center rounded-sm text-text-3 hover:bg-well hover:text-text-1"
          >
            <ChevronRight className="size-3.5" strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1">
          {MONTH_LABELS.map((label, i) => {
            const m = i + 1
            const isCurrent = draftYear === year && m === month
            const isToday = draftYear === TODAY.year && m === TODAY.month
            return (
              <button
                key={label}
                type="button"
                onClick={() => {
                  onPick({ year: draftYear, month: m })
                  setOpen(false)
                }}
                aria-current={isCurrent ? 'date' : undefined}
                className={cn(
                  'cursor-pointer rounded-sm px-1 py-1.5 text-xs transition-colors',
                  isCurrent
                    ? 'bg-accent font-medium text-[color:var(--accent-fg)]'
                    : 'text-text-2 hover:bg-well hover:text-text-1',
                  // A quiet mark on the real current month, so the picker says
                  // where "today" is even while browsing another year.
                  !isCurrent && isToday && 'font-medium text-accent',
                )}
              >
                {label.slice(0, 3)}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function Calendar() {
  // A year/month pair rather than an index into a two-item array: the arrows
  // used to disable at October and November because those were the only months
  // that existed. Months are built on demand now, so both directions run
  // without a stop.
  // Annotated: TODAY is `as const`, so an inferred state type would be the
  // literal {year: 2026, month: 10} and every step would fail to assign.
  const [view, setView] = useState<{ year: number; month: number }>({
    year: TODAY.year,
    month: TODAY.month,
  })
  // Page options, both wired straight into the grid below.
  const [dotsOnly, setDotsOnly] = useState(false)
  const [tallCells, setTallCells] = useState(true)
  // Legend toggles, same hook the charts use — a kind switched off disappears
  // from the grid and from the selected-day list together.
  const kindToggle = useSeriesToggle(EVENT_KINDS)
  const month = useMemo(() => buildMonth(view.year, view.month), [view])
  const [selected, setSelected] = useState<number | null>(TODAY.day)

  const eventsFor = useMemo(() => {
    const map = new Map<number, typeof calendarEvents>()
    // The seeded events carry a month but no year, so the year is checked
    // separately — otherwise October 2027 would list October 2026's deadlines.
    const inView =
      view.year === EVENT_YEAR
        ? calendarEvents.filter((e) => e.month === view.month && !kindToggle.isHidden(e.kind))
        : []
    for (const e of inView) {
      map.set(e.day, [...(map.get(e.day) ?? []), e])
    }
    return map
  }, [view, kindToggle])

  // Leading blanks so the 1st lands on its weekday, then the days themselves.
  const cells = [
    ...Array.from({ length: month.startsOn }, () => null),
    ...Array.from({ length: month.days }, (_, i) => i + 1),
  ]

  /** Keeps the day you were looking at, clamped; snaps to today on the way home. */
  const goTo = (next: { year: number; month: number }) => {
    setView(next)
    setSelected((day) =>
      next.year === TODAY.year && next.month === TODAY.month
        ? TODAY.day
        : Math.min(day ?? 1, buildMonth(next.year, next.month).days),
    )
  }

  const isCurrentMonth = view.year === TODAY.year && view.month === TODAY.month

  const selectedEvents = selected === null ? [] : (eventsFor.get(selected) ?? [])

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Deadlines, interviews and prep in one view"
        settings={
          <>
            <PageOption
              label="Dots instead of titles"
              hint="Denser month grid, detail on the day you select"
              control={
                <Switch
                  checked={dotsOnly}
                  onCheckedChange={setDotsOnly}
                  aria-label="Dots instead of titles"
                />
              }
            />
            <PageOption
              label="Tall day cells"
              hint="More room per day in the grid"
              control={
                <Switch
                  checked={tallCells}
                  onCheckedChange={setTallCells}
                  aria-label="Tall day cells"
                />
              }
            />
          </>
        }
        actions={
          <Button size="sm">
            <span className="mr-1">+</span> Add event
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Panel className="min-w-0">
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-base font-medium">
              {month.label} <span className="text-text-3">{month.year}</span>
            </h2>
            <MonthPicker year={view.year} month={view.month} onPick={goTo} />

            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => goTo(stepMonth(view.year, view.month, -1))}
                aria-label="Previous month"
                className="grid size-7 cursor-pointer place-items-center rounded-full border border-hairline bg-well text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1"
              >
                <ChevronLeft className="size-4" strokeWidth={1.8} />
              </button>

              {/* Doubles as a state read: filled while you are on the current
                  month, hollow once you have paged away from it. */}
              <button
                type="button"
                onClick={() => goTo({ year: TODAY.year, month: TODAY.month })}
                aria-label="Go to current month"
                aria-current={isCurrentMonth ? 'date' : undefined}
                title="Go to current month"
                className="grid size-7 cursor-pointer place-items-center rounded-full border border-hairline bg-well transition-colors hover:border-hairline-strong"
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
                className="grid size-7 cursor-pointer place-items-center rounded-full border border-hairline bg-well text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1"
              >
                <ChevronRight className="size-4" strokeWidth={1.8} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1" role="presentation">
            {WEEKDAYS.map((d) => (
              <div key={d} className="pb-1 text-center text-xs text-text-3 uppercase">
                {d.slice(0, 1)}
                <span className="hidden sm:inline">{d.slice(1)}</span>
              </div>
            ))}

            {cells.map((day, i) => {
              if (day === null) return <div key={`blank-${i}`} aria-hidden />

              const dayEvents = eventsFor.get(day) ?? []
              const isToday = day === month.today
              const isSelected = day === selected

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setSelected(day)}
                  aria-pressed={isSelected}
                  aria-label={`${month.label} ${day}, ${dayEvents.length} events`}
                  className={cn(
                    // flex-col, not the default: a <button> centres its content
                    // vertically, so a cell holding two event chips pushed its
                    // date to the top while an empty cell centred the lone
                    // number and dropped it ~8px lower. A column flex container
                    // stacks from the top, which fixes the date to the corner
                    // whether or not the day has anything on it. `items-stretch`
                    // (the default) is load-bearing — items-start would shrink
                    // the event rows to their content and break their truncate.
                    'flex flex-col rounded-md border p-1.5 text-left transition-colors',
                    tallCells ? 'min-h-[56px] sm:min-h-[76px]' : 'min-h-[38px] sm:min-h-[48px]',
                    isSelected
                      ? 'border-accent-border bg-accent-soft'
                      : 'border-hairline bg-well hover:border-hairline-strong',
                  )}
                >
                  {/* `grid`, not `inline-grid`: an inline box sits on the line
                      box's baseline, which was adding ~20px of leading above it
                      and pushing the date away from the corner. Block-level, it
                      starts at the top-left of the cell's content box.

                      The colour is --accent-fg. It was --primary-foreground,
                      which is not a variable this project defines — the theme
                      maps --color-primary-foreground, and Tailwind inlines that
                      into its own utilities rather than emitting the shorter
                      name. The declaration was therefore invalid, the digit
                      inherited its colour, and today rendered as a white glyph
                      on a white circle. */}
                  <span
                    className={cn(
                      'grid size-5 place-items-center rounded-full text-xs font-medium',
                      isToday ? 'bg-accent text-[color:var(--accent-fg)]' : 'text-text-2',
                    )}
                  >
                    {day}
                  </span>

                  {/* Dots on phones where chips can't fit; titles from sm up —
                      unless the reader has asked for dots everywhere. */}
                  <div className={cn('mt-1 flex gap-0.5', !dotsOnly && 'sm:hidden')}>
                    {dayEvents.slice(0, 3).map((e) => (
                      <span
                        key={e.id}
                        aria-hidden
                        className={cn('size-1 rounded-full', dot[e.urgency])}
                      />
                    ))}
                  </div>

                  <div className={cn('mt-1 hidden flex-col gap-0.5', !dotsOnly && 'sm:flex')}>
                    {dayEvents.slice(0, 2).map((e) => (
                      <span
                        key={e.id}
                        className={cn(
                          'truncate rounded-sm px-1 py-px text-xs',
                          e.urgency === 'red'
                            ? 'bg-danger-soft text-danger'
                            : e.urgency === 'amber'
                              ? 'bg-warning-soft text-warning'
                              : 'bg-well text-text-2',
                        )}
                      >
                        {e.title}
                      </span>
                    ))}
                    {dayEvents.length > 2 ? (
                      <span className="px-1 text-xs text-text-3">+{dayEvents.length - 2} more</span>
                    ) : null}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Each kind toggles, exactly as a chart series does. */}
          <div className="mt-4 border-t border-hairline pt-3.5">
            <ChartLegend
              items={EVENT_KINDS.map((k) => ({
                key: k,
                label: kindLabel[k],
                icon: kindIcon[k],
              }))}
              isHidden={kindToggle.isHidden}
              onToggle={kindToggle.toggle}
              className="gap-x-4"
            />
          </div>
        </Panel>

        <Panel className="min-w-0">
          <PanelTitle hint={selected === null ? undefined : `${month.label} ${selected}`}>
            {selected === month.today ? 'Today' : 'Selected day'}
          </PanelTitle>

          {kindToggle.allHidden ? (
            <AllHidden className="py-6" />
          ) : selectedEvents.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-3">Nothing scheduled.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {selectedEvents.map((e) => {
                const Icon = kindIcon[e.kind]
                return (
                  <li key={e.id} className="flex items-start gap-3 py-3">
                    <Icon
                      className={cn('mt-0.5 size-4 shrink-0', text[e.urgency])}
                      strokeWidth={1.7}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{e.title}</div>
                      <div className="mt-0.5 text-xs text-text-3">{e.detail}</div>
                    </div>
                    <span className="shrink-0 text-xs text-text-3">{kindLabel[e.kind]}</span>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="mt-4 border-t border-hairline pt-3.5">
            <div className="mb-2 text-xs tracking-wide text-text-3 uppercase">
              Rest of {month.label}
            </div>
            <ul className="space-y-2">
              {calendarEvents
                // Honours the legend too — the toggle governs the page, not
                // just the grid, or this list would keep listing kinds the
                // reader has just switched off.
                .filter(
                  (e) =>
                    e.month === month.month &&
                    !kindToggle.isHidden(e.kind) &&
                    (selected === null || e.day > selected),
                )
                .slice(0, 4)
                .map((e) => (
                  <li key={e.id} className="flex items-center gap-2.5 text-xs">
                    <span
                      className={cn('size-1.5 shrink-0 rounded-full', dot[e.urgency])}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-text-2">{e.title}</span>
                    <span className="shrink-0 font-mono text-xs text-text-3">
                      {month.label.slice(0, 3)} {e.day}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        </Panel>
      </div>
    </>
  )
}
