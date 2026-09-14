import { describe, expect, it, vi } from 'vitest'
import { emptyStateFor, KEYWORDS_HID_THEM, type VaultEmptyCopy } from './empty-state'

/**
 * The precedence order, which is the whole reason this helper exists.
 *
 * `emptyStateFor` returns a plain object — its `action` is an unrendered React
 * element, which `createElement` will build without a DOM — so the branch taken
 * and the words it chose can both be asserted without mounting anything.
 *
 * Worth pinning because the ladder grew a sixth rung for the Files list's
 * "Unfiled" chip, and the other three tools share the same function. A rung
 * inserted in the wrong place does not throw; it just answers a different
 * question from the one the person asked.
 */

const COPY: VaultEmptyCopy = {
  zero: { title: 'No files yet', description: 'Add one.', action: null },
  search: (q) => `Nothing mentions "${q}".`,
  both: 'Neither filter matched.',
  bucket: {
    title: 'Nothing in that bucket',
    description: 'Others hold them.',
    clearLabel: 'Show all',
  },
  keywords: { title: 'No keywords match' },
  unfiled: {
    alone: { title: 'Every file is filed under an application', description: 'All 8 of them.' },
    withOthers: 'No unfiled file is in Admin.',
  },
}

const state = (over: Partial<Parameters<typeof emptyStateFor>[0]> = {}) =>
  emptyStateFor({
    total: 8,
    query: '',
    filteredByBucket: false,
    filteredByKeyword: false,
    onClearQuery: () => {},
    onClearBucket: () => {},
    onClearKeywords: () => {},
    copy: COPY,
    ...over,
  })

describe('the ladder, in order', () => {
  it('answers "there is nothing at all" before anything else', () => {
    const result = state({ total: 0, query: 'x', filteredByBucket: true, filteredByUnfiled: true })
    expect(result.title).toBe('No files yet')
  })

  it('answers a search before any chip', () => {
    const result = state({ query: '  cv  ', filteredByBucket: true, filteredByUnfiled: true })
    expect(result.title).toBe('Nothing matches that search')
    // The query reaches the copy trimmed.
    expect(result.description).toBe('Nothing mentions "cv".')
  })

  it('answers the unfiled chip before the bucket and keyword rungs', () => {
    // The most specific filter on is the one worth naming.
    expect(state({ filteredByUnfiled: true, filteredByBucket: true }).title).toBe(
      'Nothing matches those filters',
    )
    expect(state({ filteredByUnfiled: true, filteredByKeyword: true }).description).toBe(
      'No unfiled file is in Admin.',
    )
  })

  it('says everything is filed when the chip is the only thing on', () => {
    // Not a failure — it is the state the list exists to reach, and "no files"
    // over a full vault would read as data loss.
    const result = state({ filteredByUnfiled: true })
    expect(result.title).toBe('Every file is filed under an application')
    expect(result.description).toBe('All 8 of them.')
  })

  it('still answers both older chips when the new one is off', () => {
    expect(state({ filteredByBucket: true, filteredByKeyword: true }).title).toBe(
      'Nothing matches both filters',
    )
    expect(state({ filteredByBucket: true }).title).toBe('Nothing in that bucket')
    expect(state({ filteredByKeyword: true }).description).toBe(KEYWORDS_HID_THEM)
  })
})

describe('the other three tools, which never pass the new filter', () => {
  it('reach exactly the ladder they had', () => {
    /*
     * `unfiled` copy absent AND the flag absent: the two new rungs cannot fire,
     * so links, snippets and reminders keep the five-step ladder they were
     * written against.
     */
    const { unfiled: _unfiled, ...without } = COPY
    const older = (over: Partial<Parameters<typeof emptyStateFor>[0]>) =>
      emptyStateFor({
        total: 8,
        query: '',
        filteredByBucket: false,
        filteredByKeyword: false,
        onClearQuery: () => {},
        onClearBucket: () => {},
        onClearKeywords: () => {},
        copy: without,
        ...over,
      })
    expect(older({ filteredByBucket: true }).title).toBe('Nothing in that bucket')
    expect(older({ filteredByKeyword: true }).title).toBe('No keywords match')
    // Even if a caller set the flag without the copy, it falls through safely.
    expect(older({ filteredByUnfiled: true, filteredByBucket: true }).title).toBe(
      'Nothing in that bucket',
    )
  })
})

describe('clearing from the empty state', () => {
  it('turns off every filter that was on, not just the new one', () => {
    const onClearBucket = vi.fn()
    const onClearKeywords = vi.fn()
    const onClearUnfiled = vi.fn()
    const result = state({
      filteredByUnfiled: true,
      filteredByBucket: true,
      filteredByKeyword: true,
      onClearBucket,
      onClearKeywords,
      onClearUnfiled,
    })
    // The action is an unrendered <Button>; call the handler it was given.
    const onClick = (result.action as { props: { onClick: () => void } }).props.onClick
    onClick()
    expect(onClearUnfiled).toHaveBeenCalledOnce()
    expect(onClearBucket).toHaveBeenCalledOnce()
    expect(onClearKeywords).toHaveBeenCalledOnce()
  })

  it('does not clear a filter that was already off', () => {
    const onClearBucket = vi.fn()
    const onClearKeywords = vi.fn()
    const onClearUnfiled = vi.fn()
    const result = state({
      filteredByUnfiled: true,
      filteredByBucket: true,
      onClearBucket,
      onClearKeywords,
      onClearUnfiled,
    })
    ;(result.action as { props: { onClick: () => void } }).props.onClick()
    expect(onClearBucket).toHaveBeenCalledOnce()
    expect(onClearKeywords).not.toHaveBeenCalled()
  })
})
