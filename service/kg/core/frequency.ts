/**
 * Calendar bucketing for "when did you apply" — weeks, months and quarters.
 *
 * All of it was inline in `dashboard/ApplicationFrequency.tsx`, wedged between
 * a rounded-rect path builder and 200 lines of SVG. It is not chart code: it is
 * date arithmetic over the records, and the same buckets are what any other
 * renderer of the same question would need. A phone would draw a different
 * chart over exactly these keys.
 *
 * The concrete task this unblocks: the year rollover in `bucketKeys` — month 13
 * of 2026 relying on `isoOf` to normalise, and the quarter index doing
 * `y * 4 + ceil(m / 3) - 1` — has no test, and could not have had one while it
 * was a closure in a component this codebase does not mount in tests (D20).
 *
 * IT ENDED UP HERE, which is where the paragraph this replaces asked for: beside
 * the date library, which is `core/dates.ts` now. The move happened because the
 * phone needed it — deleting the mobile fork left `StatisticsScreen` reading a
 * frozen `frequencyByPeriod` table that no longer exists, and the alternative to
 * moving this down was a second implementation of the same calendar arithmetic
 * in a second app, which is the exact shape the extraction is deleting.
 * Everything here is pure and clock-free: `TODAY` is the caller's business.
 */

import { addDays, isoOf, partsOf, shortDate } from './dates'
import type { Application, Period } from './model'

/**
 * How far back each period is allowed to run before the axis stops being
 * readable. Anything older is reported in the footnote instead of silently
 * vanishing, which is the failure this panel was built to stop repeating.
 */
export const MAX_BUCKETS: Record<Period, number> = { week: 14, month: 12, quarter: 8 }

/**
 * The date an application counts against.
 *
 * `submittedOn` is the fallback because the seed records carry that and not
 * `appliedOn` — a chart keyed on `appliedOn` alone would have been empty on
 * the demo data, which is the same class of bug as never reading the store.
 */
export const sentOn = (a: Application) => a.appliedOn ?? a.submittedOn

/** Monday of the week `iso` falls in. */
export function weekStart(iso: string) {
  const { y, m, d } = partsOf(iso)
  // getDay() is 0 on Sunday, so Sunday has to reach back six days, not none.
  return isoOf(y, m, d - ((new Date(y, m - 1, d).getDay() + 6) % 7))
}

export function bucketKey(iso: string, period: Period): string {
  const { y, m } = partsOf(iso)
  if (period === 'week') return weekStart(iso)
  if (period === 'month') return `${y}-${String(m).padStart(2, '0')}`
  return `${y}-Q${Math.ceil(m / 3)}`
}

export function bucketLabel(key: string, period: Period): string {
  if (period === 'week') return shortDate(key)
  // 'Oct 1' → 'Oct'. The month names live in `core/dates.ts` and are not
  // exported; copying the array here is exactly how the two would drift apart.
  //
  // Destructured with a default rather than indexed, because this directory
  // compiles under `noUncheckedIndexedAccess` and the web app it moved from did
  // not. `split` always yields at least one element, so the default is
  // unreachable — but writing `[0]!` to say so is the spelling that stops being
  // true the day somebody changes what is being split.
  if (period === 'month') {
    const [monthName = key] = shortDate(`${key}-01`).split(' ')
    return monthName
  }
  return key.slice(5)
}

/**
 * Every bucket between two dates, built from the calendar rather than from the
 * records — a week nobody applied in has to draw a gap. Deriving the axis from
 * the data instead is what turns a quiet fortnight into a straight line.
 *
 * Trimmed to `MAX_BUCKETS` from the recent end, so the caller can report what
 * fell off rather than pretending it was never there.
 */
export function bucketKeys(from: string, to: string, period: Period): string[] {
  const a = partsOf(from)
  const b = partsOf(to)
  const keys: string[] = []

  if (period === 'week') {
    const end = weekStart(to)
    for (let cursor = weekStart(from); cursor <= end; cursor = addDays(cursor, 7)) keys.push(cursor)
  } else if (period === 'month') {
    const months = (b.y - a.y) * 12 + (b.m - a.m)
    // isoOf normalises an overflowing month, so month 13 of 2026 is January 2027.
    for (let i = 0; i <= months; i++) keys.push(bucketKey(isoOf(a.y, a.m + i, 1), 'month'))
  } else {
    const first = a.y * 4 + Math.ceil(a.m / 3) - 1
    const last = b.y * 4 + Math.ceil(b.m / 3) - 1
    for (let i = first; i <= last; i++) keys.push(`${Math.floor(i / 4)}-Q${(i % 4) + 1}`)
  }

  return keys.length > MAX_BUCKETS[period] ? keys.slice(-MAX_BUCKETS[period]) : keys
}
