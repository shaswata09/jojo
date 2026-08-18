import { describe, expect, it } from 'vitest'
import type { Application } from '@/data/seed'
import { compareApplications, countByStage, emptyReason, filterApplications } from './list-query'

const yes = () => true

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

const pool = [
  app({ id: 'a', org: 'Rice', role: 'Statistics', stage: 'offer', daysAgo: 9 }),
  app({ id: 'b', org: 'Databricks', role: 'ML Engineer', stage: 'draft', daysAgo: 2 }),
  app({ id: 'c', org: 'Baylor', role: 'Statistics', stage: 'offer', daysAgo: 5 }),
]

describe('filterApplications', () => {
  const run = (query: string, over: Partial<Parameters<typeof filterApplications>[0]> = {}) =>
    filterApplications({ all: pool, query, matchesRole: yes, matchesKeyword: yes, ...over }).map(
      (a) => a.id,
    )

  it('matches the stage label, not just the fields on the row', () => {
    // Typing "offer" has to find the record whose only mention of it is a chip.
    expect(run('offer')).toEqual(['a', 'c'])
  })

  it('lets a query span two fields, because it searches the joined text', () => {
    expect(run('rice stat')).toEqual(['a'])
  })

  it('returns everything for a blank or whitespace-only query', () => {
    expect(run('   ')).toEqual(['a', 'b', 'c'])
  })

  it('applies the role and keyword predicates before the text', () => {
    expect(run('', { matchesKeyword: (a) => a.id !== 'b' })).toEqual(['a', 'c'])
    expect(run('', { matchesRole: (tag) => tag !== 'Assistant Professor' })).toEqual([])
  })
})

describe('countByStage', () => {
  it('counts the pool it is given and mentions no stage that is empty in it', () => {
    expect(countByStage(pool)).toEqual({ offer: 2, draft: 1 })
  })
})

describe('compareApplications', () => {
  const ids = (sort: Parameters<typeof compareApplications>[0]) =>
    [...pool].sort(compareApplications(sort)).map((a) => a.id)

  it('sorts by age in both directions', () => {
    expect(ids({ key: 'daysAgo', dir: 'asc' })).toEqual(['b', 'c', 'a'])
    expect(ids({ key: 'daysAgo', dir: 'desc' })).toEqual(['a', 'c', 'b'])
  })

  it('sorts by pipeline order rather than alphabetically on stage', () => {
    // Draft comes before Offer because STAGES is in pipeline order; 'd' < 'o'
    // would agree here by accident, so the direction flip is the real check.
    expect(ids({ key: 'stage', dir: 'asc' })[0]).toBe('b')
    expect(ids({ key: 'stage', dir: 'desc' })[0]).not.toBe('b')
  })

  it('sorts the role column by what the column prints', () => {
    expect(ids({ key: 'role', dir: 'asc' })).toEqual(['c', 'b', 'a'])
  })
})

describe('emptyReason', () => {
  const reason = (over: Partial<Parameters<typeof emptyReason>[0]> = {}) =>
    emptyReason({ query: '', stageFilter: 'all', keywordCount: 0, roleCount: 0, ...over })

  it('does not blame a filter when none is on', () => {
    expect(reason()).toBe('Nothing here to show.')
  })

  it('names the one filter that is on', () => {
    expect(reason({ query: 'x' })).toBe('Nothing carries that search.')
    expect(reason({ stageFilter: 'offer' })).toBe('Nothing carries the Offer stage.')
  })

  it('joins several with commas and a final "and"', () => {
    expect(reason({ query: 'x', stageFilter: 'offer', roleCount: 1 })).toBe(
      'Nothing carries that search, the Offer stage and the selected roles.',
    )
  })

  it('ignores a whitespace-only search', () => {
    expect(reason({ query: '  ' })).toBe('Nothing here to show.')
  })
})
