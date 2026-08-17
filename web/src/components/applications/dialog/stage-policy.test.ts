import { describe, expect, it } from 'vitest'
import type { Application, Stage } from '@/data/seed'
import {
  RESPOND_BY_FLOOR_DAYS,
  buildStageItem,
  buildStagePatch,
  initialStageDraft,
  plainStageMove,
  stageBlocker,
  stageConsequences,
  stageNeedsDetails,
} from './stage-policy'

/**
 * These rules spent their whole life as closures inside `TransitionForm`, so
 * none of them could be asserted without mounting a dialog — and D20 rules out
 * component tests. Extracting them to `stage-policy.ts` is what made this file
 * possible; the assertions below are the reason the extraction was worth doing,
 * not decoration on top of it.
 */

const TODAY = '2026-08-15'

const app = (over: Partial<Application> = {}): Application =>
  ({
    id: 'app:1',
    org: 'Rice',
    role: 'Statistics',
    roleTag: 'Assistant Professor',
    stage: 'draft',
    note: '',
    daysAgo: 0,
    ...over,
  }) as Application

const draftFor = (a: Application, over: Partial<ReturnType<typeof initialStageDraft>> = {}) => ({
  ...initialStageDraft(a, TODAY),
  ...over,
})

describe('stageNeedsDetails', () => {
  it('asks nothing for a move that collects nothing', () => {
    expect(stageNeedsDetails(app(), 'screen')).toBe(false)
    expect(stageNeedsDetails(app({ stage: 'screen' }), 'draft')).toBe(false)
  })

  it('asks for the four stages that carry a field block', () => {
    for (const target of ['submitted', 'interview', 'offer', 'closed'] as Stage[]) {
      expect(stageNeedsDetails(app(), target)).toBe(true)
    }
  })

  it('never asks about a move to the stage the record is already in', () => {
    expect(stageNeedsDetails(app({ stage: 'offer' }), 'offer')).toBe(false)
  })

  it('asks whenever an offer is being left behind, whatever the destination', () => {
    const withOffer = app({ stage: 'offer', offer: { respondBy: '2026-09-01', note: '' } })
    // 'screen' collects nothing, so this is true only because of the offer.
    expect(stageNeedsDetails(withOffer, 'screen')).toBe(true)
  })
})

describe('buildStagePatch', () => {
  it('fills appliedOn only where it was empty', () => {
    // The same rule `application.stage.advance` states in `kg/tools`. Two
    // statements of one rule, and until this test nothing checked they agreed.
    const fresh = buildStagePatch(app(), 'submitted', draftFor(app(), { date: '2026-08-10' }))
    expect(fresh.appliedOn).toBe('2026-08-10')

    const already = app({ appliedOn: '2026-07-01' })
    const patch = buildStagePatch(already, 'submitted', draftFor(already, { date: '2026-08-10' }))
    expect(patch.appliedOn).toBe('2026-07-01')
    expect(patch.submittedOn).toBe('2026-08-10')
  })

  it('rides the confirmation reference in lastAction, and says so plainly without one', () => {
    const a = app()
    expect(buildStagePatch(a, 'submitted', draftFor(a, { reference: ' AB-9 ' })).lastAction).toBe(
      'Submitted · ref AB-9',
    )
    expect(buildStagePatch(a, 'submitted', draftFor(a)).lastAction).toBe('Application submitted')
  })

  it('writes a portal URL only when one was typed', () => {
    const a = app()
    expect('url' in buildStagePatch(a, 'submitted', draftFor(a, { portalUrl: '   ' }))).toBe(false)
    expect(buildStagePatch(a, 'submitted', draftFor(a, { portalUrl: ' x.test ' })).url).toBe(
      'x.test',
    )
  })

  it('clears the offer only when the user said not to keep it', () => {
    const withOffer = app({ stage: 'offer', offer: { respondBy: '2026-09-01', note: '' } })
    const kept = buildStagePatch(withOffer, 'closed', draftFor(withOffer, { keepOffer: true }))
    expect('offer' in kept).toBe(false)

    const dropped = buildStagePatch(withOffer, 'closed', draftFor(withOffer, { keepOffer: false }))
    expect('offer' in dropped).toBe(true)
    expect(dropped.offer).toBeUndefined()
  })

  it('never clears an offer on the way INTO offer', () => {
    const withOffer = app({ stage: 'offer', offer: { respondBy: '2026-09-01', note: '' } })
    const patch = buildStagePatch(withOffer, 'offer', draftFor(withOffer, { keepOffer: false }))
    expect(patch.offer).toEqual({ respondBy: '2026-09-01', comp: undefined, note: '' })
  })
})

