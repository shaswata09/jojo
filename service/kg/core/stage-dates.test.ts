import { describe, expect, it } from 'vitest'
import { enteredStage, setStageDate, stageDateOf, stagesToDate } from './stage-dates'
import type { DatedApplication } from './stage-dates'

const app = (a: Partial<DatedApplication> = {}): DatedApplication => ({ ...a })

describe('where each stage keeps its date', () => {
  /*
   * The asymmetry this module exists to hide: five stages in `stageDates`, and
   * `submitted` in the `submittedOn` field the funnel and the response-time
   * chart have always read. A caller that knew about it would be a second place
   * to fix when it changes.
   */
  it('reads submitted from submittedOn, not from the map', () => {
    expect(stageDateOf(app({ submittedOn: '2026-09-10' }), 'submitted')).toBe('2026-09-10')
  })

  it('writes submitted to submittedOn, and leaves the map alone', () => {
    const patch = setStageDate(app({ stageDates: { interview: '2026-09-20' } }), 'submitted', '2026-09-10')
    expect(patch).toEqual({ submittedOn: '2026-09-10' })
  })

  it('reads and writes every other stage in the map', () => {
    const patch = setStageDate(app(), 'interview', '2026-09-20')
    expect(patch).toEqual({ stageDates: { interview: '2026-09-20' } })
    expect(stageDateOf(app(patch as DatedApplication), 'interview')).toBe('2026-09-20')
  })

  it('keeps the dates it is not changing', () => {
    // The map is stored whole, so a patch that mentioned one stage and dropped
    // the rest would lose them with nothing to report it.
    const before = app({ stageDates: { screen: '2026-09-14', interview: '2026-09-20' } })
    expect(setStageDate(before, 'offer', '2026-09-30').stageDates).toEqual({
      screen: '2026-09-14',
      interview: '2026-09-20',
      offer: '2026-09-30',
    })
  })
})

describe('clearing a date', () => {
  it('removes just that stage', () => {
    const before = app({ stageDates: { screen: '2026-09-14', interview: '2026-09-20' } })
    expect(setStageDate(before, 'screen', undefined).stageDates).toEqual({ interview: '2026-09-20' })
  })

  it('stores nothing at all once the last one goes', () => {
    // Not `{}`: a record that never dated a stage and one whose last date was
    // cleared have to be the same bytes, or two backups either side differ.
    const before = app({ stageDates: { screen: '2026-09-14' } })
    expect(setStageDate(before, 'screen', undefined)).toEqual({ stageDates: undefined })
  })

  it('clears submitted through its own field', () => {
    expect(setStageDate(app({ submittedOn: '2026-09-10' }), 'submitted', undefined)).toEqual({
      submittedOn: undefined,
    })
  })
})

describe('arriving at a stage', () => {
  it('dates a stage that has none', () => {
    expect(enteredStage(app(), 'interview', '2026-09-20')).toEqual({
      stageDates: { interview: '2026-09-20' },
    })
  })

  /*
   * The rule the board depends on. Drag a card to Interview and back to
   * Submitted and forward again — three moves, one afternoon — and the day it
   * really reached Interview has to survive all three. A mis-drop is the
   * commonest slip on that page.
   */
  it('leaves a stage that is already dated exactly as it was', () => {
    const before = app({ stageDates: { interview: '2026-09-20' } })
    expect(enteredStage(before, 'interview', '2026-10-01')).toEqual({})
  })

  it('does not re-stamp submitted either', () => {
    expect(enteredStage(app({ submittedOn: '2026-09-10' }), 'submitted', '2026-10-01')).toEqual({})
  })

  it('still overwrites when the person gives the date', () => {
    // A correction has to land. `setStageDate` is what a typed date goes
    // through, and it is the one that replaces.
    const before = app({ stageDates: { interview: '2026-09-20' } })
    expect(setStageDate(before, 'interview', '2026-10-01').stageDates).toEqual({
      interview: '2026-10-01',
    })
  })
})

describe('which stages a record offers to date', () => {
  it('offers the stages it has lived through, in order', () => {
    expect(stagesToDate({ stage: 'interview' })).toEqual([
      'draft',
      'submitted',
      'screen',
      'interview',
    ])
  })

  it('offers nothing ahead of where it is', () => {
    // A draft asking when the offer came is a form about something that has
    // not happened.
    expect(stagesToDate({ stage: 'draft' })).toEqual(['draft'])
  })

  it('keeps a stage that was skipped but dated', () => {
    // Closed straight from Draft — a rejection before anything was sent.
    expect(stagesToDate({ stage: 'draft', stageDates: { closed: '2026-09-30' } })).toEqual([
      'draft',
      'closed',
    ])
  })

  it('counts submitted as dated through submittedOn', () => {
    expect(stagesToDate({ stage: 'draft', submittedOn: '2026-09-10' })).toEqual([
      'draft',
      'submitted',
    ])
  })
})
