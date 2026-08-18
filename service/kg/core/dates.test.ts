/**
 * `bucketOf`, and the ordering inside it.
 *
 * It had eleven production call sites across both apps — web's sidebar badge
 * and mobile's tab badge, both Reminders tools, the snooze menu, the dates
 * panel, the item form, the palette and the More screen — and no test at all.
 * Every one of the four mutations below passed the whole 697-test suite, so
 * the branch order that decides whether a finished task reads as overdue was
 * held up by nothing.
 */

import { describe, expect, it } from 'vitest'
import type { TimelineItem } from './model'
import { bucketOf } from './dates'

const TODAY = '2026-08-18'

/*
 * The cast is load-bearing under `exactOptionalPropertyTypes`. Spreading a
 * `Partial<TimelineItem>` can produce `allDay: undefined`, which that flag
 * treats as a different type from the key being absent, so the spread does not
 * typecheck against `TimelineItem` however complete the base is.
 */
const item = (over: Partial<TimelineItem> = {}): TimelineItem =>
  ({
    id: 'item:t1',
    title: 'Submit to Stripe',
    date: TODAY,
    kind: 'deadline',
    urgency: 'amber',
    remind: true,
    ...over,
  }) as TimelineItem

describe('bucketOf', () => {
  it('reads a date before today as overdue', () => {
    expect(bucketOf(item({ date: '2026-08-17' }), TODAY)).toBe('overdue')
  })

  it('reads today as today, not as upcoming', () => {
    expect(bucketOf(item({ date: TODAY }), TODAY)).toBe('today')
  })

  it('reads a date after today as upcoming', () => {
    expect(bucketOf(item({ date: '2026-08-19' }), TODAY)).toBe('upcoming')
  })

  /**
   * The branch order, and the reason it is first.
   *
   * A completed item is `done` whatever its date says. Checking `overdue`
   * ahead of `completedOn` would mark every task finished after its due date
   * as overdue forever — and the seeded demo has exactly that shape, so the
   * badge would count work the user had already cleared. That is the failure
   * the ordering exists to prevent, and it is why this is asserted with a past
   * date rather than a future one.
   */
  it('calls a completed item done even when its date has passed', () => {
    expect(bucketOf(item({ date: '2026-01-01', completedOn: '2026-01-05' }), TODAY)).toBe('done')
  })

  it('calls a completed item done even when it is due today', () => {
    expect(bucketOf(item({ date: TODAY, completedOn: TODAY }), TODAY)).toBe('done')
  })

  it('calls a completed item done even when it is not due yet', () => {
    expect(bucketOf(item({ date: '2026-12-31', completedOn: TODAY }), TODAY)).toBe('done')
  })

  /**
   * Comparison is lexicographic on 'YYYY-MM-DD', never a Date.
   *
   * `new Date('2026-08-18')` parses as UTC midnight, so west of Greenwich
   * `getDate()` answers the 17th — a date that shifts by one silently. ISO
   * strings sort correctly as text, which is why the boundary below holds in
   * every zone rather than only in the one the test happens to run in.
   */
  it('puts the boundaries on the right side', () => {
    expect(bucketOf(item({ date: '2026-08-17' }), TODAY)).toBe('overdue')
    expect(bucketOf(item({ date: '2026-08-18' }), TODAY)).toBe('today')
    expect(bucketOf(item({ date: '2026-08-19' }), TODAY)).toBe('upcoming')
  })

  it('compares across a month and a year end', () => {
    expect(bucketOf(item({ date: '2026-07-31' }), '2026-08-01')).toBe('overdue')
    expect(bucketOf(item({ date: '2027-01-01' }), '2026-12-31')).toBe('upcoming')
  })
})
