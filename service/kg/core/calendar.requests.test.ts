/**
 * Q044: the calendar's previous and next month arrows work in both directions.
 *
 * Both month grids — the Calendar page and the dashboard's glance card — page
 * with `stepMonth`, and it had no test. The failure worth guarding is the year
 * boundary, where a month index computed by hand goes to 0 or 13.
 */

import { describe, expect, it } from 'vitest'
import { stepMonth } from './calendar'

describe('stepMonth', () => {
  it('goes forward and back one month inside a year', () => {
    expect(stepMonth(2026, 8, 1)).toEqual({ year: 2026, month: 9 })
    expect(stepMonth(2026, 8, -1)).toEqual({ year: 2026, month: 7 })
  })

  it('crosses into the next year going forward', () => {
    expect(stepMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
  })

  it('crosses into the previous year going back', () => {
    expect(stepMonth(2027, 1, -1)).toEqual({ year: 2026, month: 12 })
  })

  it('comes back to where it started after a step each way', () => {
    for (let month = 1; month <= 12; month += 1) {
      const there = stepMonth(2026, month, 1)
      expect(stepMonth(there.year, there.month, -1)).toEqual({ year: 2026, month })
    }
  })
})
