/**
 * L1 — how a dated item READS, with nothing in it that is a colour or an icon.
 *
 * What kind of thing it is called, and how close its date is. Four surfaces ask
 * — the dashboard's week, the glance calendar, the Calendar page and the Vault's
 * reminders — and a fifth on the phone asks the same two questions of the same
 * records.
 *
 * It came out of `src/lib/timeline-visuals.ts`, which is the web app, and which
 * the phone was told to keep in step by copying the file across. What stayed up
 * there is the half that names a renderer — a lucide icon per kind, a Tailwind
 * class per mark — and this is the half that does not. That is the same cut
 * `kg/react/toast.ts` and `src/lib/toast-context.ts` already make.
 *
 * `today` is a parameter, never a module constant. No module under `kg` may
 * import `TODAY` (D26) — the day arrives through `KgProvider`'s `now`, and a
 * mark measured against the fixtures' October in 2027 is a red dot the user
 * cannot explain. Taking it as an argument is also what makes this `core` rather
 * than `react`: nothing here needs a provider, or a hook, or `@/data`.
 */

import { daysBetween } from './dates'
import type { TimelineItem, TimelineKind } from './model'

/**
 * How each kind reads in a legend, a chip or a filter.
 *
 * Held as a full `Record<TimelineKind, string>` rather than derived, so adding a
 * kind to the union is a compile error here rather than an `undefined` printed
 * where a word should be. Insertion order is legend order and is read as such by
 * `TIMELINE_KINDS`.
 */
export const KIND_LABEL: Record<TimelineKind, string> = {
  deadline: 'Deadline',
  interview: 'Interview',
  visit: 'Visit',
  call: 'Call',
  prep: 'Prep',
  admin: 'Admin',
  'follow-up': 'Follow-up',
}

/**
 * Every kind, in the order a legend lists them.
 *
 * Derived from `KIND_LABEL` because that map is the one a platform cannot opt
 * out of: the web's icon map and a phone's would each be a second list to keep
 * in step, and this used to be keyed off the web's icons for exactly that reason
 * — which meant a shared legend order depended on a lucide import.
 */
export const TIMELINE_KINDS = Object.keys(KIND_LABEL) as TimelineKind[]

/**
 * How close a date is, and the only thing on any surface allowed to carry
 * colour: red is past due and nothing else, amber is inside 48 hours and
 * nothing else.
 *
 * This rule had four copies — `Calendar.tsx`, `GlancePanel.tsx`,
 * `OwedThisWeek.tsx` and `lib/priority.ts` — each spelling the same two
 * thresholds against its own union: `'overdue' | 'soon' | 'none'` twice,
 * `'red' | 'amber' | 'gray'` once, and a fourth that also had to say what a
 * completed item looks like. Four copies of a threshold is how the dashboard and
 * the calendar came to disagree about what "overdue" meant, so there is one copy
 * now and the surfaces differ only in the classes they hang off it.
 */
export type DateMark = 'overdue' | 'soon' | 'none'

/** A `DateMark` plus the one state a date cannot tell you about. */
export type Mark = DateMark | 'done'

export function dateMarkOn(today: string, iso: string): DateMark {
  const gap = daysBetween(today, iso)
  if (gap < 0) return 'overdue'
  // Today and tomorrow are the only two days amber may claim.
  return gap <= 1 ? 'soon' : 'none'
}

/**
 * `done` is checked first and outranked by nothing: a finished item is not past
 * due, whatever its date says. Without that the calendar kept a ticked-off
 * reminder's red dot on screen under a toast saying the thing was done.
 *
 * Takes the two fields it reads rather than the whole item, so a caller holding
 * a projection or a draft can ask without constructing one.
 */
export function markOn(today: string, item: Pick<TimelineItem, 'date' | 'completedOn'>): Mark {
  if (item.completedOn) return 'done'
  return dateMarkOn(today, item.date)
}
