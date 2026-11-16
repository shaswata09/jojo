import { describe, expect, it } from 'vitest'
import { sectorRule } from './profile'

/**
 * The profile's sector switches reach the scout (review 2026-11-16). They were
 * stored and read by nothing, so turning industry off changed no round.
 */
describe('sectorRule', () => {
  it('says nothing when both kinds of posting are wanted', () => {
    expect(sectorRule({ includeAcademia: true, includeIndustry: true })).toBe('')
  })

  it('keeps a round to the one kind that is switched on', () => {
    expect(sectorRule({ includeAcademia: true, includeIndustry: false })).toMatch(
      /Only academic postings/,
    )
    expect(sectorRule({ includeAcademia: false, includeIndustry: true })).toMatch(
      /Only industry postings/,
    )
  })

  it('says plainly that nothing is wanted when both are off', () => {
    expect(sectorRule({ includeAcademia: false, includeIndustry: false })).toMatch(
      /propose nothing/,
    )
  })
})
