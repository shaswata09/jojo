import { describe, expect, it } from 'vitest'
import { restoreSummary } from './restore-report'

/**
 * The sentence a restore leaves behind.
 *
 * Weighted entirely towards the case that went wrong in the field: a backup
 * holding 275 records, 87 of them written, and a message that mentioned only
 * the 87. Every assertion below about a lost record is guarding that — the
 * count has to appear, the file's own total has to appear beside it so the
 * smaller number cannot read as a success, and the tone has to be the one the
 * panel paints red.
 */
describe('restoreSummary', () => {
  it('is a plain confirmation when the file arrived intact', () => {
    const s = restoreSummary({ held: 87, nodes: 87, documents: 3, skipped: 0 })
    expect(s.title).toBe('Restored')
    expect(s.description).toContain('87 records and 3 documents')
    expect(s.tone).toBeUndefined()
  })

  it('names both numbers when records were lost', () => {
    // The reproduction: the dialog promised 275 and the store took 87.
    const s = restoreSummary({ held: 275, nodes: 87, documents: 0, skipped: 188 })
    expect(s.tone).toBe('danger')
    expect(s.description).toContain('275 records')
    expect(s.description).toContain('87 records')
    expect(s.description).toContain('188 could not be read')
  })

  it('never lets a loss read as a success', () => {
    const s = restoreSummary({ held: 275, nodes: 87, documents: 0, skipped: 188 })
    expect(s.title).not.toMatch(/^Restored$/)
    expect(s.title).toMatch(/could not be restored/i)
  })

  it('does not take the skipped tally for a record count', () => {
    // `skipped` counts records AND links, so it cannot stand in for either.
    // Here one record was lost and 40 rows were refused; the sentence must
    // report the one, not the forty.
    const s = restoreSummary({ held: 100, nodes: 99, documents: 0, skipped: 40 })
    expect(s.description).toContain('1 could not be read')
    expect(s.description).not.toContain('40')
  })

  it('says so when every record survived and only links did not', () => {
    const s = restoreSummary({ held: 100, nodes: 100, documents: 0, skipped: 4 })
    expect(s.title).toBe('Restored, without some links')
    expect(s.description).toContain('4 links')
    expect(s.tone).toBe('danger')
  })

  it('counts one of a thing as one', () => {
    expect(restoreSummary({ held: 1, nodes: 1, documents: 1, skipped: 0 }).description).toContain(
      '1 record and 1 document',
    )
    expect(restoreSummary({ held: 2, nodes: 1, documents: 0, skipped: 1 }).description).toContain(
      '1 could not be read',
    )
    expect(restoreSummary({ held: 5, nodes: 5, documents: 0, skipped: 1 }).description).toContain(
      '1 link between them',
    )
  })

  it('leaves documents out of the sentence when there are none', () => {
    expect(
      restoreSummary({ held: 9, nodes: 9, documents: 0, skipped: 0 }).description,
    ).not.toContain('document')
  })
})
