import { AlarmClock, CalendarClock, FileText, Plane, Users, Video } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { daysBetween } from '@/data/timeline'
import type { TimelineItem, TimelineKind } from '@/data/timeline'
import { TODAY } from '@/lib/today'

/**
 * How a dated item looks, wherever it appears.
 *
 * Four surfaces render the same timeline item — the dashboard's week, the
 * glance calendar, the Calendar page and the Vault's reminders — and each used
 * to carry its own copy of these maps against its own narrower kind union. A
 * kind added to `TimelineKind` then compiled everywhere and rendered `undefined`
 * as an icon in whichever copy had been missed.
 */
export const KIND_ICON: Record<TimelineKind, LucideIcon> = {
  deadline: CalendarClock,
  interview: Video,
  visit: Plane,
  call: Users,
  prep: FileText,
  admin: AlarmClock,
  'follow-up': Users,
}

export const KIND_LABEL: Record<TimelineKind, string> = {
  deadline: 'Deadline',
  interview: 'Interview',
  visit: 'Visit',
  call: 'Call',
  prep: 'Prep',
  admin: 'Admin',
  'follow-up': 'Follow-up',
}

/** Derived from the icon map, so a new kind cannot be missed by a legend. */
export const TIMELINE_KINDS = Object.keys(KIND_ICON) as TimelineKind[]

/**
 * How close a date is, and the only thing on any surface allowed to carry
 * colour: red is past due and nothing else, amber is inside 48 hours and
 * nothing else.
 *
 * This rule had four copies — `Calendar.tsx`, `GlancePanel.tsx`,
 * `OwedThisWeek.tsx` and `lib/priority.ts` — each spelling the same two
 * thresholds against its own union: `'overdue' | 'soon' | 'none'` twice,
 * `'red' | 'amber' | 'gray'` once, and a fourth that also had to say what a
 * completed item looks like. Four copies of a threshold is how the dashboard
 * and the calendar came to disagree about what "overdue" meant, so there is one
 * copy now and the surfaces differ only in the classes they hang off it.
 */
export type DateMark = 'overdue' | 'soon' | 'none'

/** A `DateMark` plus the one state a date cannot tell you about. */
export type Mark = DateMark | 'done'

export function dateMark(iso: string): DateMark {
  const gap = daysBetween(TODAY, iso)
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
export function markOf(item: Pick<TimelineItem, 'date' | 'completedOn'>): Mark {
  if (item.completedOn) return 'done'
  return dateMark(item.date)
}

/**
 * The three date colours, shared.
 *
 * Keyed on `DateMark` and not on `Mark`, because `done` is the one entry the
 * surfaces genuinely disagree about — the Calendar route paints a completed
 * item's kind icon `text-success`, the glance panel greys it, and the day-cell
 * dot goes hollow rather than filled. Each spreads these three in and adds its
 * own fourth, so a disagreement has to be written down deliberately.
 */
export const MARK_TEXT: Record<DateMark, string> = {
  overdue: 'text-danger',
  soon: 'text-warning',
  none: 'text-text-3',
}

export const MARK_DOT: Record<DateMark, string> = {
  overdue: 'bg-danger',
  soon: 'bg-warning',
  none: 'bg-text-3',
}
