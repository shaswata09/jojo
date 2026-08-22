import { describe, expect, it } from 'vitest'
import { PIE_VIEWBOX, pieSlices } from './pie'

/**
 * The two cases a hand-written pie always gets wrong are the ones with no
 * middle: a total of zero, and a single slice holding everything. Both are
 * reachable from the pipeline card on a real store — an empty data set, and a
 * user whose applications are all still drafts — so both are asserted first.
 */
describe('pieSlices', () => {
  it('returns nothing when there is nothing', () => {
    expect(pieSlices([])).toEqual([])
    expect(pieSlices([{ key: 'draft', value: 0 }])).toEqual([])
  })

  it('draws a single 100% slice as a closed circle, not a zero-length arc', () => {
    const [only] = pieSlices([{ key: 'draft', value: 7 }])
    expect(only?.percent).toBe(100)
    expect(only?.share).toBe(1)
    // Two arcs. One `A` between identical endpoints renders nothing at all,
    // which is the bug this asserts against.
    expect(only?.path.match(/A /g)).toHaveLength(2)
  })

  it('omits zero-value entries rather than emitting invisible wedges', () => {
    const slices = pieSlices([
      { key: 'draft', value: 3 },
      { key: 'submitted', value: 0 },
      { key: 'offer', value: 1 },
    ])
    expect(slices.map((s) => s.key)).toEqual(['draft', 'offer'])
  })

  it('keeps the caller order — a funnel must not be re-sorted by size', () => {
    const slices = pieSlices([
      { key: 'draft', value: 1 },
      { key: 'submitted', value: 9 },
      { key: 'offer', value: 4 },
    ])
    expect(slices.map((s) => s.key)).toEqual(['draft', 'submitted', 'offer'])
  })

  it('adds up to exactly 100%, including the thirds that would round to 99', () => {
    const thirds = pieSlices([
      { key: 'a', value: 1 },
      { key: 'b', value: 1 },
      { key: 'c', value: 1 },
    ])
    expect(thirds.map((s) => s.percent)).toEqual([34, 33, 33])
    expect(thirds.reduce((n, s) => n + s.percent, 0)).toBe(100)

    const sevenths = pieSlices(Array.from({ length: 7 }, (_, i) => ({ key: String(i), value: 1 })))
    expect(sevenths.reduce((n, s) => n + s.percent, 0)).toBe(100)
  })

  it('shares are proportional and sum to one', () => {
    const slices = pieSlices([
      { key: 'a', value: 3 },
      { key: 'b', value: 1 },
    ])
    expect(slices[0]?.share).toBeCloseTo(0.75)
    expect(slices.reduce((n, s) => n + s.share, 0)).toBeCloseTo(1)
  })

  it('starts the first wedge at twelve o clock', () => {
    const [first] = pieSlices([
      { key: 'a', value: 1 },
      { key: 'b', value: 1 },
    ])
    // Centre, then straight up to the top of the circle before the arc starts.
    expect(first?.path.startsWith('M 50 50 L 50.000 1.000')).toBe(true)
  })

  it('flags the large-arc bit only past a half turn', () => {
    const [big, small] = pieSlices([
      { key: 'big', value: 3 },
      { key: 'small', value: 1 },
    ])
    // `A rx ry rot largeArc sweep x y` — the fourth number after `A`.
    expect(/A 49 49 0 1 1/.test(big?.path ?? '')).toBe(true)
    expect(/A 49 49 0 0 1/.test(small?.path ?? '')).toBe(true)
  })

  it('every wedge stays inside the box it declares', () => {
    const slices = pieSlices([
      { key: 'a', value: 5 },
      { key: 'b', value: 3 },
      { key: 'c', value: 2 },
    ])
    const numbers = slices
      .flatMap((s) => s.path.match(/-?\d+\.?\d*/g) ?? [])
      .map(Number)
      .filter((n) => n !== 0 && n !== 1)
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...numbers)).toBeLessThanOrEqual(100)
    expect(PIE_VIEWBOX).toBe('0 0 100 100')
  })
})
