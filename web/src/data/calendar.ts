import type { EventKind, Urgency } from '@/data/seed'

export type CalendarEvent = {
  id: string
  /** 1-indexed month, matching the `CalendarMonth.month` it belongs to. */
  month: number
  day: number
  title: string
  detail: string
  kind: EventKind
  urgency: Urgency
}

export type CalendarMonth = {
  label: string
  year: number
  month: number
  days: number
  /** Weekday of the 1st, Monday = 0. Weeks start Monday throughout. */
  startsOn: number
  /** Present only on the month containing the mock's "today". */
  today?: number
}

/**
 * The mock's fixed "today". Pinned so the demo never drifts: October the 1st
 * 2026 is a Thursday, which puts the 12th on a Monday and lines the calendar up
 * with the dashboard's week strip.
 */
export const TODAY = { year: 2026, month: 10, day: 12 } as const

/** The year the seeded events belong to. They carry a month but no year. */
export const EVENT_YEAR = 2026

export const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/**
 * Builds any month on demand, so the calendar can be paged rather than limited
 * to a hand-written list. The two months that used to be literals came out of
 * this identically — verified against October and November 2026 — so paging
 * costs no fidelity.
 */
export function buildMonth(year: number, month: number): CalendarMonth {
  // Day 0 of the following month is the last day of this one.
  const days = new Date(year, month, 0).getDate()
  // getDay() is Sunday-first; the whole app starts weeks on Monday.
  const startsOn = (new Date(year, month - 1, 1).getDay() + 6) % 7

  return {
    label: MONTH_LABELS[month - 1],
    year,
    month,
    days,
    startsOn,
    ...(year === TODAY.year && month === TODAY.month ? { today: TODAY.day } : {}),
  }
}

/** Steps a year/month pair by whole months, rolling the year over correctly. */
export function stepMonth(year: number, month: number, delta: number) {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/** The two months the seed data covers. Derived, so there is one definition. */
export const months: CalendarMonth[] = [buildMonth(2026, 10), buildMonth(2026, 11)]

export const calendarEvents: CalendarEvent[] = [
  {
    id: 'ut-prep',
    month: 10,
    day: 12,
    title: 'Finalize UT Austin statements',
    detail: 'Research, teaching and diversity',
    kind: 'prep',
    urgency: 'red',
  },
  {
    id: 'advisor',
    month: 10,
    day: 13,
    title: 'Advisor sync',
    detail: 'Chase the third reference letter',
    kind: 'call',
    urgency: 'amber',
  },
  {
    id: 'ut-austin',
    month: 10,
    day: 15,
    title: 'UT Austin — CS',
    detail: 'Application deadline',
    kind: 'deadline',
    urgency: 'red',
  },
  {
    id: 'stripe-cv',
    month: 10,
    day: 16,
    title: 'Tailor CV for Stripe',
    detail: 'Assistant can draft from the posting',
    kind: 'prep',
    urgency: 'gray',
  },
  {
    id: 'stripe',
    month: 10,
    day: 18,
    title: 'Stripe — ML engineer',
    detail: 'Application deadline',
    kind: 'deadline',
    urgency: 'amber',
  },
  {
    id: 'tamu',
    month: 10,
    day: 22,
    title: 'Texas A&M — ECE',
    detail: 'Application deadline',
    kind: 'deadline',
    urgency: 'gray',
  },
  {
    id: 'rice-draft',
    month: 10,
    day: 24,
    title: 'Draft Rice statements',
    detail: 'Statistics position',
    kind: 'prep',
    urgency: 'gray',
  },
  {
    id: 'texas-tech-zoom',
    month: 10,
    day: 28,
    title: 'Texas Tech — committee Zoom',
    detail: '45 minutes',
    kind: 'interview',
    urgency: 'amber',
  },
  {
    id: 'stripe-onsite',
    month: 10,
    day: 30,
    title: 'Stripe — onsite',
    detail: '5 rounds',
    kind: 'interview',
    urgency: 'amber',
  },
  {
    id: 'rice',
    month: 11,
    day: 1,
    title: 'Rice — Statistics',
    detail: 'Application deadline',
    kind: 'deadline',
    urgency: 'red',
  },
  {
    id: 'uh-rehearse',
    month: 11,
    day: 3,
    title: 'Rehearse UH job talk',
    detail: 'Full run-through with the group',
    kind: 'prep',
    urgency: 'amber',
  },
  {
    id: 'uh-visit',
    month: 11,
    day: 6,
    title: 'UH — campus visit',
    detail: 'Job talk and meetings',
    kind: 'visit',
    urgency: 'amber',
  },
  {
    id: 'baylor-offer',
    month: 11,
    day: 15,
    title: 'Baylor — respond to offer',
    detail: 'Decision deadline',
    kind: 'deadline',
    urgency: 'red',
  },
  {
    id: 'unt',
    month: 11,
    day: 20,
    title: 'UNT — Assistant professor, CS',
    detail: 'Application deadline',
    kind: 'deadline',
    urgency: 'gray',
  },
]

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
