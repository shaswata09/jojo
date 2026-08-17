/**
 * The year rollover in `bucketKeys`, which had no test and could not have had
 * one.
 *
 * The arithmetic here — month 13 of 2026 leaning on `isoOf` to normalise, and
 * the quarter index computed as `y * 4 + ceil(m / 3) - 1` — spent two waves as a
 * closure inside a 200-line SVG component that this codebase does not mount in
 * tests (D20). Its own header named writing this file as the task the extraction
 * would unblock. The extraction happened for an unrelated reason (the phone's
 * statistics screen lost the frozen table it used to read), so it is written now.
 *
 * Clock-free throughout: every date below is an argument.
 */

import { describe, expect, it } from 'vitest'
import { MAX_BUCKETS, bucketKey, bucketKeys, bucketLabel, weekStart } from './frequency'

describe('bucketKeys across a year boundary', () => {
  /** The case the arithmetic is written for: `isoOf(2026, 13, 1)` is Jan 2027. */
  it('rolls months over into the next year', () => {
    expect(bucketKeys('2026-11-03', '2027-02-09', 'month')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ])
  })

  /** `y * 4 + ceil(m / 3) - 1` has to come back out as the right year AND quarter. */
  it('rolls quarters over into the next year', () => {
    expect(bucketKeys('2026-08-01', '2027-05-01', 'quarter')).toEqual([
      '2026-Q3',
      '2026-Q4',
      '2027-Q1',
      '2027-Q2',
    ])
  })

  it('rolls weeks over into the next year', () => {
    // 2026-12-28 is a Monday, so the sequence steps into January by sevens.
    expect(bucketKeys('2026-12-28', '2027-01-11', 'week')).toEqual([
      '2026-12-28',
      '2027-01-04',
      '2027-01-11',
    ])
  })

  /**
   * A gap is a gap. The axis comes from the calendar, not from the records —
   * deriving it from the data is what turns a quiet fortnight into a straight
   * line with nothing to show it was quiet.
   */
  it('emits every bucket between the ends, including empty ones', () => {
    expect(bucketKeys('2026-01-15', '2026-06-15', 'month')).toHaveLength(6)
  })

  it('keeps the RECENT end when there are more buckets than fit', () => {
    const keys = bucketKeys('2020-01-01', '2026-12-01', 'month')
    expect(keys).toHaveLength(MAX_BUCKETS.month)
    expect(keys.at(-1)).toBe('2026-12')
  })

  /** One bucket, not zero: a single-day range still has to draw a frame. */
  it('gives a single day one bucket', () => {
    expect(bucketKeys('2026-10-12', '2026-10-12', 'month')).toEqual(['2026-10'])
  })
})

describe('weekStart', () => {
  /**
   * Sunday reaches back six days rather than none. `getDay()` is Sunday-first
   * and every week in this app starts on Monday, so the off-by-one here would
   * put a Sunday application in the week that had just ended.
   */
  it('takes Sunday back to the Monday before it', () => {
    expect(weekStart('2026-10-18')).toBe('2026-10-12')
  })

  it('leaves a Monday alone', () => {
    expect(weekStart('2026-10-12')).toBe('2026-10-12')
  })

  it('crosses a month boundary backwards', () => {
    expect(weekStart('2026-11-01')).toBe('2026-10-26')
  })
})

describe('bucketKey and bucketLabel agree on what they are keyed by', () => {
  it('pads a single-digit month so the keys sort as strings', () => {
    expect(bucketKey('2026-03-04', 'month')).toBe('2026-03')
  })

  it('labels a month with its name alone', () => {
    expect(bucketLabel('2026-03', 'month')).toBe('Mar')
  })

  it('labels a quarter without its year', () => {
    expect(bucketLabel(bucketKey('2026-08-01', 'quarter'), 'quarter')).toBe('Q3')
  })
})
