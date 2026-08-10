/**
 * Characterisation tests: what identity does TODAY, pinned before the graph
 * layer replaces it.
 *
 * These are not a wish list. Every case below is behaviour some caller already
 * depends on, and the KG layer's `core/ref.ts` has to keep answering the same
 * way for the records already in a user's store — or reproduce the answer
 * deliberately, having read the test that says why.
 */

import { describe, expect, it } from 'vitest'
import { toLabelId } from '@/data/labels'
import { parseRef, refKey, slugify, uniqueId } from '@/lib/ids'

describe('parseRef', () => {
  it('splits a canonical reference into its kind and id', () => {
    expect(parseRef('app:stripe')).toEqual({ kind: 'app', id: 'stripe' })
    expect(parseRef('item:rice-deadline')).toEqual({ kind: 'item', id: 'rice-deadline' })
  })

  // The label store keys most records by a bare id and only applications by
  // 'app:rice'. Reading a bare key as anything but an application would drop
  // every seeded keyword on the floor — silently, since a miss returns [].
  it('reads a bare key as an application', () => {
    expect(parseRef('stripe')).toEqual({ kind: 'app', id: 'stripe' })
  })

  // A pasted URL must survive the round trip. Splitting on 'https' would mint
  // { kind: 'https', id: '//stripe.com/jobs' } and lose the scheme on the way
  // back out, turning a working link into a relative path.
  it('treats an unknown prefix as part of the id, not as a kind', () => {
    expect(parseRef('https://stripe.com/jobs/4482')).toEqual({
      kind: 'app',
      id: 'https://stripe.com/jobs/4482',
    })
  })

  // Only the FIRST colon separates, so a known kind in front of a URL keeps the
  // URL whole rather than truncating it at '//'.
  it('splits on the first colon only', () => {
    expect(parseRef('link:https://stripe.com/jobs')).toEqual({
      kind: 'link',
      id: 'https://stripe.com/jobs',
    })
  })

  it('round-trips whatever refKey mints', () => {
    expect(parseRef(refKey('posting', 'rice'))).toEqual({ kind: 'posting', id: 'rice' })
  })
})

describe('uniqueId', () => {
  it('hands back the base when nothing has claimed it', () => {
    expect(uniqueId('unt', [])).toBe('unt')
    expect(uniqueId('unt', ['rice', 'tamu'])).toBe('unt')
  })

  // Counting from 2, not 1: the first duplicate is the SECOND record of that
  // name, and 'unt-1' would imply an 'unt-0' nobody ever minted.
  it('counts from 2 so the first duplicate reads as the second of its name', () => {
    expect(uniqueId('unt', ['unt'])).toBe('unt-2')
  })

  it('walks past every taken suffix', () => {
    expect(uniqueId('unt', ['unt', 'unt-2', 'unt-3'])).toBe('unt-4')
  })

  // Gaps are filled rather than skipped — the counter probes, it does not track
  // a high-water mark.
  it('fills a gap left by a deleted middle record', () => {
    expect(uniqueId('unt', ['unt', 'unt-3'])).toBe('unt-2')
  })
})

describe('slugify', () => {
  it('lowercases and hyphenates runs of whitespace', () => {
    expect(slugify('UT Austin')).toBe('ut-austin')
    expect(slugify('  Texas   A&M  ')).toBe('texas-a&m')
  })

  // These two are separate implementations of one rule. They stopped being
  // load-bearing for identity when `addLabel` moved to deduping on the name,
  // but they are still both read in exports and in the URL, and two spellings
  // of one rule is a question nobody should have to answer twice.
  it('agrees with toLabelId, which is the same rule written twice', () => {
    for (const name of ['UT Austin', 'Machine Learning', '  Remote  ', 'C++', 'a  b   c']) {
      expect(slugify(name)).toBe(toLabelId(name))
    }
  })
})
