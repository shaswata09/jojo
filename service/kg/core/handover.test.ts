import { describe, expect, it } from 'vitest'
import { handoverSentence, handoverStatus } from './handover'
import type { Instant } from './model'

const at = (iso: string) => iso as Instant
const NOW = at('2026-08-24T12:00:00.000Z')

describe('handoverStatus', () => {
  it('says nothing has ever been handed over, when nothing has', () => {
    expect(handoverStatus(null, [], NOW)).toEqual({ state: 'never' })
  })

  it('counts only what was written after the handover', () => {
    const status = handoverStatus(
      at('2026-08-18T09:00:00.000Z'),
      [
        { at: at('2026-08-17T10:00:00.000Z') }, // before — already went across
        { at: at('2026-08-19T10:00:00.000Z') },
        { at: at('2026-08-20T10:00:00.000Z') },
      ],
      NOW,
    )
    expect(status).toMatchObject({ state: 'drifted', writes: 2, days: 6 })
  })

  it('is clean when nothing has been written since', () => {
    expect(
      handoverStatus(at('2026-08-22T09:00:00.000Z'), [{ at: at('2026-08-21T09:00:00.000Z') }], NOW),
    ).toMatchObject({ state: 'clean', writes: 0 })
  })

  it('treats one change as drift, because there is no safe threshold', () => {
    expect(
      handoverStatus(at('2026-08-24T09:00:00.000Z'), [{ at: at('2026-08-24T10:00:00.000Z') }], NOW),
    ).toMatchObject({ state: 'drifted', writes: 1, days: 0 })
  })

  it('floors the days, so six and a half never reads as seven', () => {
    // A staleness figure that rounds up reads as older than it is and invites a
    // transfer nobody needed.
    expect(handoverStatus(at('2026-08-18T00:00:00.000Z'), [], NOW)).toMatchObject({ days: 6 })
  })

  it('never reports negative days from a clock that moved backwards', () => {
    expect(handoverStatus(at('2026-08-25T00:00:00.000Z'), [], NOW)).toMatchObject({ days: 0 })
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
