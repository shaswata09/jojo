import { AlarmClock, CalendarClock, FileText, Plane, Users, Video } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Urgency } from '@/data/seed'
import type { TimelineKind } from '@/data/timeline'

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

export const URGENCY_TEXT: Record<Urgency, string> = {
  red: 'text-danger',
  amber: 'text-warning',
  gray: 'text-text-3',
}

export const URGENCY_DOT: Record<Urgency, string> = {
  red: 'bg-danger',
  amber: 'bg-warning',
  gray: 'bg-text-3',
}
