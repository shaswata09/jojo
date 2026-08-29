/**
 * What "Owed this week" is a list OF, lifted out of the panel that draws it.
 *
 * It lived inside `screens/TodayScreen.tsx` as a `useMemo` body, and D20 means
 * no test in this repo may mount a component — so the split that decides
 * whether a reminder reads as overdue or as due tomorrow was, by construction,
 * unassertable. Two defects shipped inside it and the audit found both:
 *
 *  - `dueCount` read `tomorrow.length`, where `tomorrow` was a module-level
 *    FUNCTION `() => addDays(TODAY, 1)` sitting one keystroke from the list of
 *    items. A function's `length` is its arity, 0, so the hint under the title
 *    counted today and the rest of the week and silently skipped tomorrow —
 *    "2 due" over four rows the user could count for themselves. Both sides are
 *    numbers, so `tsc` had nothing to say.
 *  - the week strip was `useMemo(..., [])` and the groups `useMemo(..., [all])`,
 *    while the day they measure against is a live binding that advances inside
 *    `now()` (`lib/today.ts`). A React Native process keeps one JS context for
 *    days, so past midnight the strip still drew yesterday as today while the
 *    rows beside it had moved.
 *
 * Both are now expressible as an assertion, which is the whole reason this file
 * exists: `owed-week.test.ts` fails on either mutation. The day is a PARAMETER
 * here and is never read from a clock, so a test can turn midnight by hand.
 */

import { addDays, partsOf } from '@jojo/service/data/timeline'
import type { TimelineItem } from '@jojo/service/data/timeline'
import type { ISODate } from '@jojo/service/core/model'

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** One cell of the seven-day strip. */
export type WeekCell = { iso: ISODate; day: number; label: string }

export type OwedGroup = { id: string; label: string; items: TimelineItem[] }

export type OwedWeek = {
  /** Overdue, today, tomorrow, rest — always four, empty ones included. */
  groups: OwedGroup[]
  /** Open items past the end of the week, which the panel shows folded away. */
  later: TimelineItem[]
  doneToday: number
  overdueCount: number
  /**
   * Today plus tomorrow plus the rest of the week — NOT the overdue ones, which
   * the hint counts separately ("3 overdue · 4 due"). Adding them here would
   * report each overdue item twice on the one line that exists to save the user
   * counting the rows themselves.
   */
  dueCount: number
}

/**
 * Seven days starting at `day` — the strip, with `day` itself first.
 *
 * The panel draws cell 0 as today (`isToday = i === 0`), so this function's
 * first element and the caller's idea of the day have to be the same value.
 * Passing it in rather than reading `TODAY` here is what makes that true even
 * when the clock turns between two lines of one render.
 */
export function weekStrip(day: ISODate): WeekCell[] {
  return Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(day, i)
    const { y, m, d } = partsOf(iso)
    // `new Date(y, m - 1, d)` is arithmetic over parts already in hand, not a
    // clock read: local midnight of a date this function was given.
    return { iso, day: d, label: WEEKDAY_SHORT[new Date(y, m - 1, d).getDay()] ?? '' }
  })
}

/**
 * The four groups, what falls past the week, and the three counts in the hint.
 *
 * `all` is every timeline item including completed ones — `doneToday` needs
 * them, and every other line here filters them out first.
 */
export function owedWeek(all: readonly TimelineItem[], day: ISODate): OwedWeek {
  const openItems = all.filter((i) => !i.completedOn)
  const overdue = openItems.filter((i) => i.date < day)
  const today = openItems.filter((i) => i.date === day)
  const nextDay = addDays(day, 1)
  const endOfWeek = addDays(day, 6)
  const tomorrowItems = openItems.filter((i) => i.date === nextDay)
  const rest = openItems.filter((i) => i.date > nextDay && i.date <= endOfWeek)

  return {
    groups: [
      { id: 'overdue', label: 'Overdue', items: overdue },
      { id: 'today', label: 'Today', items: today },
      { id: 'tomorrow', label: 'Tomorrow', items: tomorrowItems },
      { id: 'rest', label: 'Rest of the week', items: rest },
    ],
    later: openItems.filter((i) => i.date > endOfWeek),
    doneToday: all.filter((i) => i.completedOn === day).length,
    overdueCount: overdue.length,
    dueCount: today.length + tomorrowItems.length + rest.length,
  }
}
