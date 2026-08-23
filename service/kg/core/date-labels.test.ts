/**
 * The five dated readings that had no test at all.
 *
 * `dates.test.ts` covers `bucketOf` and the arithmetic under it. These five —
 * `agoLabel`, `whenLabel`, `timeLabel`, `followUpsOf` and `offerDaysLeft` —
 * were at zero coverage in the service suite while being read on almost every
 * screen in both apps: the vault's "saved 5 days ago", the reminders list's "8
 * days overdue", the calendar's "09:30 – 10:15", the dashboard's follow-up
 * rail and the offer countdown.
 *
 * WHAT THESE ARE BUILT TO CATCH. Every case here is a boundary or a negative:
 * the far side of a cut-off, a date in the wrong direction, an optional field
 * absent, a span that crosses midnight, a filter handed rows it must reject.
 * The happy path of each of these is one line and was never the risk — the risk
 * is a comparison written `<` where it should be `<=`, which reads correctly in
 * every example anyone would think to try by hand.
 *
 * `today` is passed explicitly everywhere, as the module requires. Nothing here
 * reads a clock, so nothing here can start failing at midnight.
 */

import { describe, expect, it } from 'vitest'
import type { Offer, TimelineItem } from './model'
import { agoLabel, followUpsOf, offerDaysLeft, timeLabel, whenLabel } from './dates'

const TODAY = '2026-08-18'

/** See `dates.test.ts` for why the cast is load-bearing here. */
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

/* -------------------------------- agoLabel -------------------------------- */

describe('agoLabel', () => {
  it('names today and yesterday rather than counting them', () => {
    expect(agoLabel(TODAY, TODAY)).toBe('today')
    expect(agoLabel('2026-08-17', TODAY)).toBe('yesterday')
  })

  it('counts days up to the fortnight cut-off, and prints a date past it', () => {
    // The boundary is the whole law: 13 days is a count, 14 is a date. Both
    // sides are asserted because `<` and `<=` differ by exactly this row and
    // read identically at every other value.
    expect(agoLabel('2026-08-06', TODAY)).toBe('12 days ago')
    expect(agoLabel('2026-08-05', TODAY)).toBe('13 days ago')
    expect(agoLabel('2026-08-04', TODAY)).toBe('Aug 4')
    expect(agoLabel('2026-08-03', TODAY)).toBe('Aug 3')
  })

  it('prints a plain date for a FUTURE day, because nothing is "ago"', () => {
    // The negative-gap branch. Without it this returns "-3 days ago", which is
    // the shape a naive implementation produces and nobody would type by hand.
    expect(agoLabel('2026-08-21', TODAY)).toBe('Aug 21')
    expect(agoLabel('2026-12-25', TODAY)).toBe('Dec 25')
  })

  it('counts backwards across a month end and a year end', () => {
    expect(agoLabel('2026-08-01', '2026-08-08')).toBe('7 days ago')
    expect(agoLabel('2025-12-31', '2026-01-02')).toBe('2 days ago')
    // Past the cut-off the year is dropped, which is the deliberate cost of a
    // short label: 'Dec 20' does not say which December.
    expect(agoLabel('2025-12-20', '2026-01-10')).toBe('Dec 20')
  })
})

/* ------------------------------- whenLabel -------------------------------- */

describe('whenLabel', () => {
  it('says Today and Tomorrow rather than counting them', () => {
    expect(whenLabel(item({ date: TODAY }), TODAY)).toBe('Today')
    expect(whenLabel(item({ date: '2026-08-19' }), TODAY)).toBe('Tomorrow')
  })

  it('counts forward past tomorrow', () => {
    expect(whenLabel(item({ date: '2026-08-20' }), TODAY)).toBe('in 2 days')
    expect(whenLabel(item({ date: '2026-09-18' }), TODAY)).toBe('in 31 days')
  })

  it('singularises one day overdue rather than saying "1 days"', () => {
    // The branch that exists only for grammar, and the one a refactor drops.
    expect(whenLabel(item({ date: '2026-08-17' }), TODAY)).toBe('1 day overdue')
    expect(whenLabel(item({ date: '2026-08-16' }), TODAY)).toBe('2 days overdue')
  })

  it('reports a completed item in the past tense whatever its own date said', () => {
    // A completed item is done even if its date is in the future — the
    // completion branch has to win before the gap is ever computed.
    const done = item({ date: '2026-12-01', completedOn: '2026-08-17' })
    expect(whenLabel(done, TODAY)).toBe('Completed yesterday')
  })

  it('uses one vocabulary for a completion far in the past', () => {
    // The bug named in the source: completed items used to jump from
    // "yesterday" straight to a bare date, so three days ago and three weeks
    // ago rendered in the same shape.
    expect(whenLabel(item({ completedOn: '2026-08-15' }), TODAY)).toBe('Completed 3 days ago')
    expect(whenLabel(item({ completedOn: '2026-07-20' }), TODAY)).toBe('Completed Jul 20')
    expect(whenLabel(item({ completedOn: TODAY }), TODAY)).toBe('Completed today')
  })
})

