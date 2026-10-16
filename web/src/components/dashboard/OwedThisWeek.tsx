import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  Briefcase,
  CalendarCheck,
  CalendarClock,
  Check,
  Mail,
  PencilLine,
  Plus,
} from 'lucide-react'
import { displayName } from '@jojo/service/core/model'
import { useApplications } from '@jojo/service/react/use-applications'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { SnoozeSteps } from '@/components/common/SnoozeSteps'
import { snoozeAnchor } from '@/components/common/snooze'
import { plural } from '@/components/common/text'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { addDays, partsOf, shortDate, timeLabel, whenLabel } from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { useDialogs } from '@/lib/dialogs-context'
import { appPath, calendarPath } from '@/lib/links'
import { KIND_ICON, MARK_DOT, MARK_TEXT, dateMark } from '@/lib/timeline-visuals'
import { useToast } from '@/lib/toast-context'
import { TODAY } from '@/lib/today'
import { cn } from '@/lib/utils'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** How many of the items beyond the week the "Later" strip names. */
const LATER_SHOWN = 4

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
        {/* `duration`, not `dated`: the heading above already says these are
            offsets, and an offset is measured from the anchor whatever the
            anchor is — so unlike the reminders list this menu cannot name a day
            the write will not produce. */}
        <SnoozeSteps
          date={item.date}
          spell="duration"
          onPick={(days) => {
            setOpen(false)
            onPush(days)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * What opening an owed item means, asked rather than assumed.
 *
 * The title used to open the edit dialog and nothing else. But a reminder to
 * chase Rice is mostly a way back INTO the Rice application — the place the
 * email thread, the documents and the contacts are — and correcting the
 * reminder itself is the rarer of the two. So an item filed under an
 * application offers both, one press each; an item filed under nothing has
 * only one thing to open and opens it straight away, because a menu with one
 * entry is a click that asks nothing.
 *
 * One entry per application: a reference deadline can cover three.
 */
function OpenItemMenu({
  item,
  onEdit,
  className,
  title,
  children,
}: {
  item: TimelineItem
  onEdit: () => void
  className: string
  title?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { byId } = useApplications()
  // Ids a deleted application left behind are skipped — D15 unlinks, but a
  // stale render can still hold one for a moment.
  const applications = item.applicationIds.flatMap((id) => {
    const a = byId.get(id)
    return a ? [a] : []
  })

  if (applications.length === 0) {
    return (
      <button type="button" onClick={onEdit} className={className} title={title}>
        {children}
      </button>
    )
  }

  const noun = item.remind ? 'reminder' : 'event'
  const option =
    'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-text-1 transition-colors hover:bg-well focus-visible:bg-well focus-visible:outline-none'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={className}
        title={title}
        aria-label={`Open ${item.title}: edit the ${noun} or go to its application`}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-0.5 p-1.5">
        <button
          type="button"
          className={option}
          onClick={() => {
            setOpen(false)
            onEdit()
          }}
        >
          <PencilLine className="size-3.5 shrink-0 text-text-3" strokeWidth={1.8} aria-hidden />
          Edit {noun}
        </button>
        {applications.map((a) => (
          <button
            key={a.id}
            type="button"
            className={option}
            onClick={() => {
              setOpen(false)
              void navigate(appPath(a))
            }}
          >
            <Briefcase className="size-3.5 shrink-0 text-text-3" strokeWidth={1.8} aria-hidden />
            <span className="min-w-0 truncate">
              Open <span className="text-text-2">{displayName(a)}</span>
            </span>
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

  /*
   * The pin, sampled once per render and then used everywhere below.
   *
   * `TODAY` is a live ESM binding — `@/lib/today` reassigns it at the local
   * midnight — so the two things this panel used to do with it were both a day
   * out on an overnight session. Measured with fake timers from 23:50, twenty
   * minutes advanced: the pin said the 13th, the module-level `TOMORROW` and
   * `WEEK_END` consts still said the 13th and the 18th off the 12th, and the
   * day strip's `useMemo([])` still opened on the 12th with yesterday's cell
   * lit as today. Every "today" on this panel then disagreed with the day the
   * store was about to write.
   *
   * Naming it as a local is also what lets it be a dependency: an outer-scope
   * binding is not a valid one (mutating it does not re-render), and the honest
   * statement is that this render read this day.
   */
  const today = TODAY

  // Built from the pin rather than a written-out week, so the strip cannot
  // disagree with the dates beside it.
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const iso = addDays(today, i)
        const { y, m, d } = partsOf(iso)
        return { iso, day: d, label: WEEKDAY_LABELS[new Date(y, m - 1, d).getDay()] }
      }),
    [today],
  )

  const { groups, later, doneToday, overdueCount, dueCount } = useMemo(() => {
    // Derived here rather than at module scope, for the reason above.
    const tomorrowISO = addDays(today, 1)
    const weekEnd = addDays(today, 6)

    const openItems = all.filter((i) => !i.completedOn)
    const overdue = openItems.filter((i) => i.date < today)
    const dueToday = openItems.filter((i) => i.date === today)
    const tomorrow = openItems.filter((i) => i.date === tomorrowISO)
    const rest = openItems.filter((i) => i.date > tomorrowISO && i.date <= weekEnd)

    return {
      groups: [
        { id: 'overdue', label: 'Overdue', items: overdue },
        { id: 'today', label: 'Today', items: dueToday },
        { id: 'tomorrow', label: 'Tomorrow', items: tomorrow },
        { id: 'rest', label: 'Rest of the week', items: rest },
      ],
      later: openItems.filter((i) => i.date > weekEnd),
      doneToday: all.filter((i) => i.completedOn === today).length,
      overdueCount: overdue.length,
      dueCount: dueToday.length + tomorrow.length + rest.length,
    }
  }, [all, today])

  const edit = (item: TimelineItem) =>
    open('timelineItem', { mode: item.remind ? 'reminder' : 'event', initial: item })

  const newEvent = () => open('timelineItem', { mode: 'event', initial: { date: today } })

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
      description: `Now due ${shortDate(addDays(snoozeAnchor(item.date), by))}, here and on the calendar.`,
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
              inside, so the rows keep their inset and only the scrollbar moves.

              From `lg` the box goes `absolute` to fill the column, and that
              override used to reset the bleed to zero (`lg:inset-0 lg:mx-0`)
              while keeping the re-added padding — so on exactly the screens
              this panel is laid out for, the scrollbar stood 20px in from the
              edge (measured) and the rows sat 20px deeper than the title and
              the "Later" heading below them. `-inset-x-5` is the same bleed in
              the absolute layout, matched to the panel's 20px padding there. */}
          <div className="relative lg:min-h-0 lg:flex-1">
            <div className="-mx-4 -mb-4 max-h-[30rem] overflow-x-hidden overflow-y-auto px-4 pb-4 sm:-mx-5 sm:-mb-5 sm:px-5 sm:pb-5 lg:absolute lg:-inset-x-5 lg:inset-y-0 lg:mx-0 lg:mb-0 lg:max-h-none lg:px-5 lg:pb-4 xl:pb-5">
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
                                {/* The title opens the item — or, when it is
                                  filed under an application, asks which to
                                  open (`OpenItemMenu`). A row you can tick but
                                  not correct is where every wrong date on a
                                  dashboard starts. */}
                                <OpenItemMenu
                                  item={e}
                                  onEdit={() => edit(e)}
                                  /* `hover:underline` as well as the colour:
                                     in dark, --accent and --text-1 are the
                                     same #fafafa (see index.css), so the title
                                     of an owed item gave no sign it opened
                                     anything. The tick beside it survived on
                                     its border change. */
                                  className="block max-w-full cursor-pointer truncate text-left text-sm underline-offset-2 transition-colors hover:text-accent hover:underline data-[state=open]:text-accent data-[state=open]:underline"
                                >
                                  {e.title}
                                </OpenItemMenu>
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
                                {whenLabel(e, today)}
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
                  /*
                   * `min-w-0 max-w-full` down the chain, and the title truncates.
                   *
                   * A `Chip` is `whitespace-nowrap` by design — it is a one-line
                   * label — and nothing here capped its width, so a long title
                   * made the chip wider than the panel. `flex-wrap` cannot save
                   * that: wrapping moves an item to the next line, and an item
                   * already wider than the line still overflows. Measured at
                   * 1440px with a 113-character title: the chip's right edge was
                   * 49px past the panel's, and the panel scrolled sideways.
                   *
                   * A flex item will not shrink below its content unless
                   * `min-width` is lifted, which is what `min-w-0` is for; the
                   * button is made `block` because an inline element ignores a
                   * width cap. The date keeps `shrink-0` so the part that says
                   * WHEN survives — truncating a date to "Sep 1…" would be
                   * worse than truncating a title the button already carries in
                   * full in its tooltip and to a screen reader.
                   */
                  <li key={e.id} className="max-w-full min-w-0">
                    {/* A chip that opens the item, rather than one that names
                        something and leaves you to find it on the calendar. */}
                    <OpenItemMenu
                      item={e}
                      onEdit={() => edit(e)}
                      className="block max-w-full cursor-pointer rounded-sm"
                      title={`Open ${e.title}`}
                    >
                      <Chip tone="gray" className="max-w-full gap-1.5 hover:border-accent-border">
                        <span className="min-w-0 truncate">{e.title}</span>
                        <span className="shrink-0 text-text-3">· {shortDate(e.date)}</span>
                      </Chip>
                    </OpenItemMenu>
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
