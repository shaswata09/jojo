/**
 * The date→colour rule, against a day that is written down.
 *
 * `lib/timeline-visuals.test.ts` tests the same two thresholds through the web
 * binding, which reads the wall clock and therefore has to build its dates from
 * it. This one pins the day instead — which is the point of `today` being an
 * argument, and it is the version a phone or an Electron shell can run without
 * a `src/lib` in the tree at all.
 */

import { describe, expect, it } from 'vitest'
import { KIND_LABEL, TIMELINE_KINDS, dateMarkOn, markOn } from './timeline-view'

const TODAY = '2026-08-15'

describe('dateMarkOn', () => {
  it('calls anything before the given day overdue', () => {
    expect(dateMarkOn(TODAY, '2026-08-14')).toBe('overdue')
    expect(dateMarkOn(TODAY, '2025-12-31')).toBe('overdue')
  })

  /** "Inside 48 hours" is today and tomorrow, and nothing else may be amber. */
  it('gives amber to today and tomorrow only', () => {
    expect(dateMarkOn(TODAY, '2026-08-15')).toBe('soon')
    expect(dateMarkOn(TODAY, '2026-08-16')).toBe('soon')
    expect(dateMarkOn(TODAY, '2026-08-17')).toBe('none')
  })

  // Across a month and a year end, because the gap is whole days rather than a
  // string comparison and the two boundaries are where that stops being obvious.
  it('counts across a month and a year boundary', () => {
    expect(dateMarkOn('2026-08-31', '2026-09-01')).toBe('soon')
    expect(dateMarkOn('2026-12-31', '2027-01-01')).toBe('soon')
    expect(dateMarkOn('2027-01-01', '2026-12-31')).toBe('overdue')
  })
})

describe('markOn', () => {
  /**
   * `done` outranks the date and is checked first. Without that the calendar
   * kept a ticked-off reminder's red dot on screen under a toast saying the
   * thing was done.
   */
  it('reads done before it reads the date', () => {
    expect(markOn(TODAY, { date: '2026-08-10' })).toBe('overdue')
    expect(markOn(TODAY, { date: '2026-08-10', completedOn: '2026-08-10' })).toBe('done')
    expect(markOn(TODAY, { date: '2026-08-24', completedOn: TODAY })).toBe('done')
  })

  /** `completedOn: null` is how an item is reopened — not a completion. */
  it('treats a null completion as not done', () => {
    expect(markOn(TODAY, { date: '2026-08-14', completedOn: null })).toBe('overdue')
  })
})

describe('the kind vocabulary', () => {
  /**
   * Legend order, which several surfaces read positionally. Pinned because it
   * used to be `Object.keys(KIND_ICON)` and moving the derivation to
   * `KIND_LABEL` had to not reorder it.
   */
  it('lists every kind in legend order', () => {
    expect(TIMELINE_KINDS).toEqual([
      'deadline',
      'interview',
      'visit',
      'call',
      'prep',
      'admin',
      'follow-up',
    ])
  })

  it('names every kind it lists', () => {
    for (const kind of TIMELINE_KINDS) expect(KIND_LABEL[kind]).toBeTruthy()
  })
})
