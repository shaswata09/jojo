import { describe, expect, it } from 'vitest'
import { STATUS_HEADLINE, STATUS_POINTS, STATUS_SUMMARY } from './status'

/*
 * The apps import this module, so they cannot drift from it.
 *
 * `README.md` and `NOTICE` are plain text and CAN drift, but they are checked
 * by `scripts/check-status.mjs` rather than here: L1 core may import nothing
 * outside itself, and that rule covers its tests — reading the repository from
 * a core test is exactly the coupling the layer guard exists to prevent.
 */

describe('the statement itself', () => {
  it('does not claim to restrict what the licence grants', () => {
    /*
     * The trap this guards against. Apache-2.0 grants the right to use, modify
     * and redistribute; a notice cannot take that back. Wording like "you may
     * not distribute" would leave a reader wrong about their actual rights,
     * which is a worse outcome than no notice at all.
     *
     * The permitted phrasing is a REQUEST ("we ask that"), not a prohibition.
     */
    const all = [STATUS_SUMMARY, ...STATUS_POINTS.map((p) => p.body)].join(' ').toLowerCase()
    for (const forbidden of [
      'may not distribute',
      'must not distribute',
      'do not distribute',
      'prohibited',
      'not permitted',
      'no redistribution',
    ]) {
      expect(all, forbidden).not.toContain(forbidden)
    }
    // And it says plainly that the grant stands.
    expect(all).toContain('grant stands')
  })

  it('says the three things a reader needs before trusting it', () => {
    const all = [STATUS_HEADLINE, STATUS_SUMMARY, ...STATUS_POINTS.map((p) => p.body)]
      .join(' ')
      .toLowerCase()
    expect(all).toContain('backup')
    expect(all).toContain('no warranty')
    expect(all).toContain('research')
  })

  it('has a label and a body for every point, with no empty text', () => {
    expect(STATUS_POINTS.length).toBeGreaterThanOrEqual(4)
    for (const point of STATUS_POINTS) {
      expect(point.label.trim().length, point.label).toBeGreaterThan(0)
      expect(point.body.trim().length, point.label).toBeGreaterThan(40)
    }
  })
})
