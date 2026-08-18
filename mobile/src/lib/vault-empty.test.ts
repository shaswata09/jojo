/**
 * The precedence order, which is the whole of what this module is.
 *
 * Each case sets up a list that has been emptied by exactly one control and
 * asserts the message names THAT control. Before this ladder existed the four
 * vault tools each answered one question — is the collection empty — and then
 * blamed the category whatever had actually hidden the rows, which is how "No
 * links yet" appears over a vault holding eight of them.
 *
 * `clear` is the assertion that carries the most: it is `null` on exactly one
 * branch — the one where the right control is Add rather than a switch — and
 * everywhere else it names the control that would bring the rows back.
 */

import { describe, expect, it } from 'vitest'
import { KEYWORDS_HID_THEM, vaultEmptyState } from './vault-empty'
import type { VaultEmptyCopy } from './vault-empty'

const copy: VaultEmptyCopy = {
  icon: 'link-2',
  zero: { title: 'Nothing saved yet', description: 'Save a URL.' },
  search: (q) => `No link mentions "${q}".`,
  both: 'No posting link carries the selected keywords.',
  bucket: {
    title: 'No links under posting',
    description: '8 links are filed under the other categories.',
    clearLabel: 'Show all categories',
  },
  keywords: { title: 'No links carry those keywords' },
}

const state = (over: Partial<Parameters<typeof vaultEmptyState>[0]> = {}) =>
  vaultEmptyState({
    total: 8,
    query: '',
    filteredByBucket: false,
    filteredByKeyword: false,
    onClearQuery: () => {},
    onClearBucket: () => {},
    onClearKeywords: () => {},
    copy,
    ...over,
  })

describe('which control gets the blame', () => {
  it('offers the Add control, and only it, when nothing exists at all', () => {
    expect(state({ total: 0 })).toMatchObject({ title: 'Nothing saved yet', clear: null })
  })

  it('blames the search first, even with both filters also on', () => {
    // The search box is the control the user just typed into, so it outranks a
    // chip they set two minutes ago.
    expect(
      state({ query: '  rice  ', filteredByBucket: true, filteredByKeyword: true }),
    ).toMatchObject({
      title: 'Nothing matches that search',
      // Trimmed: the quoted word in the sentence is what they meant to type.
      description: 'No link mentions "rice".',
      clear: { label: 'Clear search' },
    })
  })

  it('names both when the bucket chip and the keyword row are both on', () => {
    expect(state({ filteredByBucket: true, filteredByKeyword: true })).toMatchObject({
      title: 'Nothing matches both filters',
      description: 'No posting link carries the selected keywords.',
      clear: { label: 'Clear both filters' },
    })
  })

  it('names the bucket when only the bucket is on', () => {
    expect(state({ filteredByBucket: true })).toMatchObject({
      title: 'No links under posting',
      description: '8 links are filed under the other categories.',
      clear: { label: 'Show all categories' },
    })
  })

  it('names the keyword row when only the keywords are on', () => {
    // This is the branch the four tools did not have. A list emptied by a chip
    // at the top of the page used to say the category was to blame.
    expect(state({ filteredByKeyword: true })).toMatchObject({
      title: 'No links carry those keywords',
      description: KEYWORDS_HID_THEM,
      clear: { label: 'Clear keywords' },
    })
  })

  it('falls back to the keyword branch when a list is empty for no stated reason', () => {
    // Not reachable from the four tools — something is always on when rows are
    // empty and records exist — but the ladder has to end somewhere, and
    // pointing at the page-level control is the recoverable answer.
    expect(state().title).toBe('No links carry those keywords')
  })

  it('lets a branch override the shared icon', () => {
    const done: VaultEmptyCopy = { ...copy, bucket: { ...copy.bucket, icon: 'check' } }
    expect(state({ filteredByBucket: true, copy: done }).icon).toBe('check')
    expect(state({ filteredByKeyword: true, copy: done }).icon).toBe('link-2')
  })

  it('clears both controls when both are on, not just the one it names', () => {
    let bucket = 0
    let keywords = 0
    const both = state({
      filteredByBucket: true,
      filteredByKeyword: true,
      onClearBucket: () => (bucket += 1),
      onClearKeywords: () => (keywords += 1),
    })
    both.clear?.onPress()
    // A button labelled "Clear both filters" that clears one of them leaves the
    // list exactly as empty and the reader with no next move.
    expect([bucket, keywords]).toEqual([1, 1])
  })
})
