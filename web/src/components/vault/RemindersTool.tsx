import { Fragment, useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { Link } from 'react-router'
import { BellRing, Check, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { BucketFilter } from '@/components/common/BucketFilter'
import { EmptyState } from '@/components/common/EmptyState'
import { Field } from '@/components/common/Field'
import { LabelChips, LabelPicker } from '@/components/common/LabelFilter'
import { Panel } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MenuItem, MenuSection, RowMenu } from '@/components/vault/RowMenu'
import { VaultSearch, VaultToolbar, matchesQuery } from '@/components/vault/VaultToolbar'
import { displayName } from '@/data/seed'
import { TODAY, addDays, bucketOf, shortDate, whenLabel } from '@/data/timeline'
import type { TimelineBucket, TimelineItem } from '@/data/timeline'
import { useDialogs } from '@/lib/dialogs-context'
import { useLabels } from '@/lib/labels-context'
import { appPath } from '@/lib/links'
import { useApplications, useTimeline } from '@/lib/store-context'
import { KIND_ICON, KIND_LABEL } from '@/lib/timeline-visuals'
import { useToast } from '@/lib/toast-context'
import { useArrivalScroll } from '@/lib/use-arrival-highlight'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'

const bucketText: Record<TimelineBucket, string> = {
  overdue: 'text-danger',
  today: 'text-warning',
  upcoming: 'text-text-3',
  done: 'text-text-3',
}

const BUCKETS: TimelineBucket[] = ['overdue', 'today', 'upcoming', 'done']

const BUCKET_LABEL: Record<TimelineBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  done: 'Completed',
}

/**
 * How long the row you just acted on stays put before it collapses.
 *
 * Ticking a reminder used to unmount its row in the same commit as the click:
 * the thing you pressed was gone before the pointer left it, and on a mis-click
 * there was nothing on screen to tell you which row had vanished. The hold
 * paints the outcome on the row itself — box ticked, title struck, or the new
 * date already showing — and only then takes it away.
 */
const HOLD_MS = 400
const COLLAPSE_MS = 220

/**
 * A row mid-flight, with the outcome of the click painted on it before the
 * store has been written.
 *
 * `held` shows `preview` merged over the record and does not move. `leaving`
 * collapses it to nothing. `arriving` is the same row re-inserted wherever the
 * write put it, expanding from nothing — so the two halves read as one journey
 * rather than a disappearance followed by an unrelated appearance.
 */
type Transit = {
  phase: 'held' | 'leaving' | 'arriving'
  preview?: Partial<TimelineItem>
}

/**
 * Where a snooze counts from — a mirror of `useTimeline().snooze` in
 * store-context.ts, kept here only so the menu can print the date it is about
 * to write. Change one and change the other, or the label promises a Tuesday
 * and the store writes a Thursday.
 */
const anchorOf = (item: TimelineItem) => (item.date < TODAY ? TODAY : item.date)

/**
 * The snooze steps, spelled two ways.
 *
 * The store counts from today only when an item is already overdue; for
 * anything dated ahead it counts from that date. So "Tomorrow" is a lie on a
 * reminder due next Friday — it would land on the Saturday. The `later`
 * spelling is used whenever the anchor is not today, which is the only way the
 * label can never claim a date the store is not going to write.
 */
const SNOOZE_STEPS = [
  { days: 1, soon: 'Tomorrow', later: 'A day later' },
  { days: 3, soon: 'In 3 days', later: 'Three days later' },
  { days: 7, soon: 'In 7 days', later: 'A week later' },
]

type RowActions = {
  toggle: (item: TimelineItem) => void
  edit: (item: TimelineItem) => void
  duplicate: (item: TimelineItem) => void
  remove: (item: TimelineItem) => void
  snooze: (item: TimelineItem, days: number) => void
  moveTo: (item: TimelineItem, iso: string) => void
  draft: (item: TimelineItem) => void
}

/** The two-line date block, shared by the snooze trigger and the inert copy. */
function DateLines({ item }: { item: TimelineItem }) {
  return (
    <>
      <span
        className={cn(
          'block text-xs font-medium whitespace-nowrap',
          bucketText[bucketOf(item, TODAY)],
        )}
      >
        {whenLabel(item, TODAY)}
      </span>
      <span className="mt-0.5 block font-mono text-xs text-text-3">{shortDate(item.date)}</span>
    </>
  )
}

