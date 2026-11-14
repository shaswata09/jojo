/**
 * Board: Enter on Rice → the sheet opens → Tab to Databricks, Enter → the
 * sheet shows Databricks → Escape. Focus landed on Rice, because the opener was
 * captured once per mount and the sheet never unmounts between records.
 */
import { describe, expect, it } from 'vitest'
import { nextOpener } from './sheet-opener'

type El = { name: string }
const rice: El = { name: 'Rice card' }
const databricks: El = { name: 'Databricks card' }
const linkInSheet: El = { name: 'a link inside the sheet' }
const sheet = { contains: (el: El) => el === linkInSheet }

describe('nextOpener', () => {
  it('follows the person to the card they opened next', () => {
    expect(nextOpener(rice, databricks, sheet)).toBe(databricks)
  })

  it('keeps the opener when the next record was opened from inside the sheet', () => {
    expect(nextOpener(rice, linkInSheet, sheet)).toBe(rice)
  })

  it('keeps the opener when nothing was focused or pressed', () => {
    expect(nextOpener(rice, null, sheet)).toBe(rice)
  })

  it('takes the first opener before the sheet node exists', () => {
    expect(nextOpener(null, rice, null)).toBe(rice)
  })
})
