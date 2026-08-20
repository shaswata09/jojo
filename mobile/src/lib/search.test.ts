/**
 * The one substring match every filtering list on this phone goes through.
 *
 * Its own header records why it exists: six lists were each doing
 * `.toLowerCase().includes()` and one of them treated "Muñoz" as unfindable. A
 * job search collects names typed by other people, so the accent fold is not a
 * nicety — a filter that hides a row because of a diacritic the user did not
 * type reads as a missing record, not as a missing match.
 *
 * Untested until now, on either side of the fold.
 */

import { describe, expect, it } from 'vitest'
import { fold, matchesQuery } from './search'

describe('matchesQuery', () => {
  it('matches a substring in any of the fields it is given', () => {
    expect(matchesQuery('rice', 'Rice University', 'Statistics')).toBe(true)
    expect(matchesQuery('stat', 'Rice University', 'Statistics')).toBe(true)
    expect(matchesQuery('mit', 'Rice University', 'Statistics')).toBe(false)
  })

  /** Empty means "everything", never "nothing" — the same rule the keyword filter holds. */
  it('matches everything on a blank or whitespace query', () => {
    expect(matchesQuery('', 'anything')).toBe(true)
    expect(matchesQuery('   ', 'anything')).toBe(true)
    expect(matchesQuery('  ', undefined, null)).toBe(true)
  })

  it('ignores case on both sides', () => {
    expect(matchesQuery('RICE', 'rice university')).toBe(true)
    expect(matchesQuery('rice', 'RICE UNIVERSITY')).toBe(true)
  })

  /**
   * The case the file was written for. Both directions, because the record is
   * as likely to carry the accent as the typing is.
   */
  it('finds an accented name typed without the accent, and the reverse', () => {
    expect(matchesQuery('Andre', 'André Muñoz')).toBe(true)
    expect(matchesQuery('Munoz', 'André Muñoz')).toBe(true)
    expect(matchesQuery('André', 'Andre Munoz')).toBe(true)
    expect(matchesQuery('Muñoz', 'Andre Munoz')).toBe(true)
  })

  it('trims the query, so a trailing space from a keyboard does not empty the list', () => {
    expect(matchesQuery('  rice  ', 'Rice University')).toBe(true)
  })

  it('skips the fields a record does not have rather than throwing', () => {
    expect(matchesQuery('note', 'Title', undefined, null, 'A note')).toBe(true)
    expect(matchesQuery('note', undefined, null)).toBe(false)
    expect(matchesQuery('x')).toBe(false)
  })
})

describe('fold', () => {
  it('strips the diacritic rather than the letter', () => {
    expect(fold('André')).toBe('andre')
    expect(fold('Muñoz')).toBe('munoz')
    expect(fold('  Zürich  ')).toBe('zurich')
  })

  it('leaves a plain string alone apart from case and edges', () => {
    expect(fold('Rice University')).toBe('rice university')
  })
})
