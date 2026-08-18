import { describe, expect, it } from 'vitest'
import type { Application } from '@/data/seed'
import type { TimelineItem } from '@/data/timeline'
import { applyFills, blanksIn, fillsFor } from './template'

/**
 * `BLANK` decides which bracketed text in somebody's own writing this app is
 * allowed to overwrite, and `fillsFor` decides what it is allowed to guess.
 * Both were closures inside `DraftDialog.tsx` and so unreachable from a test.
 */

const app = (over: Partial<Application> = {}): Application =>
  ({
    id: 'app:1',
    org: 'Rice',
    role: 'Statistics',
    roleTag: 'Assistant Professor',
    stage: 'submitted',
    note: '',
    daysAgo: 0,
    ...over,
  }) as Application

const item = (over: Partial<TimelineItem> = {}): TimelineItem =>
  ({
    id: 'ti:1',
    title: 'Chat',
    date: '2026-09-04',
    kind: 'interview',
    ...over,
  }) as TimelineItem

describe('blanksIn', () => {
  it('finds the upper-case tokens the seeded snippets use', () => {
    expect(blanksIn('Dear [NAME], about [YOUR NAME] and [LOCAL CONTEXT].').names).toEqual([
      '[NAME]',
      '[YOUR NAME]',
      '[LOCAL CONTEXT]',
    ])
  })

  it("leaves a person's own bracketed aside alone", () => {
    // The reason the pattern is narrow. Filling this would silently edit prose
    // the user wrote, which is worse than leaving a blank they can see.
    expect(blanksIn('Thanks — [see attached] and [ok].').count).toBe(0)
  })

  it('counts repeats but names them once', () => {
    const { count, names } = blanksIn('[ORG] … [ORG]')
    expect(count).toBe(2)
    expect(names).toEqual(['[ORG]'])
  })
})

describe('fillsFor', () => {
  it('never invents a name', () => {
    // The whole design: an unfilled blank cannot be sent without noticing, and
    // a plausible wrong name can.
    expect(fillsFor(app())).not.toHaveProperty('NAME')
  })

  it('spells the employer four ways because a snippet may ask any of them', () => {
    const fills = fillsFor(app())
    expect([fills.ORG, fills.EMPLOYER, fills.COMPANY, fills.INSTITUTION]).toEqual([
      'Rice',
      'Rice',
      'Rice',
      'Rice',
    ])
  })

  it('lets a meeting override the application date, and only a meeting', () => {
    const sent = app({ submittedOn: '2026-08-01' })
    expect(fillsFor(sent).DATE).toBe(fillsFor(sent, item({ kind: 'admin' })).DATE)
    expect(fillsFor(sent, item({ kind: 'interview' })).DATE).not.toBe(fillsFor(sent).DATE)
  })

  it('offers a portal only when the record carries a URL', () => {
    expect(fillsFor(app())).not.toHaveProperty('PORTAL')
    expect(fillsFor(app({ url: 'https://jobs.rice.edu/apply/1' })).PORTAL).toBe('jobs.rice.edu')
  })
})

describe('applyFills', () => {
  it('leaves a token it cannot answer exactly as it found it', () => {
    expect(applyFills('Dear [NAME], re [ORG].', { ORG: 'Rice' })).toBe('Dear [NAME], re Rice.')
  })
})
