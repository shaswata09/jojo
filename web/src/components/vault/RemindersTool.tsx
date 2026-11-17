import {
  Fragment,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { BellRing, Check, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
import { addDays, bucketOf } from '@/data/timeline'
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
import { announceRefusal } from '@/components/common/write-result'
import { useMascot } from '@/lib/mascot-context'
import { CUES } from '@/lib/mascot-cues'
import { useDomain } from '@/i18n/domain'
import { ShowMoreRows } from '@/components/common/ShowMoreRows'
import { useRowCap } from '@/components/common/use-row-cap'

/**
 * Everything flagged to come back to, off the one timeline.
 *
 * Ticking a row here writes `completedOn` into the store, which is why the
 * dashboard's follow-ups panel empties as you work down this list — the local
 * `doneIds` set this used to keep could never reach past the tab.
 */
export function RemindersTool({ focus }: { focus?: string }) {
  const { t } = useTranslation('vault')
  const domain = useDomain()
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
  const mascot = useMascot()
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const focusedRow = useArrivalScroll<HTMLLIElement>(focus)

  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  /**
   * The writes still waiting out their animation, by row.
   *
   * Two jobs. A second activation of a row already in flight is ignored — the
   * row's `pointer-events-none` stops a second click but not a second Space,
   * and both closures had captured the same "not done", so the second write
   * reopened what the first had completed under two "completed" toasts. And
   * leaving the tab mid-flight FLUSHES these instead of dropping them: the
   * store is global and the toast provider sits above the Vault, so the write
   * has somewhere to land, and cancelling it threw the user's tick away
   * without a word.
   */
  const inFlight = useRef(new Map<string, () => void>())
  useEffect(() => {
    const pending = timers.current
    const commits = inFlight.current
    return () => {
      pending.forEach(clearTimeout)
      const flush = [...commits.values()]
      commits.clear()
      for (const commit of flush) commit()
    }
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
    if (inFlight.current.has(id)) return
    if (reduceMotion) {
      commit()
      return
    }
    inFlight.current.set(id, commit)
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
        // Out of the map first: a commit that toasts must not be flushed twice.
        if (!inFlight.current.delete(id)) return
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
    if (apps.length === 1) return displayName(apps[0])
    if (apps.length === 2)
      return t('reminders.relatedTwo', {
        first: displayName(apps[0]),
        second: displayName(apps[1]),
      })
    return t('reminders.relatedMany', { count: apps.length })
  }

  /** 'Chase recruiter reply · Databricks — ML engineer', for a toast. */
  const describe = (item: TimelineItem) => {
    const related = relatedName(item)
    return related ? t('reminders.describe', { title: item.title, related }) : item.title
  }

  const handlers: RowActions = {
    edit,

    toggle: (item) => {
      const done = Boolean(item.completedOn)
      // The date it was completed on, not just whether: undoing a reopen has to
      // put back the day it was ticked, not stamp today over it.
      const before = item.completedOn ?? null
      play(item.id, { preview: { completedOn: done ? null : TODAY }, arrive: true }, () => {
        if (announceRefusal(toggleDone(item.id), toast)) return
        if (!done) mascot.play(CUES.taskDone)
        toast({
          title: done
            ? t('reminders.toast.reopened', { title: item.title })
            : t('reminders.toast.completed', { title: item.title }),
          description: done
            ? t('reminders.toast.reopenedDescription')
            : t('reminders.toast.completedDescription'),
          action: {
            label: t('common.undo'),
            // Not `toggleDone` again: by the time this is pressed the user may
            // have changed the row by hand, and a second toggle would flip it
            // back the wrong way.
            onClick: () => update(item.id, { completedOn: before }),
          },
        })
      })
    },

    snooze: (item, days) => {
      const before = item.date
      const after = addDays(anchorOf(item), days)
      play(item.id, { preview: { date: after }, arrive: true }, () => {
        if (announceRefusal(snooze(item.id, days), toast)) return
        toast({
          title: t('reminders.toast.moved', { title: item.title }),
          description: t('reminders.toast.nowDue', {
            date: domain.shortDate(after),
            when: domain.when({ ...item, date: after }, TODAY),
          }),
          // The date it came from is the one thing a second snooze cannot get
          // back, so undo restores it exactly rather than counting days again.
          action: { label: t('common.undo'), onClick: () => reschedule(item.id, before) },
        })
      })
    },

    moveTo: (item, iso) => {
      const before = item.date
      play(item.id, { preview: { date: iso }, arrive: true }, () => {
        if (announceRefusal(reschedule(item.id, iso), toast)) return
        toast({
          title: t('reminders.toast.moved', { title: item.title }),
          description: t('reminders.toast.nowDue', {
            date: domain.shortDate(iso),
            when: domain.when({ ...item, date: iso }, TODAY),
          }),
          action: { label: t('common.undo'), onClick: () => reschedule(item.id, before) },
        })
      })
    },

    duplicate: (item) => {
      // The copy starts open even when the original is ticked off: "the same
      // chase, again" is the only reason to duplicate a reminder, and one that
      // arrived already completed would be filed straight out of sight.
      const copy = add({
        ...item,
        title: t('reminders.copyTitle', { title: item.title }),
        completedOn: undefined,
      })
      // Timeline items are keyed by their bare id in the label store, while
      // applications answer to `refKey('app', id)` — the asymmetry is spelled
      // out in data/labels.ts, and a prefixed key here files the copy's
      // keywords where no surface goes looking for them.
      const keywords = labelIdsOf(item.id)
      if (keywords.length > 0) setRecord(copy.id, keywords)
      toast({
        title: t('reminders.toast.duplicated', { title: item.title }),
        description: t('reminders.toast.duplicatedDescription', {
          date: domain.shortDate(copy.date),
        }),
        action: {
          label: t('common.undo'),
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
        const removed = remove(item.id)
        if (!removed.ok) {
          toast({
            title: t('common.deleteFailed'),
            description: removed.refusal ?? t('reminders.toast.stillOnList', { title: item.title }),
            tone: 'danger',
          })
          return
        }
        const { restore } = removed
        removeRecord(item.id)
        toast({
          title: t('common.deleted', { title: item.title }),
          description: t('reminders.toast.deletedDescription', { description: describe(item) }),
          tone: 'danger',
          action: {
            label: t('common.undo'),
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

  /*
   * One `actions` object for the life of the tool, forwarding to the handlers
   * of the latest render. A fresh object every render defeated `memo` on the
   * rows, so each phase of one row's tick animation re-rendered the whole list.
   */
  const latest = useRef(handlers)
  useLayoutEffect(() => {
    latest.current = handlers
  })
  const actions = useMemo<RowActions>(
    () => ({
      edit: (item) => latest.current.edit(item),
      toggle: (item) => latest.current.toggle(item),
      duplicate: (item) => latest.current.duplicate(item),
      remove: (item) => latest.current.remove(item),
      snooze: (item, days) => latest.current.snooze(item, days),
      moveTo: (item, iso) => latest.current.moveTo(item, iso),
      draft: (item) => latest.current.draft(item),
    }),
    [],
  )

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const r of reminders) {
      const b = bucketOf(r, TODAY)
      map[b] = (map[b] ?? 0) + 1
    }
    return map
  }, [reminders])

  // Deferred, so a keystroke paints the box at once and the filter over a long
  // list follows when the main thread is free.
  const deferredQuery = useDeferredValue(query)
  const visible = reminders.filter(
    (r) =>
      labelMatches(r.id) &&
      matchesQuery(
        deferredQuery,
        r.title,
        r.detail,
        r.note,
        domain.kind(r.kind),
        KIND_LABEL[r.kind],
        relatedName(r),
      ),
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

  const groups = BUCKETS.map((b) => ({ bucket: b, rows: rowsIn(b) }))
  const shownRows = groups.reduce((n, g) => n + g.rows.length, 0)
  // A page of rows at a time across the groups, in reading order, always
  // including the row a link arrived at.
  const flat = groups.flatMap((g) => g.rows)
  const cap = useRowCap(shownRows, focus ? flat.findIndex((r) => r.id === focus) : -1)
  let budget = cap.shown

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
        title: t('reminders.empty.zeroTitle'),
        description: t('reminders.empty.zeroDescription'),
        action: (
          <Button size="sm" onClick={() => open('timelineItem', { mode: 'reminder' })}>
            <Plus className="size-3.5" strokeWidth={2} aria-hidden />
            {t('reminders.add')}
          </Button>
        ),
      },
      search: (q) => t('reminders.empty.search', { query: q }),
      both: t('reminders.empty.both', { bucket: bucketWord }),
      // Done is the one bucket that is not a deadline passing: an empty Done
      // list is not a filter hiding work, so it says something else.
      bucket:
        bucket === 'done'
          ? {
              icon: Check,
              title: t('reminders.empty.doneTitle'),
              description: t('reminders.empty.doneDescription'),
              clearLabel: t('reminders.empty.showAll'),
            }
          : {
              title: t('reminders.empty.bucketTitle', { bucket: bucketWord }),
              description: t('reminders.empty.bucketDescription', { count: reminders.length }),
              clearLabel: t('reminders.empty.showAll'),
            },
      keywords: { title: t('reminders.empty.keywordsTitle') },
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
              label={t('reminders.filterLabel')}
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
              label={t('reminders.searchLabel')}
              placeholder={t('reminders.searchPlaceholder')}
              value={query}
              onChange={setQuery}
            />
          }
          action={
            <Button size="sm" onClick={() => open('timelineItem', { mode: 'reminder' })}>
              <Plus className="size-3.5" strokeWidth={2} aria-hidden />
              {t('reminders.add')}
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
          {groups.map(({ bucket: b, rows: all }) => {
            const rows = all.slice(0, Math.max(0, budget))
            budget -= rows.length
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
                  <span className="tabular font-normal text-text-3">{all.length}</span>
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
      <ShowMoreRows shown={cap.shown} hidden={cap.hidden} onMore={cap.more} />
    </Panel>
  )
}
