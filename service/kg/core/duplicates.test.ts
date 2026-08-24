import { describe, expect, it } from 'vitest'
import { duplicateMessage, findDuplicate } from './duplicates'

/**
 * The duplicate warning, and mostly the cases where it must stay quiet.
 *
 * A warning that fires on a job you meant to add is worse than no warning at
 * all: it gets clicked through by reflex within a week, and then it is not there
 * for the case it exists for. So the misses below are asserted as deliberately
 * as the hits — three roles at one university is the shape this product is FOR.
 */

const RICE_URL = 'https://jobs.rice.edu/postings/29411'

const rows = [
  { id: 'a1', org: 'Rice', role: 'Statistics', url: RICE_URL },
  { id: 'a2', org: 'Rice', role: 'Research scientist' },
  { id: 'a3', org: 'Stripe', role: 'ML engineer', url: 'https://stripe.com/jobs/listing/4482' },
]

describe('findDuplicate', () => {
  it('catches the same posting URL', () => {
    const hit = findDuplicate(rows, { url: 'https://jobs.rice.edu/postings/29411' })
    expect(hit?.record.id).toBe('a1')
    expect(hit?.reason).toBe('url')
  })

  it('ignores the tracking parameters a copied link picks up', () => {
    // The whole reason rule 1 fires in practice. A link copied out of a search
    // result carries `?gh_src=` and the same link copied from the ad does not.
    expect(
      findDuplicate(rows, { url: 'https://jobs.rice.edu/postings/29411?gh_src=abc&utm_source=x' })
        ?.record.id,
    ).toBe('a1')
    expect(
      findDuplicate(rows, { url: 'https://jobs.rice.edu/postings/29411#apply' })?.record.id,
    ).toBe('a1')
  })

  it('ignores the scheme, a www, and a trailing slash', () => {
    for (const url of [
      'http://jobs.rice.edu/postings/29411',
      'https://www.jobs.rice.edu/postings/29411',
      'jobs.rice.edu/postings/29411/',
      '  https://jobs.rice.edu/postings/29411  ',
    ]) {
      expect(findDuplicate(rows, { url })?.record.id, url).toBe('a1')
    }
  })

  it('catches the same employer and role typed again', () => {
    const hit = findDuplicate(rows, { org: 'rice', role: '  STATISTICS ' })
    expect(hit?.record.id).toBe('a1')
    expect(hit?.reason).toBe('name')
  })

  it('says nothing about a different role at the same employer', () => {
    // The case the product is for. Rice's Statistics post and its Research
    // scientist post are two jobs, and the seeded data ships exactly that pair.
    expect(findDuplicate(rows, { org: 'Rice', role: 'Assistant professor, ECE' })).toBeUndefined()
  })

  it('does not fire on an employer alone', () => {
    expect(findDuplicate(rows, { org: 'Rice' })).toBeUndefined()
    expect(findDuplicate(rows, { org: 'Rice', role: '' })).toBeUndefined()
  })

  it('does not fire on a role alone', () => {
    expect(findDuplicate(rows, { role: 'Statistics' })).toBeUndefined()
  })

  it('says nothing when there is nothing to compare', () => {
    expect(findDuplicate(rows, {})).toBeUndefined()
    expect(findDuplicate([], { org: 'Rice', role: 'Statistics' })).toBeUndefined()
    expect(findDuplicate(rows, { url: 'not a url' })).toBeUndefined()
    expect(findDuplicate(rows, { url: 'mailto:someone@rice.edu' })).toBeUndefined()
  })

  it('never reports a record as a duplicate of itself', () => {
    // The edit case: reopening Rice — Statistics must not warn about it.
    expect(
      findDuplicate(rows, { org: 'Rice', role: 'Statistics', url: RICE_URL }, 'a1'),
    ).toBeUndefined()
  })

  it('prefers the URL match, which is the one that proves something', () => {
    const both = [
      { id: 'byName', org: 'Stripe', role: 'ML engineer' },
      { id: 'byUrl', org: 'Somewhere else', role: 'Other', url: 'https://stripe.com/jobs/4482' },
    ]
    const hit = findDuplicate(both, {
      org: 'Stripe',
      role: 'ML engineer',
      url: 'https://stripe.com/jobs/4482',
    })
    expect(hit?.record.id).toBe('byUrl')
    expect(hit?.reason).toBe('url')
  })

  it('folds accents, so a name typed twice two ways still matches', () => {
    const accented = [{ id: 'x', org: 'Université de Montréal', role: 'Professeur' }]
    expect(
      findDuplicate(accented, { org: 'Universite de Montreal', role: 'professeur' })?.record.id,
    ).toBe('x')
  })
})

describe('duplicateMessage', () => {
  it('says which of the two things happened', () => {
    expect(duplicateMessage('url', 'Rice — Statistics')).toContain('saved this posting')
    expect(duplicateMessage('name', 'Rice — Statistics')).toBe(
      'You already have Rice — Statistics.',
    )
  })
})
