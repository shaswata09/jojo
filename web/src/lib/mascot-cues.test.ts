import { describe, expect, it } from 'vitest'
import { ADVANCE_GESTURES, advanceGesture, isAdvance } from './mascot-cues'
import { POSE_MS } from './mascot-context'

describe('what counts as moving forward', () => {
  it('is a later column, one step or several', () => {
    expect(isAdvance('draft', 'submitted')).toBe(true)
    expect(isAdvance('submitted', 'screen')).toBe(true)
    expect(isAdvance('screen', 'interview')).toBe(true)
    expect(isAdvance('interview', 'offer')).toBe(true)
    // A drag can cross two columns at once; that is still forward.
    expect(isAdvance('draft', 'offer')).toBe(true)
  })

  it('is not a correction back down the board', () => {
    expect(isAdvance('offer', 'interview')).toBe(false)
    expect(isAdvance('interview', 'screen')).toBe(false)
    expect(isAdvance('submitted', 'draft')).toBe(false)
  })

  it('is not the same column twice', () => {
    expect(isAdvance('screen', 'screen')).toBe(false)
  })

  it('is never a move into Closed, from anywhere', () => {
    /*
     * Closed is the last column, so by index every drag into it advances. But
     * the stage does not say whether the application was accepted or rejected,
     * and rejection is the common case — celebrating one would be worse than
     * staying still.
     */
    expect(isAdvance('offer', 'closed')).toBe(false)
    expect(isAdvance('draft', 'closed')).toBe(false)
    expect(isAdvance('closed', 'closed')).toBe(false)
  })
})

describe('the gesture an advance draws', () => {
  it('is one the mascot actually knows', () => {
    for (const gesture of ADVANCE_GESTURES) expect(POSE_MS[gesture]).toBeGreaterThan(0)
  })

  it('is the three the board celebrates with', () => {
    expect([...ADVANCE_GESTURES]).toEqual(['nod', 'spin', 'dance'])
  })

  it('spreads across the whole pool as the roll moves', () => {
    // Nothing played before, so all three are candidates: thirds of the range.
    expect(advanceGesture(0)).toBe('nod')
    expect(advanceGesture(0.5)).toBe('spin')
    expect(advanceGesture(0.99)).toBe('dance')
  })

  it('never repeats the gesture that just played', () => {
    for (const previous of ADVANCE_GESTURES) {
      for (const roll of [0, 0.25, 0.5, 0.75, 0.99]) {
        expect(advanceGesture(roll, previous)).not.toBe(previous)
      }
    }
  })

  it('can still reach every gesture once one is excluded', () => {
    expect(new Set([advanceGesture(0, 'nod'), advanceGesture(0.99, 'nod')])).toEqual(
      new Set(['spin', 'dance']),
    )
    expect(new Set([advanceGesture(0, 'dance'), advanceGesture(0.99, 'dance')])).toEqual(
      new Set(['nod', 'spin']),
    )
  })

  it('stays inside the pool on a roll that is out of range', () => {
    // `Math.random()` cannot produce these, but a caller could.
    for (const roll of [-1, 0, 1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(ADVANCE_GESTURES).toContain(advanceGesture(roll))
      // Including against the first of the pool, which is what an index that
      // misses would fall back to.
      for (const previous of ADVANCE_GESTURES) {
        expect(advanceGesture(roll, previous)).not.toBe(previous)
      }
    }
  })
})