/**
 * Snooze, hung off the date the user is already looking at.
 *
 * Every option writes a new date and nothing else, so the row re-buckets and
 * physically moves from Overdue down into Upcoming. That journey is the
 * feedback — the grouping below is recomputed from `bucketOf` every render
 * precisely so it can happen.
 */
function SnoozeMenu({ item, actions }: { item: TimelineItem; actions: RowActions }) {
  const [open, setOpen] = useState(false)
  // Seeded from the row so the calendar opens on the month the reminder is in
  // rather than on today, which for an overdue item is the wrong page.
  const [picked, setPicked] = useState(item.date)
  const anchor = anchorOf(item)
  const soon = anchor === TODAY

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Re-seeded on the way open, not just at mount. Snoozing rewrites the
        // row's date underneath this component, and a field still holding last
        // week's value would offer to move the reminder back there.
        if (next) setPicked(item.date)
        setOpen(next)
      }}
    >
      <PopoverTrigger
        title="Snooze or move this reminder"
        aria-label={`Snooze "${item.title}" — ${whenLabel(item, TODAY)}`}
        className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-right transition-colors hover:bg-well data-[state=open]:bg-well"
      >
        <DateLines item={item} />
      </PopoverTrigger>

      <PopoverContent align="end" className="w-60">
        <div className="px-0.5 text-xs tracking-wide text-text-3 uppercase">Snooze</div>
        <div className="flex flex-col">
          {SNOOZE_STEPS.map((step) => (
            <button
              key={step.days}
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1.5 text-xs text-text-2 transition-colors hover:bg-well hover:text-text-1"
              onClick={() => {
                setOpen(false)
                actions.snooze(item, step.days)
              }}
            >
              <span className="flex-1 text-left">{soon ? step.soon : step.later}</span>
              <span className="font-mono text-text-3">{shortDate(addDays(anchor, step.days))}</span>
            </button>
          ))}
        </div>

        <span aria-hidden className="h-px bg-hairline" />

        {/* No `min` on the input. An overdue reminder opens this field holding a
            date that is already past, and a minimum of today would mark it
            invalid before anyone touched it — and moving something back a day
            is a legitimate correction, not a snooze. */}
        <Field
          label="Pick a date"
          type="date"
          value={picked}
          onChange={(event) => {
            const iso = event.target.value
            setPicked(iso)
            if (!iso || iso === item.date) return
            setOpen(false)
            actions.moveTo(item, iso)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function ReminderRow({
  item,
  related,
  focused,
  rowRef,
  transit,
  actions,
}: {
  item: TimelineItem
  /** The application it hangs off, already spelled for display. */
  related?: string
  /** Arrived here from a link that named this row — see `focus` in links.ts. */
  focused?: boolean
  /** Set on the focused row only, so the tool can scroll it into view. */
  rowRef?: Ref<HTMLLIElement>
  /** Set while this row is playing out the click that will move or remove it. */
  transit?: Transit
  actions: RowActions
}) {
  // Everything below reads the previewed record, so the outcome is on the row
  // before the store knows about it.
  const shown = transit?.preview ? { ...item, ...transit.preview } : item
  const Icon = KIND_ICON[shown.kind]
  const done = Boolean(shown.completedOn)
  const collapsed = transit?.phase === 'leaving' || transit?.phase === 'arriving'

  return (
    // The collapse is a grid track, not a height: `1fr → 0fr` animates without
    // anyone having to measure the row first, and everything below slides up
    // continuously instead of jumping when the row is finally gone.
    <li
      ref={rowRef}
      className={cn(
        'grid border-b border-hairline transition-[grid-template-rows,opacity] ease-out last:border-b-0',
        collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
      )}
      style={{ transitionDuration: `${COLLAPSE_MS}ms` }}
    >
      <div
        className={cn(
          'overflow-hidden',
          // A row on its way out must not take a second click: the store write
          // has not happened yet, so a double-tick would fire twice.
          transit && 'pointer-events-none',
        )}
      >
        <div
          className={cn(
            // Wraps below `sm`. The trailing cluster is `shrink-0` and runs to
            // ~220px (Draft a reply, the date, the keyword picker, the ⋯), which
            // on a 390px screen left the title about 90px — it rendered as "C…",
            // and at 360px as nothing at all, so the row said a reminder was
            // overdue without saying which. On one line the actions now drop
            // underneath and the title gets the width.
            'flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 sm:flex-nowrap',
            // Marks the row a link pointed at. `.arrival-highlight` fades the
            // tint out rather than holding it — see use-arrival-highlight.ts,
            // which drops the URL parameter on the same beat and scrolls the
            // row into view, because a tint below the fold answers nothing.
            focused && 'arrival-highlight -mx-2 rounded-md px-2',
          )}
        >
          {/* A real checkbox role, so screen readers get the state and Space works. */}
          <button
            type="button"
            role="checkbox"
            aria-checked={done}
            onClick={() => actions.toggle(item)}
            aria-label={done ? `Mark "${item.title}" as not done` : `Mark "${item.title}" done`}
            className={cn(
              'grid size-[18px] shrink-0 place-items-center rounded-sm border transition-colors',
              done
                ? 'border-accent-border bg-accent-soft text-accent'
                : 'border-hairline-strong hover:border-accent-border',
            )}
          >
            {done ? <Check className="size-3" strokeWidth={2.5} /> : null}
          </button>

          <div className="min-w-0 flex-1 basis-[calc(100%-1.875rem)] sm:basis-auto">
            {/* The title is the way in to editing it. A row you can tick but not
                correct is where every wrong date in this list came from. */}
            <button
              type="button"
              onClick={() => actions.edit(item)}
              className={cn(
                'block max-w-full cursor-pointer truncate text-left text-sm transition-colors hover:text-accent',
                done && 'text-text-3 line-through',
              )}
            >
              {shown.title}
            </button>
            {/* One line, not three. The keyword chips used to sit under this and
                made every row a different height, which is why eight reminders
                did not fit on a screen. */}
            <div className="mt-0.5 flex items-center gap-x-2 overflow-hidden text-xs text-text-3">
              {/* Named out loud: the icon is the only thing on the row that
                  says whether this is a chase or a piece of prep. */}
              <Icon
                role="img"
                aria-label={KIND_LABEL[shown.kind]}
                className="size-3.5 shrink-0"
                strokeWidth={1.7}
              />
              {/* The edge back to the application — the reason every dated thing
                  became one record with an `applicationId` instead of five lists
                  that could only name a job in prose. */}
              {related && item.applicationId ? (
                <Link
                  to={appPath(item.applicationId)}
                  className="min-w-0 truncate underline-offset-2 transition-colors hover:text-accent hover:underline"
                >
                  {related}
                </Link>
              ) : (
                <span className="shrink-0">Unfiled</span>
              )}
              {shown.note ? <span className="truncate">· {shown.note}</span> : null}
              <LabelChips recordId={item.id} className="shrink-0" />
            </div>
          </div>

          <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto sm:justify-start">
            {/* Ahead of the date, not after the ⋯. Sitting last, it pushed the
                overflow button 56px sideways on follow-up rows only, so ⋯ was in
                a different place on every other row of the list. */}
            {shown.kind === 'follow-up' && !done ? (
              <Button variant="ghost" size="sm" onClick={() => actions.draft(item)}>
                Draft a reply
              </Button>
            ) : null}

            {/* A completed row keeps the date it was done on, and nothing to
                snooze: moving a finished reminder into next week is not a thing
                anyone means to do. Untick it first and the menu comes back. */}
            {done ? (
              <div className="px-1.5 py-0.5 text-right">
                <DateLines item={shown} />
              </div>
            ) : (
              <SnoozeMenu item={shown} actions={actions} />
            )}

            <LabelPicker recordId={item.id} />
            <RowMenu name={item.title}>
              <MenuItem icon={Pencil} onSelect={() => actions.edit(item)}>
                Edit
              </MenuItem>
              <MenuItem icon={Copy} onSelect={() => actions.duplicate(item)}>
                Duplicate
              </MenuItem>
              <MenuSection>
                <MenuItem icon={Trash2} danger onSelect={() => actions.remove(item)}>
                  Delete
                </MenuItem>
              </MenuSection>
            </RowMenu>
          </div>
        </div>
      </div>
    </li>
  )
}

/**
 * Everything flagged to come back to, off the one timeline.
 *
 * Ticking a row here writes `completedOn` into the store, which is why the
 * dashboard's follow-ups panel empties as you work down this list — the local
 * `doneIds` set this used to keep could never reach past the tab.
 */
export function RemindersTool({ focus }: { focus?: string }) {
  const [bucket, setBucket] = useState<TimelineBucket | 'all'>('all')
  const [query, setQuery] = useState('')
  const [transits, setTransits] = useState<Record<string, Transit>>({})

  const {
    matches: labelMatches,
    selected: selectedLabels,
    clearSelected,
    labelIdsOf,
    setRecord,
    removeRecord,
  } = useLabels()
  const { reminders, add, update, remove, toggleDone, snooze, reschedule } = useTimeline()
  const { byId } = useApplications()
  const { open } = useDialogs()
  const { toast } = useToast()
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const focusedRow = useArrivalScroll<HTMLLIElement>(focus)

  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => {
    const pending = timers.current
    // Leaving the tab mid-flight must not fire a store write into an unmounted
    // tree — and the write is deliberately the *last* step, so cancelling here
    // cancels the whole action rather than half of it.
    return () => pending.forEach(clearTimeout)
  }, [])

  /**
   * Clears `arriving` one paint after the row is back in the DOM.
   *
   * Two frames, not one: the first commit has to reach the compositor with the
   * row still collapsed, or the browser sees only the final value and there is
   * nothing to transition from.
   */
  useEffect(() => {
    const arriving = Object.keys(transits).filter((id) => transits[id].phase === 'arriving')
    if (arriving.length === 0) return
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() =>
        setTransits((prev) => {
          const next = { ...prev }
          for (const id of arriving) if (next[id]?.phase === 'arriving') delete next[id]
          return next
        }),
      )
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [transits])

  /**
   * Play the outcome on the row, then write it.
   *
   * `commit` runs last and carries the toast with it, so Undo can never be
   * pressed before the thing it undoes has happened. Under reduced motion the
   * whole schedule collapses to the write — the global CSS reset flattens
   * transitions to 0.01ms, so the hold would be a 400ms freeze with no motion
   * to explain it.
   */
  const play = (
    id: string,
    options: { preview?: Partial<TimelineItem>; arrive?: boolean },
    commit: () => void,
  ) => {
    if (reduceMotion) {
      commit()
      return
    }
    const { preview, arrive } = options
    setTransits((prev) => ({ ...prev, [id]: { phase: preview ? 'held' : 'leaving', preview } }))

    const wait = preview ? HOLD_MS : 0
    if (preview) {
      timers.current.push(
        setTimeout(
          () =>
            setTransits((prev) =>
              prev[id] ? { ...prev, [id]: { phase: 'leaving', preview } } : prev,
            ),
          wait,
        ),
      )
    }
    timers.current.push(
      setTimeout(() => {
        commit()
        setTransits((prev) => {
          const next = { ...prev }
          if (arrive) next[id] = { phase: 'arriving' }
          else delete next[id]
          return next
        })
      }, wait + COLLAPSE_MS),
    )
  }

  // Reminder mode either way: everything in this list has `remind` on, and the
  // switch inside the dialog is what can take it out again.
  const edit = (item: TimelineItem) => open('timelineItem', { mode: 'reminder', initial: item })

  const relatedTo = (item: TimelineItem) => {
    const app = item.applicationId ? byId.get(item.applicationId) : undefined
    return app ? displayName(app) : undefined
  }

  /** 'Chase recruiter reply · Databricks — ML engineer', for a toast. */
  const describe = (item: TimelineItem) => {
    const related = relatedTo(item)
    return related ? `${item.title} · ${related}` : item.title
  }

  const actions: RowActions = {
    edit,

    toggle: (item) => {
      const done = Boolean(item.completedOn)
      play(item.id, { preview: { completedOn: done ? null : TODAY }, arrive: true }, () => {
        toggleDone(item.id)
        toast({
          title: `${item.title} ${done ? 'reopened' : 'completed'}`,
          description: done
            ? 'Back under its own date, and back on the dashboard if it is a follow-up.'
            : 'Filed under Completed, and off the dashboard.',
          action: {
            label: 'Undo',
            // Not `toggleDone` again: by the time this is pressed the user may
            // have changed the row by hand, and a second toggle would flip it
            // back the wrong way.
            onClick: () => update(item.id, { completedOn: done ? TODAY : null }),
          },
        })
      })
    },

    snooze: (item, days) => {
      const before = item.date
      const after = addDays(anchorOf(item), days)
      play(item.id, { preview: { date: after }, arrive: true }, () => {
        snooze(item.id, days)
        toast({
          title: `${item.title} moved`,
          description: `Now due ${shortDate(after)} · ${whenLabel({ ...item, date: after }, TODAY)}`,
          // The date it came from is the one thing a second snooze cannot get
          // back, so undo restores it exactly rather than counting days again.
          action: { label: 'Undo', onClick: () => reschedule(item.id, before) },
        })
      })
    },

    moveTo: (item, iso) => {
      const before = item.date
      play(item.id, { preview: { date: iso }, arrive: true }, () => {
        reschedule(item.id, iso)
        toast({
          title: `${item.title} moved`,
          description: `Now due ${shortDate(iso)} · ${whenLabel({ ...item, date: iso }, TODAY)}`,
          action: { label: 'Undo', onClick: () => reschedule(item.id, before) },
        })
      })
    },

    duplicate: (item) => {
      // The copy starts open even when the original is ticked off: "the same
      // chase, again" is the only reason to duplicate a reminder, and one that
      // arrived already completed would be filed straight out of sight.
      const copy = add({ ...item, title: `${item.title} (copy)`, completedOn: undefined })
      // Timeline items are keyed by their bare id in the label store, while
      // applications answer to `refKey('app', id)` — the asymmetry is spelled
      // out in data/labels.ts, and a prefixed key here files the copy's
      // keywords where no surface goes looking for them.
      const keywords = labelIdsOf(item.id)
      if (keywords.length > 0) setRecord(copy.id, keywords)
      toast({
        title: `${item.title} duplicated`,
        description: `The copy is open and due ${shortDate(copy.date)}.`,
        action: {
          label: 'Undo',
          onClick: () => {
            remove(copy.id)
            removeRecord(copy.id)
          },
        },
      })
    },

    /**
     * A reminder is a title and a date, re-typed in seconds — a cheap record,
     * so it goes on an undo toast rather than a confirmation dialog. Its
     * keywords go with it and come back with it: `remove` restores the item
     * only, and a record that returned stripped of its keywords is not an undo.
     */
    remove: (item) => {
      const keywords = labelIdsOf(item.id)
      play(item.id, {}, () => {
        const { restore } = remove(item.id)
        removeRecord(item.id)
        toast({
          title: `${item.title} deleted`,
          description: `${describe(item)} — gone from the calendar as well as this list.`,
          tone: 'danger',
          action: {
            label: 'Undo',
            onClick: () => {
              restore()
              // Guarded: `setRecord` with an empty list files the record as
              // carrying no keywords rather than leaving it unmentioned.
              if (keywords.length > 0) setRecord(item.id, keywords)
            },
          },
        })
      })
    },

    draft: (item) => open('draft', { itemId: item.id }),
  }

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const r of reminders) {
      const b = bucketOf(r, TODAY)
      map[b] = (map[b] ?? 0) + 1
    }
    return map
  }, [reminders])

  const visible = reminders.filter(
    (r) =>
      labelMatches(r.id) &&
      matchesQuery(query, r.title, r.detail, r.note, KIND_LABEL[r.kind], relatedTo(r)),
  )

  /**
   * Rows in a group, given what the bucket chips and the search let through.
   *
   * Recomputed on every render, deliberately. Snoozing writes a new date and
   * nothing else, so the row's bucket has to be asked for again afterwards —
   * cache this and a snoozed reminder would sit in Overdue showing next week's
   * date, which is the bug the whole feature exists to avoid.
   */
  const rowsIn = (b: TimelineBucket) =>
    bucket !== 'all' && bucket !== b ? [] : visible.filter((r) => bucketOf(r, TODAY) === b)

  const shownRows = BUCKETS.reduce((n, b) => n + rowsIn(b).length, 0)

  /**
   * Every empty list names the control that emptied it. "All caught up" over a
   * vault holding eight open reminders, because a chip or a search box is set,
   * congratulates someone for work they have not done.
   */
  const empty = (() => {
    if (reminders.length === 0) {
      return {
        icon: BellRing,
        title: 'No reminders yet',
        description:
          'A reminder is a dated nudge — chase a referee, check a portal, send a thank-you. Ones you mark as follow-ups also show on the dashboard until you tick them off.',
        action: (
          <Button size="sm" onClick={() => open('timelineItem', { mode: 'reminder' })}>
            <Plus className="size-3.5" strokeWidth={2} aria-hidden />
            Add reminder
          </Button>
        ),
      }
    }
    if (query.trim()) {
      return {
        icon: BellRing,
        title: 'Nothing matches that search',
        description: `No reminder mentions "${query.trim()}" in its title, note, kind or application.`,
        action: (
          <Button variant="outline" size="sm" onClick={() => setQuery('')}>
            Clear search
          </Button>
        ),
      }
    }
    const byBucket = bucket !== 'all'
    const byKeyword = selectedLabels.size > 0

    if (byBucket && byKeyword) {
      return {
        icon: BellRing,
        title: 'Nothing matches both filters',
        description: `No ${BUCKET_LABEL[bucket].toLowerCase()} reminder carries the selected keywords.`,
        action: (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setBucket('all')
              clearSelected()
            }}
          >
            Clear both filters
          </Button>
        ),
      }
    }
    if (byBucket) {
      return {
        icon: bucket === 'done' ? Check : BellRing,
        title:
          bucket === 'done'
            ? 'Nothing completed yet'
            : `Nothing ${BUCKET_LABEL[bucket].toLowerCase()}`,
        description:
          bucket === 'done'
            ? 'Reminders you tick off collect here, so one ticked by mistake is still findable.'
            : `${reminders.length} reminders are filed under the other groups.`,
        action: (
          <Button variant="outline" size="sm" onClick={() => setBucket('all')}>
            Show all reminders
          </Button>
        ),
      }
    }
    return {
      icon: BellRing,
      title: 'No reminders carry those keywords',
      description: 'The keyword filter at the top of the page is what is hiding them.',
      action: (
        <Button variant="outline" size="sm" onClick={clearSelected}>
          Clear keywords
        </Button>
      ),
    }
  })()

  return (
    <Panel className="min-w-0">
      {/* The page header belongs to the Vault, which hosts several tools, so
          this one carries its own toolbar — the same one, in the same order, as
          the other three tabs. */}
      {reminders.length > 0 ? (
        <VaultToolbar
          filter={
            <BucketFilter
              label="Filter reminders by when they are due"
              options={BUCKETS}
              labels={BUCKET_LABEL}
              counts={counts}
              value={bucket}
              onChange={setBucket}
              total={reminders.length}
            />
          }
          search={
            <VaultSearch
              label="Search reminders"
              placeholder="Search title, note or job"
              value={query}
              onChange={setQuery}
            />
          }
          action={
            <Button size="sm" onClick={() => open('timelineItem', { mode: 'reminder' })}>
              <Plus className="size-3.5" strokeWidth={2} aria-hidden />
              Add reminder
            </Button>
          }
        />
      ) : null}

      {shownRows === 0 ? (
        <EmptyState
          icon={empty.icon}
          title={empty.title}
          description={empty.description}
          action={empty.action}
        />
      ) : (
        // One list, not four panels. Three separate Panels cost ~193px in
        // borders and headings between eight rows, and the group you were
        // reading changed size every time a row moved out of it.
        <ul>
          {BUCKETS.map((b) => {
            const rows = rowsIn(b)
            if (rows.length === 0) return null

            return (
              <Fragment key={b}>
                {/* Sticky under the topbar's scrim, so you can always see which
                    group the row under the pointer belongs to. */}
                <li
                  className={cn(
                    'sticky top-20 z-10 -mx-4 flex items-baseline gap-2 bg-panel px-4 py-1.5 text-xs font-medium sm:top-24 sm:-mx-5 sm:px-5',
                    b === 'overdue' ? 'text-danger' : 'text-text-2',
                  )}
                >
                  {BUCKET_LABEL[b]}
                  <span className="tabular font-normal text-text-3">{rows.length}</span>
                </li>
                {rows.map((r) => (
                  <ReminderRow
                    key={r.id}
                    item={r}
                    related={relatedTo(r)}
                    focused={r.id === focus}
                    rowRef={r.id === focus ? focusedRow : undefined}
                    transit={transits[r.id]}
                    actions={actions}
                  />
                ))}
              </Fragment>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
