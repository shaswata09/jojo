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
import { bucketOf, remindersOf } from './dates'

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

describe('remindersOf', () => {
  /*
   * The Vault's reminders list, and the decision it records.
   *
   * The Vault's other three lists — links, files, snippets — are newest-added
   * first. Reminders are deliberately NOT, and these tests exist so that
   * "finish the job" does not quietly become a regression later.
   *
   * The reasoning is in `remindersOf`. The measurement behind it: sorting these
   * by id descending — which is genuinely "last added", and is exactly what
   * snippets correctly do — renders on the seeded data as exact
   * reverse-chronological inside every bucket, because the timeline fixtures
   * are authored in ascending due-date order and the seed mints ids in fixture
   * order. It put the reminder due in two days at the bottom of Upcoming, under
   * one due in a month, and the least-overdue row at the top of Overdue.
   */
  const remind = (id: string, date: string) => item({ id, date, remind: true })

  it('keeps only reminders', () => {
    const out = remindersOf([
      remind('b', '2026-09-01'),
      item({ id: 'a', date: '2026-09-02', remind: false }),
    ])
    expect(out.map((i) => i.id)).toEqual(['b'])
  })

  it('hands back what it was given, in the order it was given', () => {
    /*
     * The source is the `timeline` projection, already sorted by `compareItems`
     * — date, then all-day, then start time. Re-sorting here would be a second
     * copy of that rule and a second chance to disagree with the calendar about
     * what "next" means.
     */
    const source = [
      remind('id-1', '2026-09-01'),
      remind('id-2', '2026-09-05'),
      remind('id-3', '2026-09-10'),
    ]
    expect(remindersOf(source).map((i) => i.id)).toEqual(['id-1', 'id-2', 'id-3'])
  })

  it('does not put the newest-added on top, which is the deliberate part', () => {
    /*
     * The ids here say the opposite of the dates: `id-3` was written last and is
     * due FIRST. Newest-added-first would lead with it. Due-date order does not,
     * and that is the choice — a reminder's meaning is its date, the rows are
     * grouped by that date, and every row prints it.
     *
     * Written as an explicit refusal rather than left implicit, because
     * "Reminders are the odd one out in the Vault" reads like an oversight and
     * is not one.
     */
    const source = [
      remind('id-3', '2026-09-01'),
      remind('id-1', '2026-09-05'),
      remind('id-2', '2026-09-10'),
    ]
    const out = remindersOf(source).map((i) => i.id)
    expect(out).toEqual(['id-3', 'id-1', 'id-2'])
    const newestAddedFirst = [...source].sort((a, b) => b.id.localeCompare(a.id)).map((i) => i.id)
    expect(out).not.toEqual(newestAddedFirst)
  })

  it('does not reorder what it was given', () => {
    // `.sort` mutates, and the timeline array is shared with the calendar, the
    // week strip and every dated rail. Sorting it in place would reorder all of
    // them from under a list that only meant to reorder itself.
    const source = [remind('b', '2026-09-05'), remind('a', '2026-09-01')]
    remindersOf(source)
    expect(source.map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('is empty for a timeline with no reminders in it', () => {
    expect(remindersOf([item({ remind: false })])).toEqual([])
  })
})
