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
import { nextInterviewOn } from './use-priority'

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
