/**
 * The direction half of the Applications sort, which shipped inert.
 *
 * The toolbar has had an arrow and a menu row naming "Most recent first" /
 * "Oldest first" for as long as the screen has existed, and `dir` reached
 * neither the comparator nor the `useMemo` that ran it. Every assertion below
 * pairs the two directions on the same pool: a comparator that ignores
 * direction gives the same order twice, which is exactly what the screen did.
 */

import { describe, expect, it } from 'vitest'
import type { Application } from '@jojo/service/data/seed'
import { sortApplications } from './application-sort'

/** Only the fields the three orderings read; the rest of an Application is noise here. */
const app = (id: string, org: string, role: string, stage: Application['stage'], daysAgo: number) =>
  ({
    id,
    org,
    role,
    note: '',
    roleTag: 'ML Engineer',
    stage,
    lastAction: '',
    daysAgo,
  }) as Application

// Deliberately jumbled, and deliberately not agreeing with any other key: a
// pool already sorted by the key under test cannot fail.
const POOL: Application[] = [
  app('zeta', 'Zeta', 'Analyst', 'offer', 9),
  app('acme', 'Acme', 'Analyst', 'draft', 1),
  app('milo', 'Milo', 'Analyst', 'screen', 4),
]

const ids = (key: 'daysAgo' | 'stage' | 'role', dir: 'asc' | 'desc') =>
  sortApplications(POOL, key, dir).map((a) => a.id)

describe('the direction the list is sorted in', () => {
  it('puts the most recent first ascending and the oldest first descending', () => {
    expect(ids('daysAgo', 'asc')).toEqual(['acme', 'milo', 'zeta'])
    expect(ids('daysAgo', 'desc')).toEqual(['zeta', 'milo', 'acme'])
  })

  it('walks the stages draft-to-closed ascending and closed-to-draft descending', () => {
    // Stage order is `STAGES`, not the alphabet: draft < screen < offer.
    expect(ids('stage', 'asc')).toEqual(['acme', 'milo', 'zeta'])
    expect(ids('stage', 'desc')).toEqual(['zeta', 'milo', 'acme'])
  })

  it('sorts positions A to Z ascending and Z to A descending', () => {
    expect(ids('role', 'asc')).toEqual(['acme', 'milo', 'zeta'])
    expect(ids('role', 'desc')).toEqual(['zeta', 'milo', 'acme'])
  })

  it('reverses every key, so no key is left behind when one is fixed', () => {
    for (const key of ['daysAgo', 'stage', 'role'] as const) {
      expect(ids(key, 'desc'), `${key} ignored the direction`).toEqual(
        [...ids(key, 'asc')].reverse(),
      )
    }
  })
})

describe('what the comparator sorts a position by', () => {
  it('orders by the display name, employer first, not by the role alone', () => {
    // 'Acme — Zebra' before 'Bravo — Alpha': the row prints the employer first,
    // so a sort keyed on `role` would put these the other way round.
    const pool = [app('b', 'Bravo', 'Alpha', 'draft', 1), app('a', 'Acme', 'Zebra', 'draft', 1)]
    expect(sortApplications(pool, 'role', 'asc').map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('the pool it was handed', () => {
  it('is left alone — the board renders the same array', () => {
    const pool = [...POOL]
    sortApplications(pool, 'daysAgo', 'desc')
    expect(pool.map((a) => a.id)).toEqual(['zeta', 'acme', 'milo'])
  })
})
