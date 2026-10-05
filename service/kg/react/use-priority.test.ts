/**
 * Which interview the deck's third card is about.
 *
 * `usePriorityActions` cannot be rendered here — nothing in this package renders
 * (D20) — so the choice it makes is a module-level function and this file drives
 * it directly, the way `use-pipelines.test.ts` drives the round.
 *
 * The bug these hold shut was silent in the way that matters: the card was
 * always populated and always looked right. It named an interview-stage
 * application chosen by CREATION ORDER, so a record interviewed in three months
 * kept the card while an interview tomorrow appeared on no card at all — and
 * nothing on screen said which of the two it had picked or why.
 */

import { describe, expect, it } from 'vitest'
import type { Application, TimelineItem } from '../core/model'
import { chronological, nextInterviewOn, overdueApplicationsOn, type PriorityAction } from './use-priority'

const TODAY = '2026-08-28'

const app = (id: string, org: string, stage: Application['stage'] = 'interview'): Application => ({
  id,
  org,
  role: 'Engineer',
  note: '',
  roleTag: 'Engineering',
  stage,
  lastAction: 'Interview booked',
  daysAgo: 1,
})

const interview = (
  id: string,
  date: string,
  applicationIds: string[],
  extra: Partial<TimelineItem> = {},
): TimelineItem => ({
  id,
  title: 'Interview',
  date,
  allDay: true,
  kind: 'interview',
  urgency: 'gray',
  applicationIds,
  remind: false,
  ...extra,
})