describe('buildStageItem', () => {
  it('mints nothing for a stage that has nothing to put on a calendar', () => {
    const a = app()
    expect(buildStageItem(a, 'submitted', draftFor(a))).toBeUndefined()
    expect(buildStageItem(a, 'closed', draftFor(a))).toBeUndefined()
  })

  it('honours the opt-out switches', () => {
    const a = app()
    expect(buildStageItem(a, 'interview', draftFor(a, { mintInterview: false }))).toBeUndefined()
    expect(buildStageItem(a, 'offer', draftFor(a, { mintRespondBy: false }))).toBeUndefined()
  })

  it('carries the location onto an onsite interview and only an onsite one', () => {
    const a = app({ location: 'Houston' })
    expect(buildStageItem(a, 'interview', draftFor(a, { format: 'onsite' }))?.location).toBe(
      'Houston',
    )
    expect(
      buildStageItem(a, 'interview', draftFor(a, { format: 'video' }))?.location,
    ).toBeUndefined()
  })

  it('stamps no urgency on either draft', () => {
    const a = app()
    expect(buildStageItem(a, 'interview', draftFor(a))).not.toHaveProperty('urgency')
    expect(buildStageItem(a, 'offer', draftFor(a))).not.toHaveProperty('urgency')
  })
})

describe('stageBlocker', () => {
  it('names the field that is missing, and nothing else', () => {
    const a = app()
    expect(stageBlocker('submitted', draftFor(a, { date: '' }))).toBe('Add the date first')
    expect(stageBlocker('interview', draftFor(a, { date: '' }))).toBe('Add the date first')
    expect(stageBlocker('offer', draftFor(a, { respondBy: '' }))).toBe(
      'Add a respond-by date first',
    )
    expect(stageBlocker('closed', draftFor(a, { date: '' }))).toBeUndefined()
  })
})

describe('stageConsequences', () => {
  it('never repeats the stage change itself — that is the toast title', () => {
    const a = app()
    expect(stageConsequences(a, 'screen', draftFor(a), undefined)).toEqual([])
  })

  it('reports the offer clear as an absence the patch cannot show', () => {
    const withOffer = app({ stage: 'offer', offer: { respondBy: '2026-09-01', note: '' } })
    const lines = stageConsequences(
      withOffer,
      'closed',
      draftFor(withOffer, { keepOffer: false }),
      undefined,
    )
    expect(lines).toContain('Offer details cleared.')
  })
})

describe('the respond-by floor', () => {
  it('starts two weeks out when the record has no offer date yet', () => {
    expect(RESPOND_BY_FLOOR_DAYS).toBe(14)
    expect(initialStageDraft(app(), TODAY).respondBy).toBe('2026-08-29')
  })

  it('defers to a respond-by the record already carries', () => {
    const a = app({ offer: { respondBy: '2026-08-20', note: '' } })
    expect(initialStageDraft(a, TODAY).respondBy).toBe('2026-08-20')
  })
})

describe('plainStageMove', () => {
  it('is the same object all three of its callers used to write by hand', () => {
    expect(plainStageMove('screen')).toEqual({
      stage: 'screen',
      lastAction: 'Moved to Screening call',
    })
  })
})
