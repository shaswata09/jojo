import { describe, expect, it } from 'vitest'
import { isWholeDate } from './date-draft'

describe('a date typed one digit at a time', () => {
  it('is not whole while the year is still being typed', () => {
    // What Chrome reports, in order, as 2026 is typed into an en-US field.
    expect(isWholeDate('0002-09-14')).toBe(false)
    expect(isWholeDate('0020-09-14')).toBe(false)
    expect(isWholeDate('0202-09-14')).toBe(false)
    expect(isWholeDate('2026-09-14')).toBe(true)
  })

  it('is not whole when the field is empty or half-filled', () => {
    expect(isWholeDate('')).toBe(false)
    expect(isWholeDate('2026-09')).toBe(false)
  })

  it('refuses a day the month does not have', () => {
    expect(isWholeDate('2026-02-29')).toBe(false)
    expect(isWholeDate('2028-02-29')).toBe(true)
    expect(isWholeDate('2026-13-01')).toBe(false)
    expect(isWholeDate('2026-04-31')).toBe(false)
  })
})
