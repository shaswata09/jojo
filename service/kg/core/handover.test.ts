import { describe, expect, it } from 'vitest'
import { handoverSentence, handoverStatus } from './handover'
import type { Instant } from './model'

const at = (iso: string) => iso as Instant

/**
 * A LOCAL wall-clock moment on the given August day, as the instant a store
 * would have written.
 *
 * These were UTC literals — `at('2026-08-18T09:00:00.000Z')` — and that was
 * fine while `days` was elapsed milliseconds, which no zone can change. `days`
 * counts local midnights now, so a UTC literal names a different calendar day
 * depending on where the machine is: '2026-08-18T00:00:00.000Z' is the 17th in
 * Chicago and the 18th in Tokyo, and a suite that passes here and fails in
 * Honolulu is worse than no suite. Building from local parts pins the calendar
 * day the test means, in every zone.
 */
const on = (day: number, hour: number) => new Date(2026, 7, day, hour).toISOString() as Instant

const NOW = on(24, 12)

describe('handoverStatus', () => {
  it('says nothing has ever been handed over, when nothing has', () => {
    expect(handoverStatus(null, [], NOW)).toEqual({ state: 'never' })
  })

  it('counts only what was written after the handover', () => {
    const status = handoverStatus(
      on(18, 9),
      [
        { at: on(17, 10) }, // before — already went across
        { at: on(19, 10) },
        { at: on(20, 10) },
      ],
      NOW,
    )
    expect(status).toMatchObject({ state: 'drifted', writes: 2, days: 6 })
  })

  it('is clean when nothing has been written since', () => {
    expect(handoverStatus(on(22, 9), [{ at: on(21, 9) }], NOW)).toMatchObject({
      state: 'clean',
      writes: 0,
    })
  })

  it('treats one change as drift, because there is no safe threshold', () => {
    expect(handoverStatus(on(24, 9), [{ at: on(24, 10) }], NOW)).toMatchObject({
      state: 'drifted',
      writes: 1,
      days: 0,
    })
  })

  /*
   * `days` used to be elapsed milliseconds floored to 24-hour blocks, and the
   * test here pinned that: "floors the days, so six and a half never reads as
   * seven", on the measured argument that a staleness figure which rounds up
   * reads as older than it is and invites a transfer nobody needed.
   *
   * The number is spent on calendar words — `handoverSentence` renders 0 as
   * "today" and 1 as "yesterday" — and across a midnight the two measures say
   * different things. Two hours after a transfer made at 23:00, the elapsed
   * count was 0 and the panel said "Last transfer today" about something done
   * the night before. Being vague about a duration is a smaller failure than
   * being wrong about a day, so the count moved to midnights and these two
   * tests hold it there.
   */
  it('counts the midnights, so a transfer made last night reads as yesterday', () => {
    expect(handoverStatus(on(23, 23), [], on(24, 1))).toMatchObject({ days: 1 })
  })

  it('counts no day at all until a midnight has actually passed', () => {
    // Twenty-two hours, no midnight: still today, and this is the half of the
    // old flooring rule that survives intact.
    expect(handoverStatus(on(24, 1), [], on(24, 23))).toMatchObject({ days: 0 })
  })

  it('never reports negative days from a clock that moved backwards', () => {
    expect(handoverStatus(on(25, 0), [], NOW)).toMatchObject({ days: 0 })
  })
})

describe('handoverSentence', () => {
  it('states the drift as a fact rather than a warning', () => {
    const drifted = handoverSentence({
      state: 'drifted',
      at: at('2026-08-18T09:00:00.000Z'),
      days: 6,
      writes: 11,
    })
    expect(drifted).toContain('6 days ago')
    expect(drifted).toContain('11 changes')
    expect(drifted).toContain('that far behind')
    // Working on two devices is normal. No scolding.
    expect(drifted).not.toMatch(/warning|careful|should|must/i)
  })

  it('counts one change as one', () => {
    expect(
      handoverSentence({
        state: 'drifted',
        at: at('2026-08-23T09:00:00.000Z'),
        days: 1,
        writes: 1,
      }),
    ).toContain('one change has been made')
  })

  it('says yesterday and today rather than a count of days', () => {
    expect(
      handoverSentence({ state: 'clean', at: at('2026-08-24T09:00:00.000Z'), days: 0, writes: 0 }),
    ).toContain('today')
    expect(
      handoverSentence({ state: 'clean', at: at('2026-08-23T09:00:00.000Z'), days: 1, writes: 0 }),
    ).toContain('yesterday')
  })

  it('tells a store that has never transferred that it is the only copy', () => {
    expect(handoverSentence({ state: 'never' })).toContain('nothing has a copy')
  })
})
