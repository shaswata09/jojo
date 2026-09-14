import { describe, expect, it } from 'vitest'
import { formatPageRange, parsePageRange } from './page-range'

const pages = (input: string, count = 10) => {
  const result = parsePageRange(input, count)
  return result.ok ? result.pages : result.reason
}

describe('reading a page range', () => {
  it('is every page when nothing is typed', () => {
    expect(pages('', 3)).toEqual([0, 1, 2])
    expect(pages('   ', 3)).toEqual([0, 1, 2])
  })

  it('turns page numbers into indices', () => {
    expect(pages('1')).toEqual([0])
    expect(pages('1, 4, 9')).toEqual([0, 3, 8])
    expect(pages('1,4,9')).toEqual([0, 3, 8])
  })

  it('reads a span inclusively at both ends', () => {
    expect(pages('2-4')).toEqual([1, 2, 3])
    expect(pages('2 - 4')).toEqual([1, 2, 3])
    expect(pages('3-3')).toEqual([2])
  })

  it('lets an open end mean the first or the last page', () => {
    expect(pages('8-', 10)).toEqual([7, 8, 9])
    expect(pages('-3', 10)).toEqual([0, 1, 2])
  })

  it('keeps repeats and the order they were asked for', () => {
    // A cover sheet used twice is a real request, and `3, 1` is how a range
    // doubles as a reordering. Neither may be quietly tidied away.
    expect(pages('1,1,2')).toEqual([0, 0, 1])
    expect(pages('3,1')).toEqual([2, 0])
  })

  it('refuses a page the document does not have, and says where it ends', () => {
    expect(pages('11', 10)).toBe('This document ends at page 10, so page 11 is not in it.')
    expect(pages('5-20', 10)).toBe('This document ends at page 10, so page 20 is not in it.')
  })

  it('refuses page zero, because people count from one', () => {
    expect(pages('0')).toBe('Pages are numbered from 1.')
    expect(pages('0-2')).toBe('Pages are numbered from 1.')
  })

  it('refuses a backwards span and says how to write it', () => {
    expect(pages('5-3')).toBe("'5-3' counts backwards. Write it as 3-5.")
  })

  it('refuses what is not a page number at all', () => {
    expect(pages('two')).toBe("'two' is not a page number.")
    expect(pages('1;2')).toBe("'1;2' is not a page number.")
    expect(pages('1,,2')).toBe('There is an empty range between two commas.')
    expect(pages('-')).toBe("'-' names no pages.")
  })

  it('refuses a document with no pages rather than returning nothing', () => {
    expect(pages('1', 0)).toBe('That document has no pages.')
  })
})

describe('printing a page range back', () => {
  it('collapses a run that is already in order', () => {
    expect(formatPageRange([0, 1, 2, 4])).toBe('1-3, 5')
    expect(formatPageRange([0])).toBe('1')
    expect(formatPageRange([])).toBe('')
  })

  it('leaves a reordering alone rather than making it read as a span', () => {
    expect(formatPageRange([2, 0])).toBe('3, 1')
  })

  it('round-trips an ordered selection', () => {
    const text = '1-3, 5, 8-10'
    const read = parsePageRange(text, 10)
    expect(read.ok && formatPageRange(read.pages)).toBe(text)
  })
})