describe('nextInterviewOn', () => {
  it('picks the nearest interview, not the oldest application', () => {
    // `applications` arrives creation-ordered from the projection, so the record
    // interviewed in November is FIRST. That order is what the deck used to
    // follow, and it is the whole defect.
    const older = app('app:old', 'Faraway Inc')
    const newer = app('app:new', 'Tomorrow Ltd')
    const items = [
      interview('item:soon', '2026-08-29', ['app:new']),
      interview('item:far', '2026-11-30', ['app:old']),
    ]

    const picked = nextInterviewOn(TODAY, [older, newer], items)

    expect(picked?.application).toBe(newer)
    expect(picked?.event?.id).toBe('item:soon')
  })

  it('reads the same list in either order — the answer is the date, not the position', () => {
    const older = app('app:old', 'Faraway Inc')
    const newer = app('app:new', 'Tomorrow Ltd')
    const soon = interview('item:soon', '2026-08-29', ['app:new'])
    const far = interview('item:far', '2026-11-30', ['app:old'])

    // Reversed on both axes. A selector that reads position rather than date
    // answers differently here; this one must not.
    expect(nextInterviewOn(TODAY, [newer, older], [far, soon])?.application).toBe(newer)
    expect(nextInterviewOn(TODAY, [older, newer], [soon, far])?.application).toBe(newer)
  })

  it('counts today as upcoming and yesterday as not', () => {
    const yesterday = app('app:yesterday', 'Already Happened')
    const todayApp = app('app:today', 'This Morning')
    const items = [
      interview('item:yesterday', '2026-08-27', ['app:yesterday']),
      interview('item:today', TODAY, ['app:today']),
    ]

    expect(nextInterviewOn(TODAY, [yesterday, todayApp], items)?.application).toBe(todayApp)
  })

  it('ignores an interview already ticked off', () => {
    const done = app('app:done', 'Done With It')
    const upcoming = app('app:next', 'Still To Come')
    const items = [
      // Sooner, and completed — so it is history, not preparation.
      interview('item:done', '2026-08-29', ['app:done'], { completedOn: '2026-08-29' }),
      interview('item:next', '2026-09-04', ['app:next']),
    ]

    expect(nextInterviewOn(TODAY, [done, upcoming], items)?.event?.id).toBe('item:next')
  })

  it('ignores a dated interview whose application has moved on from the stage', () => {
    // The event survives a stage change — an interview that happened, on a
    // record now at offer. It must not claim a card titled "Prepare for".
    const offered = app('app:offer', 'Offered', 'offer')
    const stillInterviewing = app('app:interview', 'Interviewing')
    const items = [
      interview('item:offer', '2026-08-29', ['app:offer']),
      interview('item:interview', '2026-09-10', ['app:interview']),
    ]

    expect(nextInterviewOn(TODAY, [offered, stillInterviewing], items)?.application).toBe(
      stillInterviewing,
    )
  })

  it('keeps the same day in the order the projection chose', () => {
    // `compareItems` puts an all-day item above a timed one on the same date, so
    // the first match at a date wins and the scan must not overwrite it.
    const a = app('app:a', 'All Day')
    const b = app('app:b', 'At Two')
    const items = [
      interview('item:allday', '2026-08-29', ['app:a']),
      interview('item:timed', '2026-08-29', ['app:b'], { allDay: false, startMins: 840 }),
    ]

    expect(nextInterviewOn(TODAY, [b, a], items)?.event?.id).toBe('item:allday')
  })

  it('still offers the stage-set record when nothing is dated ahead of it', () => {
    // The "Date the X interview" card, and the reason the tail keeps the old
    // creation-order behaviour rather than returning nothing.
    const undated = app('app:undated', 'No Date Yet')

    const picked = nextInterviewOn(TODAY, [undated], [])

    expect(picked?.application).toBe(undated)
    expect(picked?.event).toBeUndefined()
  })

  it('still offers a past interview when that is all there is', () => {
    const lapsed = app('app:lapsed', 'Last Month')
    const items = [interview('item:lapsed', '2026-07-30', ['app:lapsed'])]

    const picked = nextInterviewOn(TODAY, [lapsed], items)

    // Not silently dropped: the card reads "N days overdue", which is the
    // reading that gets somebody to record what happened.
    expect(picked?.event?.id).toBe('item:lapsed')
  })

  it('is about interviews only — a nearer deadline on the same record is not one', () => {
    /*
     * Both halves of the card read "interview": the headline is "Prepare for the
     * X interview" and the timing is the event's own date. A timeline item filed
     * under an interview-stage application is very often NOT an interview — a
     * take-home deadline, a prep block, an admin chase — and those cluster in
     * the days before the interview, so the nearest item under such a record is
     * more likely to be one of them than the interview itself.
     *
     * Written after mutation testing: deleting `item.kind !== 'interview'` from
     * the scan left all nine of the tests above passing, because none of them
     * had a non-interview item in the list at all. The card would then have
     * announced "Prepare for the Acme interview · Tomorrow" over a take-home
     * deadline, and been off by five days about the interview it named.
     */
    const a = app('app:acme', 'Acme')
    const items = [
      interview('item:takehome', '2026-08-29', ['app:acme'], {
        kind: 'deadline',
        title: 'Take-home due',
      }),
      interview('item:interview', '2026-09-03', ['app:acme']),
    ]

    expect(nextInterviewOn(TODAY, [a], items)?.event?.id).toBe('item:interview')
  })

  it('offers no event rather than the wrong one when the record has only other items', () => {
    // The tail has the same rule as the scan and needed its own case: the same
    // deleted filter, in the fallback, put a prep block on a card that says
    // "Date the X interview" — which is a card telling the user to book
    // something, dated by an event that is not it.
    const a = app('app:acme', 'Acme')
    const items = [
      interview('item:prep', '2026-07-20', ['app:acme'], { kind: 'prep', title: 'Read the JD' }),
    ]

    const picked = nextInterviewOn(TODAY, [a], items)

    expect(picked?.application).toBe(a)
    expect(picked?.event).toBeUndefined()
  })

  it('has no card at all when no application is at interview stage', () => {
    const submitted = app('app:submitted', 'Submitted', 'submitted')
    const items = [interview('item:stray', '2026-08-29', ['app:submitted'])]

    expect(nextInterviewOn(TODAY, [submitted], items)).toBeUndefined()
    expect(nextInterviewOn(TODAY, [], items)).toBeUndefined()
  })
})

