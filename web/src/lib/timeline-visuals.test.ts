/**
 * The web binding of the date→colour rule.
 *
 * There were four copies of these two thresholds — `Calendar.tsx`,
 * `GlancePanel.tsx`, `OwedThisWeek.tsx` and `lib/priority.ts` — and none of
 * them was tested, which is how the dashboard and the calendar came to
 * disagree about what "overdue" meant. The rule itself now lives in
 * `@jojo/service/core/timeline-view` and is tested there against a day that is
 * written down; what this file still covers is the part that stayed web-only —
 * that `dateMark` and `markOf` are bound to `TODAY` and not to some other day,
 * and that the two class maps and the icon map cover exactly the keys they are
 * asked for.
 */

import { describe, expect, it } from 'vitest'
import { addDays } from '@/data/timeline'
import { TODAY } from '@/lib/today'
import {
  KIND_ICON,
  MARK_DOT,
  MARK_TEXT,
  TIMELINE_KINDS,
  dateMark,
  markOf,
} from './timeline-visuals'

describe('dateMark', () => {
  it('calls anything before today overdue', () => {
    expect(dateMark(addDays(TODAY, -1))).toBe('overdue')
    expect(dateMark(addDays(TODAY, -30))).toBe('overdue')
  })

  /** "Inside 48 hours" is today and tomorrow, and nothing else may be amber. */
  it('gives amber to today and tomorrow only', () => {
    expect(dateMark(TODAY)).toBe('soon')
    expect(dateMark(addDays(TODAY, 1))).toBe('soon')
    expect(dateMark(addDays(TODAY, 2))).toBe('none')
  })

  it('leaves everything further out neutral', () => {
    expect(dateMark(addDays(TODAY, 3))).toBe('none')
    expect(dateMark(addDays(TODAY, 34))).toBe('none')
  })
})

describe('markOf', () => {
  /**
   * `done` outranks the date and is checked first. Without that the calendar
   * kept a ticked-off reminder's red dot on screen under a toast saying the
   * thing was done.
   */
  it('reads done before it reads the date', () => {
    const overdue = { date: addDays(TODAY, -5) }
    expect(markOf(overdue)).toBe('overdue')
    expect(markOf({ ...overdue, completedOn: addDays(TODAY, -5) })).toBe('done')
    expect(markOf({ date: addDays(TODAY, 9), completedOn: TODAY })).toBe('done')
  })

  /** `completedOn: null` is how the reducer reopens an item — not a completion. */
  it('treats a null completion as not done', () => {
    expect(markOf({ date: addDays(TODAY, -1), completedOn: null })).toBe('overdue')
  })
})

describe('the shared maps', () => {
  /**
   * Keyed on `DateMark`, so every surface's four-key map is these three plus its
   * own `done`. A missing key emits no class at all, which is a mark that
   * silently loses its colour rather than failing.
   */
  it('covers all three date marks and no fourth', () => {
    expect(Object.keys(MARK_TEXT).sort()).toEqual(['none', 'overdue', 'soon'])
    expect(Object.keys(MARK_DOT).sort()).toEqual(['none', 'overdue', 'soon'])
  })

  it('names an icon for every timeline kind', () => {
    for (const kind of TIMELINE_KINDS) expect(KIND_ICON[kind]).toBeDefined()
  })
})
