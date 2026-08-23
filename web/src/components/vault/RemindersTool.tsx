import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { BellRing, Check, Plus } from 'lucide-react'
import { BucketFilter } from '@/components/common/BucketFilter'
import { BUCKETS, BUCKET_LABEL } from '@/components/common/timeline-buckets'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { emptyStateFor } from '@/components/vault/empty-state'
import { matchesQuery } from '@/components/vault/search'
import { VaultSearch, VaultToolbar } from '@/components/vault/VaultToolbar'
import { COLLAPSE_MS, HOLD_MS, anchorOf } from '@/components/vault/reminders/model'
import type { RowActions, Transit } from '@/components/vault/reminders/model'
import { ReminderRow } from '@/components/vault/reminders/ReminderRow'
import { displayName } from '@/data/seed'
import { addDays, bucketOf, shortDate, whenLabel } from '@/data/timeline'
import type { TimelineBucket, TimelineItem } from '@/data/timeline'
import { useApplications } from '@jojo/service/react/use-applications'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { useDialogs } from '@/lib/dialogs-context'
import { useLabels } from '@/lib/labels-context'
import { KIND_LABEL } from '@/lib/timeline-visuals'
import { useToast } from '@/lib/toast-context'
import { TODAY } from '@/lib/today'
import { useArrivalScroll } from '@/lib/use-arrival-highlight'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'

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

  const relatedTo = (item: TimelineItem) =>
    item.applicationIds.map((id) => byId.get(id)).filter((a) => a !== undefined)

  /**
   * The applications an item is about, in one phrase.
   *
   * Named up to two and counted past that: "Rice and Baylor" is worth reading
   * and a list of five is a sentence nobody finishes in a toast.
   */
  const relatedName = (item: TimelineItem) => {
    const apps = relatedTo(item)
    if (apps.length === 0) return undefined
    if (apps.length <= 2) return apps.map((a) => displayName(a)).join(' and ')
    return `${String(apps.length)} applications`
  }

  /** 'Chase recruiter reply · Databricks — ML engineer', for a toast. */
  const describe = (item: TimelineItem) => {
    const related = relatedName(item)
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
      matchesQuery(query, r.title, r.detail, r.note, KIND_LABEL[r.kind], relatedName(r)),
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

  // Only ever read by the branches that already know the chip is on; named
  // here because the copy object is built before the branch is chosen.
  const bucketWord = bucket === 'all' ? '' : BUCKET_LABEL[bucket].toLowerCase()

  const empty = emptyStateFor({
    total: reminders.length,
    query,
    filteredByBucket: bucket !== 'all',
    filteredByKeyword: selectedLabels.size > 0,
    onClearQuery: () => setQuery(''),
    onClearBucket: () => setBucket('all'),
    onClearKeywords: clearSelected,
    copy: {
      icon: BellRing,
      zero: {
        title: 'No reminders yet',
        description:
          'A reminder is a dated nudge — chase a referee, check a portal, send a thank-you. Ones you mark as follow-ups also show on the dashboard until you tick them off.',
        action: (
          <Button size="sm" onClick={() => open('timelineItem', { mode: 'reminder' })}>
            <Plus className="size-3.5" strokeWidth={2} aria-hidden />
            Add reminder
          </Button>
        ),
      },
      search: (q) => `No reminder mentions "${q}" in its title, note, kind or application.`,
      both: `No ${bucketWord} reminder carries the selected keywords.`,
      // Done is the one bucket that is not a deadline passing: an empty Done
      // list is not a filter hiding work, so it says something else.
      bucket:
        bucket === 'done'
          ? {
              icon: Check,
              title: 'Nothing completed yet',
              description:
                'Reminders you tick off collect here, so one ticked by mistake is still findable.',
              clearLabel: 'Show all reminders',
            }
          : {
              title: `Nothing ${bucketWord}`,
              description: `${reminders.length} reminders are filed under the other groups.`,
              clearLabel: 'Show all reminders',
            },
      keywords: { title: 'No reminders carry those keywords' },
    },
  })

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