describe('overdueApplicationsOn', () => {
  const item = (id: string, date: string, applicationIds: string[], extra: Partial<TimelineItem> = {}) =>
    interview(id, date, applicationIds, { kind: 'deadline', title: 'Application deadline', ...extra })

  it('finds an application whose deadline passed — the card the deck never had', () => {
    const rice = app('app:rice', 'Rice', 'draft')
    const out = overdueApplicationsOn(TODAY, [rice], [item('d1', '2026-08-25', ['app:rice'])])
    expect(out.map((o) => [o.application.org, o.item.id])).toEqual([['Rice', 'd1']])
  })

  it('does not count today, the future, or anything already done', () => {
    const a = app('app:a', 'A', 'draft')
    const out = overdueApplicationsOn(TODAY, [a], [
      item('today', TODAY, ['app:a']),
      item('later', '2026-09-10', ['app:a']),
      item('done', '2026-08-01', ['app:a'], { completedOn: '2026-08-02' }),
    ])
    expect(out).toEqual([])
  })

  it('leaves follow-ups to the panel that already lists them', () => {
    const a = app('app:a', 'A', 'submitted')
    const out = overdueApplicationsOn(TODAY, [a], [item('f', '2026-08-20', ['app:a'], { kind: 'follow-up' })])
    expect(out).toEqual([])
  })

  it('leaves closed applications out', () => {
    const a = app('app:a', 'A', 'closed')
    expect(overdueApplicationsOn(TODAY, [a], [item('d', '2026-08-20', ['app:a'])])).toEqual([])
  })

  it('gives one card per application, about its oldest late item', () => {
    const a = app('app:a', 'A', 'interview')
    const out = overdueApplicationsOn(TODAY, [a], [
      item('call', '2026-08-26', ['app:a'], { kind: 'call' }),
      item('deadline', '2026-08-10', ['app:a']),
    ])
    expect(out.map((o) => o.item.id)).toEqual(['deadline'])
  })

  it('orders the most late first, keeping the applications\' order on a tie', () => {
    const [a, b, c] = [app('app:a', 'A', 'draft'), app('app:b', 'B', 'draft'), app('app:c', 'C', 'draft')]
    const out = overdueApplicationsOn(TODAY, [a, b, c], [
      item('ia', '2026-08-20', ['app:a']),
      item('ib', '2026-08-01', ['app:b']),
      item('ic', '2026-08-20', ['app:c']),
    ])
    expect(out.map((o) => o.application.org)).toEqual(['B', 'A', 'C'])
  })

  it('lets one late item make every application it is about overdue', () => {
    const [a, b] = [app('app:a', 'A', 'draft'), app('app:b', 'B', 'draft')]
    const out = overdueApplicationsOn(TODAY, [a, b], [item('shared', '2026-08-20', ['app:a', 'app:b'])])
    expect(out.map((o) => o.application.org)).toEqual(['A', 'B'])
  })

  it('skips what another card already claims, falling back to the next late item', () => {
    const offered = app('app:o', 'Offered', 'offer')
    const a = app('app:a', 'A', 'interview')
    const out = overdueApplicationsOn(
      TODAY,
      [offered, a],
      [
        item('od', '2026-08-01', ['app:o']),
        item('past-interview', '2026-08-15', ['app:a'], { kind: 'interview' }),
        item('older-prep', '2026-08-20', ['app:a'], { kind: 'prep' }),
      ],
      { applicationIds: new Set(['app:o']), itemIds: new Set(['past-interview']) },
    )
    expect(out.map((o) => [o.application.org, o.item.id])).toEqual([['A', 'older-prep']])
  })
})

describe('chronological', () => {
  const card = (id: string, date?: string): PriorityAction => ({
    id,
    kindLabel: 'X',
    headline: id,
    context: '',
    timing: '',
    urgency: 'none',
    ...(date === undefined ? {} : { date }),
    actions: [],
  })
  const ids = (cards: PriorityAction[]) => cards.map((c) => c.id)

  it('lays the deck out along time, the latest last', () => {
    // The hook's own order: offer, overdue, deadline, interview.
    const deck = [card('offer', '2026-11-07'), card('overdue', '2026-09-28'), card('deadline', '2026-10-07'), card('interview', '2026-10-22')]
    expect(ids(chronological(deck))).toEqual(['overdue', 'deadline', 'interview', 'offer'])
  })

  it('puts an undated card after every dated one', () => {
    expect(ids(chronological([card('undated'), card('a', '2026-10-01'), card('b', '2026-09-01')]))).toEqual(['b', 'a', 'undated'])
  })

  it('keeps the hook order on equal dates and among undated cards', () => {
    expect(ids(chronological([card('offer', '2026-10-01'), card('deadline', '2026-10-01')]))).toEqual(['offer', 'deadline'])
    expect(ids(chronological([card('u1'), card('u2')]))).toEqual(['u1', 'u2'])
  })

  it('does not reorder the array it was given', () => {
    const deck = [card('late', '2026-12-01'), card('early', '2026-01-01')]
    chronological(deck)
    expect(ids(deck)).toEqual(['late', 'early'])
  })
})
