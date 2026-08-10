/**
 * Month plumbing for the two calendar grids.
 *
 * The events themselves live on the timeline — this module builds the months
 * they are laid out in and nothing else.
 */

export type CalendarMonth = {
  label: string
  year: number
  month: number
  days: number
  /** Weekday of the 1st, Monday = 0. Weeks start Monday throughout. */
  startsOn: number
  /** Present only on the month containing today. */
  today?: number
}

/** The year/month/day the grids page by. `TODAY_PARTS` in `@/lib/today`. */
export type CalendarDay = { year: number; month: number; day: number }

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
 *
 * `today` is a parameter because this file lives in `src/data`, which is not
 * allowed to read a clock (`check-platform.mjs`). It used to close over the
 * fixtures' pinned October, so the marker sat on 12 October in every month of
 * every year the user paged to, and a caller who only wanted `days` for a clamp
 * still dragged the whole fixture epoch in behind it. Omitting it means "no
 * marker", which is what that caller actually wants.
 */
export function buildMonth(year: number, month: number, today?: CalendarDay): CalendarMonth {
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
    ...(today && year === today.year && month === today.month ? { today: today.day } : {}),
  }
}

/** Steps a year/month pair by whole months, rolling the year over correctly. */
export function stepMonth(year: number, month: number, delta: number) {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