/* ------------------------------- timeLabel -------------------------------- */

describe('timeLabel', () => {
  it('is null for an all-day item', () => {
    expect(timeLabel(item({ allDay: true, startMins: 540 }))).toBeNull()
  })

  it('is null when there is no start time, all-day flag or not', () => {
    // Both halves of the guard. An item with `allDay: false` and no start is
    // not a rendering error, it is an item nobody has given a time to.
    expect(timeLabel(item({ allDay: false }))).toBeNull()
    expect(timeLabel(item())).toBeNull()
  })

  it('prints just the start when there is no duration', () => {
    expect(timeLabel(item({ allDay: false, startMins: 570 }))).toBe('09:30')
  })

  it('prints a span when there is one', () => {
    expect(timeLabel(item({ allDay: false, startMins: 570, durationMins: 45 }))).toBe(
      '09:30 – 10:15',
    )
  })

  it('pads single digits on both sides of the span', () => {
    // 09:05, not 9:5. The pad is easy to apply to the hour and forget on the
    // minute, and 9:05 reads plausibly enough to survive a glance.
    expect(timeLabel(item({ allDay: false, startMins: 545, durationMins: 10 }))).toBe(
      '09:05 – 09:15',
    )
    expect(timeLabel(item({ allDay: false, startMins: 0, durationMins: 60 }))).toBe('00:00 – 01:00')
  })

  it('wraps an end time past midnight rather than printing a 24th hour', () => {
    // 23:30 for an hour ends at 00:30, not 24:30. The modulo in `clock` is what
    // does it, and a late interview is the one real case that reaches it.
    expect(timeLabel(item({ allDay: false, startMins: 1410, durationMins: 60 }))).toBe(
      '23:30 – 00:30',
    )
  })

  it('treats a zero duration as no duration and prints only the start', () => {
    // `durationMins: 0` is falsy, so it takes the same branch as absent. Pinned
    // because it is the kind of thing a `!== undefined` refactor would change
    // into '09:30 – 09:30'.
    expect(timeLabel(item({ allDay: false, startMins: 570, durationMins: 0 }))).toBe('09:30')
  })
})

/* ------------------------------ followUpsOf ------------------------------- */

describe('followUpsOf', () => {
  const followUp = (over: Partial<TimelineItem> = {}) =>
    item({ kind: 'follow-up', remind: true, ...over })

  it('keeps a follow-up due today or earlier', () => {
    const rows = [followUp({ id: 'a', date: TODAY }), followUp({ id: 'b', date: '2026-08-01' })]
    expect(followUpsOf(rows, TODAY).map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('rejects a follow-up dated in the future', () => {
    // The load-bearing case from the source: a chase filed for next month used
    // to count as due today, land on the rail in red, and be clearable only by
    // ticking off a nudge nobody had sent.
    expect(followUpsOf([followUp({ date: '2026-09-18' })], TODAY)).toEqual([])
    // And the boundary beside it — tomorrow is not due.
    expect(followUpsOf([followUp({ date: '2026-08-19' })], TODAY)).toEqual([])
  })

  it('rejects a follow-up already ticked off', () => {
    expect(followUpsOf([followUp({ date: '2026-08-01', completedOn: '2026-08-02' })], TODAY)).toEqual(
      [],
    )
  })

  it('rejects a dated item of any other kind', () => {
    // An overdue deadline is overdue; it is not a follow-up, and this panel is
    // titled "Follow-ups due".
    const others = [
      item({ kind: 'deadline', date: '2026-08-01' }),
      item({ kind: 'interview', date: '2026-08-01' }),
    ]
    expect(followUpsOf(others, TODAY)).toEqual([])
  })

  it('is empty for an empty list rather than throwing', () => {
    expect(followUpsOf([], TODAY)).toEqual([])
  })
})

/* ----------------------------- offerDaysLeft ------------------------------ */

describe('offerDaysLeft', () => {
  const offer = (respondBy: string) => ({ respondBy }) as Offer

  it('counts the days remaining', () => {
    expect(offerDaysLeft(offer('2026-08-25'), TODAY)).toBe(7)
  })

  it('is zero on the day itself, which is not the same as expired', () => {
    expect(offerDaysLeft(offer(TODAY), TODAY)).toBe(0)
  })

  it('goes negative once the date has passed, so an expired offer reads expired', () => {
    // The whole reason the return is a signed number rather than a clamped one.
    expect(offerDaysLeft(offer('2026-08-17'), TODAY)).toBe(-1)
    expect(offerDaysLeft(offer('2026-07-18'), TODAY)).toBe(-31)
  })

  it('counts across a year end', () => {
    expect(offerDaysLeft(offer('2027-01-01'), '2026-12-30')).toBe(2)
  })
})
