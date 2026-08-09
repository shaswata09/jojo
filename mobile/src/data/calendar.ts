/**
 * Month plumbing for the two calendar grids.
 *
 * The events themselves live on the timeline — this module builds the months
 * they are laid out in and nothing else.
 */

import { TODAY as TODAY_ISO, partsOf } from '@/data/timeline'

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
 * The mock's fixed "today", in the year/month/day the grids page by.
 *
 * Split out of the timeline's ISO date rather than written twice: as a literal
 * it could disagree with everything measured against `TODAY`, and a calendar
 * whose "today" marker sits on a different day from the overdue count is worse
 * than one with no marker at all.
 */
export const TODAY = (() => {
  const { y, m, d } = partsOf(TODAY_ISO)
  return { year: y, month: m, day: d }
})()

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

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
