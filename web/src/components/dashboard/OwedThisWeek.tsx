import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CalendarCheck, CalendarClock, Check, Mail, Plus } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { addDays, partsOf, shortDate, timeLabel, whenLabel } from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'
import { useTimeline } from '@/kg/react/use-timeline'
import { useDialogs } from '@/lib/dialogs-context'
import { calendarPath } from '@/lib/links'
import { KIND_ICON, MARK_DOT, MARK_TEXT, dateMark } from '@/lib/timeline-visuals'
import { useToast } from '@/lib/toast-context'
import { TODAY } from '@/lib/today'
import { cn } from '@/lib/utils'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** How many of the items beyond the week the "Later" strip names. */
const LATER_SHOWN = 4

const TOMORROW = addDays(TODAY, 1)
const WEEK_END = addDays(TODAY, 6)

const menuItem =
  'flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1.5 text-xs text-text-2 transition-colors hover:bg-well hover:text-text-1'

const SNOOZE_STEPS = [
  { days: 1, label: 'A day' },
  { days: 3, label: 'Three days' },
  { days: 7, label: 'A week' },
]

const anchorOf = (item: TimelineItem) => (item.date < TODAY ? TODAY : item.date)

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

/** Splits an ISO date into the params the calendar route reads. */
const dayParams = (iso: string) => {
  const { y, m, d } = partsOf(iso)
  return { y, m, d }
}

