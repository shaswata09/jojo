import { describe, expect, it } from 'vitest'
import { LABEL_DY, LABEL_SIZE, MIN_LABEL_PX, labelMetrics, labelScale } from './labels'

describe('free-layout labels on a small screen', () => {
  it('leaves labels alone where they are already legible', () => {
    expect(labelScale(1.2)).toBe(1)
    expect(labelScale(MIN_LABEL_PX / LABEL_SIZE)).toBe(1)
  })

  it('grows them on a phone so a name draws at least the minimum CSS size', () => {
    // 360px wide: a 500 × 620 layout in a 300 × 378 box is 0.6 px per unit,
    // which drew 9.5-unit labels at about 5.7px.
    const fit = 0.6
    const scale = labelScale(fit)
    expect(LABEL_SIZE * fit).toBeLessThan(6)
    expect(LABEL_SIZE * scale * fit).toBeGreaterThanOrEqual(MIN_LABEL_PX)
    // Stepped, so a resize by a pixel does not re-measure every label.
    expect(Math.round(scale * 20)).toBe(scale * 20)
  })

  it('scales the geometry the collision pass uses with the text it draws', () => {
    const m = labelMetrics(2)
    expect(m.size).toBe(LABEL_SIZE * 2)
    expect(m.dy).toBe(LABEL_DY * 2)
    expect(labelMetrics().size).toBe(LABEL_SIZE)
    expect(labelScale(0)).toBe(1)
  })
})
