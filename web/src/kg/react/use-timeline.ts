/**
 * L4 — useTimeline(). Signature frozen; the façade that re-exported it is gone.
 *
 * `toggleDone` survives here as a compatibility shim and only here. The tools
 * split it into `complete` and `reopen` (no `toggle` verb, §4) because a toggle
 * is an instruction to invert whatever it finds, and by the time an undo fires
 * the item may have been unticked on another screen — so the undo re-ticks it.
 * This hook reads the current value and asks for the one the card meant, which
 * is the same fix `PriorityActions.tsx:69-71` writes out by hand three times.
 *
 * Every bucket is measured against the provider's `today`, not against a module
 * constant. Nothing under `src/kg` reads a clock or imports one (D26) — the day
 * arrives through `KgProvider`'s `now`, and a completion stamped with the
 * fixtures' October in 2027 is a lie the user reads on the card.
 */

import { useCallback, useMemo } from 'react'
import { addDays, bucketOf, followUpsOf } from '@/data/timeline'
import type { TimelineItem } from '@/kg/core/model'
import { useGraph, useKg } from './kg-context'
import { useRun } from './use-tool'
import { asNull, asText, nothingToRestore, present } from './patch'

export type TimelineDraft = Omit<TimelineItem, 'id' | 'allDay' | 'remind' | 'urgency'> &
  Partial<Pick<TimelineItem, 'allDay' | 'remind' | 'urgency'>>

export function useTimeline() {
  const graph = useGraph()
  const { repo, projections, today } = useKg()
  const run = useRun()

  const all = projections.timeline(graph)

  const byId = useMemo(() => new Map(all.map((i) => [i.id, i])), [all])
  const get = useCallback((id: string) => byId.get(id), [byId])

  const forApplication = useCallback(
    (appId: string) => all.filter((i) => i.applicationId === appId),
    [all],
  )

  const forDay = useCallback((iso: string) => all.filter((i) => i.date === iso), [all])

  // Matched on the 'YYYY-MM' prefix rather than by parsing. The year has to be
  // part of the test or October 2027 lists October 2026's deadlines, and an ISO
  // string compares correctly without ever becoming a Date.
  const forMonth = useCallback(
    (y: number, m: number) => {
      const prefix = `${y}-${String(m).padStart(2, '0')}`
      return all.filter((i) => i.date.startsWith(prefix))
    },
    [all],
  )

  const add = useCallback(
    (draft: TimelineDraft): TimelineItem => {
      const result = run('timeline.item.create', {
        title: draft.title,
        date: draft.date,
        kind: draft.kind,
        ...present('detail', draft.detail),
        ...present('note', draft.note),
        ...present('startMins', draft.startMins),
        ...present('durationMins', draft.durationMins),
        ...present('urgency', draft.urgency),
        ...present('remind', draft.remind),
        ...present('location', draft.location),
        ...present('joinUrl', draft.joinUrl),
        ...present('applicationId', draft.applicationId),
        ...present('completedOn', draft.completedOn ?? undefined),
      })
      if (!result.ok) throw new Error(result.errors[0]?.message ?? 'Could not add the item.')
      const created = projections.timeline(repo.getSnapshot()).find((i) => i.id === result.output)
      if (!created) throw new Error('The item was created and could not be read back.')
      return created
    },
    [run, repo, projections],
  )

  const update = useCallback(
    (id: string, patch: Partial<TimelineItem>) => {
      run('timeline.item.update', {
        id,
        ...present('title', patch.title),
        ...present('date', patch.date),
        ...present('kind', patch.kind),
        ...present('urgency', patch.urgency),
        ...present('remind', patch.remind),
        ...asText('detail', patch, 'detail'),
        ...asText('note', patch, 'note'),
        ...asText('location', patch, 'location'),
        ...asText('joinUrl', patch, 'joinUrl'),
        ...asNull('startMins', patch, 'startMins'),
        ...asNull('durationMins', patch, 'durationMins'),
        ...asNull('completedOn', patch, 'completedOn'),
        ...asNull('applicationId', patch, 'applicationId'),
      })
    },
    [run],
  )

  const remove = useCallback(
    (id: string) => {
      const result = run('timeline.item.delete', { id })
      return { restore: (result.ok && result.undo) || nothingToRestore }
    },
    [run],
  )

  const toggleDone = useCallback(
    (id: string) => {
      const item = repo.getSnapshot().node(id, 'timelineItem')
      if (!item) return
      // Read, then asked for a specific state. Calling a `toggle` tool would
      // have put the same bug in the layer below: an undo firing after the item
      // was unticked elsewhere would tick it again.
      if (item.props.completedOn) run('timeline.item.reopen', { id })
      else run('timeline.item.complete', { id, on: today })
    },
    [repo, run, today],
  )

  const snooze = useCallback(
    (id: string, days: number) => {
      run('timeline.item.snooze', { id, days })
    },
    [run],
  )

  const reschedule = useCallback(
    (id: string, iso: string) => {
      run('timeline.item.reschedule', { id, date: iso })
    },
    [run],
  )

  const reminders = useMemo(() => all.filter((i) => i.remind), [all])
  const overdue = useMemo(() => all.filter((i) => bucketOf(i, today) === 'overdue'), [all, today])
  const todayItems = useMemo(() => all.filter((i) => bucketOf(i, today) === 'today'), [all, today])
  const upcoming = useMemo(() => all.filter((i) => bucketOf(i, today) === 'upcoming'), [all, today])
  const followUps = useMemo(() => followUpsOf([...all], today), [all, today])

  const thisWeek = useMemo(() => {
    const end = addDays(today, 6)
    return all.filter((i) => !i.completedOn && i.date >= today && i.date <= end)
  }, [all, today])

  return useMemo(
    () => ({
      all,
      get,
      forApplication,
      forDay,
      forMonth,
      add,
      update,
      remove,
      toggleDone,
      snooze,
      reschedule,
      reminders,
      overdue,
      today: todayItems,
      upcoming,
      followUps,
      thisWeek,
    }),
    [
      all,
      get,
      forApplication,
      forDay,
      forMonth,
      add,
      update,
      remove,
      toggleDone,
      snooze,
      reschedule,
      reminders,
      overdue,
      todayItems,
      upcoming,
      followUps,
      thisWeek,
    ],
  )
}