/** Three fixed steps, each printing the date it is about to write. */
function SnoozeMenu({ item, onPush }: { item: TimelineItem; onPush: (by: number) => void }) {
  // Controlled, because the steps are plain buttons: an uncontrolled popover
  // would stay open over a row that has already moved out from under it.
  const [open, setOpen] = useState(false)
  const anchor = anchorOf(item)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        title={`Push "${item.title}" out`}
        aria-label={`Snooze ${item.title}`}
        className={cn(
          'grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-text-3',
          'transition-colors hover:bg-well hover:text-text-1',
          'data-[state=open]:bg-well data-[state=open]:text-text-1',
        )}
      >
        <CalendarClock className="size-3.5" strokeWidth={1.8} aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 gap-1 p-1.5">
        <div className="px-1 pb-0.5 text-xs tracking-wide text-text-3 uppercase">Push out by</div>
        {SNOOZE_STEPS.map((step) => (
          <button
            key={step.days}
            type="button"
            className={menuItem}
            onClick={() => {
              setOpen(false)
              onPush(step.days)
            }}
          >
            <span className="flex-1 text-left">{step.label}</span>
            <span className="font-mono text-text-3">{shortDate(addDays(anchor, step.days))}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Everything you owe, overdue first, in one panel.
 *
 * It was two: "This week", which started at today and so could not show a
 * single overdue thing, and "Follow-ups due", which showed the overdue chases
 * and nothing else. The same three rows were then counted by the sidebar badge,
 * a glance counter and both panels, and the one group a job-seeker opens the
 * app for — the work that is already late — had no home on the week's list.
 *
 * Groups are computed from the date on every render, so ticking, snoozing or
 * rescheduling anywhere in the app moves a row between them on its own.
 */
export function OwedThisWeek() {
  const { all, toggleDone, update, snooze, reschedule } = useTimeline()
  const { open } = useDialogs()
  const { toast } = useToast()

  // Built from TODAY rather than a written-out week, so the strip cannot
  // disagree with the dates beside it.
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const iso = addDays(TODAY, i)
        const { y, m, d } = partsOf(iso)
        return { iso, day: d, label: WEEKDAY_LABELS[new Date(y, m - 1, d).getDay()] }
      }),
    [],
  )

  const { groups, later, doneToday, overdueCount, dueCount } = useMemo(() => {
    const openItems = all.filter((i) => !i.completedOn)
    const overdue = openItems.filter((i) => i.date < TODAY)
    const today = openItems.filter((i) => i.date === TODAY)
    const tomorrow = openItems.filter((i) => i.date === TOMORROW)
    const rest = openItems.filter((i) => i.date > TOMORROW && i.date <= WEEK_END)

    return {
      groups: [
        { id: 'overdue', label: 'Overdue', items: overdue },
        { id: 'today', label: 'Today', items: today },
        { id: 'tomorrow', label: 'Tomorrow', items: tomorrow },
        { id: 'rest', label: 'Rest of the week', items: rest },
      ],
      later: openItems.filter((i) => i.date > WEEK_END),
      doneToday: all.filter((i) => i.completedOn === TODAY).length,
      overdueCount: overdue.length,
      dueCount: today.length + tomorrow.length + rest.length,
    }
  }, [all])

  const edit = (item: TimelineItem) =>
    open('timelineItem', { mode: item.remind ? 'reminder' : 'event', initial: item })

  const newEvent = () => open('timelineItem', { mode: 'event', initial: { date: TODAY } })

  /**
   * Ticking always removes the row — every group here filters out completed
   * items. A row that vanishes under the pointer has to leave something to
   * press, and the undo writes `completedOn` back rather than toggling again:
   * by the time it is pressed the user may have unticked it in the Vault, and a
   * second toggle would re-tick it.
   */
  const complete = (item: TimelineItem) => {
    toggleDone(item.id)
    toast({
      title: `${item.title} completed`,
      description: 'It leaves this list and counts towards today — nothing is deleted.',
      action: { label: 'Undo', onClick: () => update(item.id, { completedOn: null }) },
    })
  }

  const push = (item: TimelineItem, by: number) => {
    const before = item.date
    snooze(item.id, by)
    toast({
      title: `${item.title} rescheduled`,
      description: `Now due ${shortDate(addDays(anchorOf(item), by))}, here and on the calendar.`,
      // The date it came from is the one thing a second snooze cannot recover.
      action: { label: 'Undo', onClick: () => reschedule(item.id, before) },
    })
  }

  const hint = overdueCount > 0 ? `${overdueCount} overdue · ${dueCount} due` : `${dueCount} due`

  return (
    <Panel className="flex min-w-0 flex-col">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="mb-0" hint={all.length > 0 ? hint : undefined}>
          Owed this week
        </PanelTitle>
        <Button variant="outline" size="sm" onClick={newEvent}>
          <Plus className="size-3.5" strokeWidth={2} aria-hidden />
          Add
        </Button>
      </div>

      {all.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="Nothing is owed"
          description="Deadlines, interviews and follow-ups land here as soon as they have a date, and stay until you tick them off."
          action={
            <Button size="sm" onClick={newEvent}>
              <Plus className="size-3.5" strokeWidth={2} aria-hidden />
              Add an event
            </Button>
          }
        />
      ) : (
        <>
          {/* Day strip: the shape of the week before reading any detail. */}
          <ol className="mb-4 grid grid-cols-7 gap-1" aria-label="Next seven days">
            {days.map((day, i) => {
              const events = all.filter((e) => !e.completedOn && e.date === day.iso)
              const cleared = all.filter((e) => e.completedOn === day.iso).length
              const isToday = i === 0
              return (
                <li
                  key={day.iso}
                  className={cn(
                    'rounded-md border px-1 py-1.5 text-center',
                    isToday ? 'border-accent-border bg-accent-soft' : 'border-hairline bg-well',
                  )}
                >
                  <div className={cn('text-xs uppercase', isToday ? 'text-accent' : 'text-text-3')}>
                    {day.label}
                  </div>
                  <div
                    className={cn(
                      'text-base font-semibold',
                      isToday ? 'text-accent' : 'text-text-2',
                    )}
                  >
                    {day.day}
                  </div>
                  {/* Fixed-height rail so day cells stay aligned whether or not
                      they have events. */}
                  <div className="mt-1 flex h-1 items-center justify-center gap-0.5">
                    {events.map((e) => (
                      <span
                        key={e.id}
                        className={cn('size-1 rounded-full', MARK_DOT[dateMark(e.date)])}
                        aria-hidden
                      />
                    ))}
                  </div>
                  {/* A day you have cleared is not a day with nothing on it, and
                      reading "nothing scheduled" after ticking four things off
                      is the one thing that makes a screen reader user check. */}
                  <span className="sr-only">
                    {events.length > 0
                      ? plural(events.length, 'item')
                      : cleared > 0
                        ? 'all done'
                        : 'nothing scheduled'}
                  </span>
                </li>
              )
            })}
          </ol>

          {/* Capped and scrolled so the group headings can stick: with thirteen
              rows the panel otherwise runs past the fold and you lose track of
              which group you are reading.

              The negative margins pull the scroll box out to the card's own
              edges so the scrollbar rides the edge rather than floating a
              padding's width inside it — the same treatment `PanelScroll`
              applies everywhere else. The padding is added straight back on the
              inside, so the rows keep their inset and only the scrollbar moves. */}
          <div className="relative lg:min-h-0 lg:flex-1">
            <div className="-mx-4 -mb-4 max-h-[30rem] overflow-x-hidden overflow-y-auto px-4 pb-4 sm:-mx-5 sm:-mb-5 sm:px-5 sm:pb-5 lg:absolute lg:inset-0 lg:mx-0 lg:mb-0 lg:max-h-none lg:px-4 lg:pb-4 xl:px-5 xl:pb-5">
              {groups.map((group) => {
                // Today is the only group that renders empty. It is the question
                // the page exists to answer, and "clear" is an answer.
                if (group.items.length === 0 && group.id !== 'today') return null

                return (
                  <section key={group.id}>
                    <h3 className="sticky top-0 z-10 flex items-baseline justify-between gap-2 bg-panel py-1.5 text-xs tracking-wide text-text-3 uppercase">
                      {group.label}
                      {group.items.length > 0 ? (
                        <span className="tabular font-normal">{group.items.length}</span>
                      ) : null}
                    </h3>

                    {group.items.length === 0 ? (
                      <p className="pb-2.5 text-sm text-text-2">
                        Today is clear{doneToday > 0 ? ` — ${doneToday} done` : ''}.
                      </p>
                    ) : (
                      <ul className="divide-y divide-hairline">
                        {group.items.map((e) => {
                          const Icon = KIND_ICON[e.kind]
                          const mark = dateMark(e.date)
                          return (
                            <li key={e.id} className="flex items-start gap-2.5 py-2.5">
                              {/* A real checkbox role, so the state is announced
                                and Space works. It sits before the icon rather
                                than replacing it — the kind is what tells you
                                whether ticking it off is a two-minute job or a
                                submitted application. */}
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={false}
                                aria-label={`Mark "${e.title}" done`}
                                title="Mark done"
                                onClick={() => complete(e)}
                                // `touch-target`: 18px is below every size
                                // class the coarse-pointer rule matches on.
                                className="touch-target mt-0.5 grid size-[18px] shrink-0 cursor-pointer place-items-center rounded-sm border border-hairline-strong text-transparent transition-colors hover:border-accent-border hover:text-accent"
                              >
                                <Check className="size-3" strokeWidth={2.5} aria-hidden />
                              </button>

                              <Icon
                                className={cn('mt-0.5 size-4 shrink-0', MARK_TEXT[mark])}
                                strokeWidth={1.7}
                                aria-hidden
                              />

                              <div className="min-w-0 flex-1">
                                {/* The title opens the item. A row you can tick
                                  but not correct is where every wrong date on a
                                  dashboard starts. */}
                                <button
                                  type="button"
                                  onClick={() => edit(e)}
                                  className="block max-w-full cursor-pointer truncate text-left text-sm transition-colors hover:text-accent"
                                >
                                  {e.title}
                                </button>
                                <div className="mt-0.5 truncate text-xs text-text-3">
                                  {timeLabel(e) ? `${timeLabel(e)} · ` : ''}
                                  {e.detail ?? e.note}
                                </div>
                              </div>

                              <span
                                className={cn(
                                  'mt-0.5 shrink-0 text-xs font-medium whitespace-nowrap',
                                  MARK_TEXT[mark],
                                )}
                              >
                                {whenLabel(e, TODAY)}
                              </span>

                              {/* Drafting stays on follow-up rows only — it is
                                what the deleted Follow-ups panel existed for,
                                and it makes no sense against a campus visit.
                                The dialog needs no model: it starts from the
                                user's own email snippets. */}
                              {e.kind === 'follow-up' ? (
                                <button
                                  type="button"
                                  onClick={() => open('draft', { itemId: e.id })}
                                  title="Write this from one of your email snippets"
                                  aria-label={`Draft ${e.title}`}
                                  className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-text-3 transition-colors hover:bg-well hover:text-text-1"
                                >
                                  <Mail className="size-3.5" strokeWidth={1.8} aria-hidden />
                                </button>
                              ) : null}

                              <SnoozeMenu item={e} onPush={(by) => push(e, by)} />
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </section>
                )
              })}
            </div>
          </div>

          {later.length > 0 ? (
            <div className="mt-4 border-t border-hairline pt-3.5">
              <div className="mb-2 text-xs tracking-wide text-text-3 uppercase">Later</div>
              {/* Capped: the timeline runs weeks past the strip, and a chip per
                  item turned a footnote into the tallest part of the panel. */}
              <ul className="flex flex-wrap gap-2">
                {later.slice(0, LATER_SHOWN).map((e) => (
                  <li key={e.id}>
                    {/* A chip that opens the item, rather than one that names
                        something and leaves you to find it on the calendar. */}
                    <button
                      type="button"
                      onClick={() => edit(e)}
                      className="cursor-pointer rounded-sm"
                      title={`Open ${e.title}`}
                    >
                      <Chip tone="gray" className="gap-1.5 hover:border-accent-border">
                        {e.title}
                        <span className="text-text-3">· {shortDate(e.date)}</span>
                      </Chip>
                    </button>
                  </li>
                ))}
                {later.length > LATER_SHOWN ? (
                  <li>
                    {/* Was a <span>: a count of things you cannot reach. It now
                        opens the calendar on the day the first hidden one falls,
                        which is where the rest of them are. */}
                    <Link
                      to={calendarPath(dayParams(later[LATER_SHOWN].date))}
                      className="rounded-sm"
                    >
                      <Chip tone="gray" className="hover:border-accent-border">
                        {later.length - LATER_SHOWN} more on the calendar
                      </Chip>
                    </Link>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  )
}
