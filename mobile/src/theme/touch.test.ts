/**
 * The rule that decides how big a control is under a thumb.
 *
 * There is no rendered measurement available here — D20 forbids mounting and
 * there is no device in the loop — so what CAN be pinned is the arithmetic that
 * call sites depend on, and the fact that it targets 44 rather than WCAG's 24.
 * A `slopFor` that quietly stopped reaching `TOUCH_MIN` would leave every call
 * site reading correctly and every target too small.
 */
import { describe, expect, it } from 'vitest'
import { TOUCH_MIN, slopFor } from './tokens'

describe('slopFor', () => {
  it('targets the phone minimum, not the pointer one', () => {
    // 44 is Apple's HIG; WCAG 2.5.8's 24 is a floor for a mouse. Taking the
    // smaller would pass an accessibility audit and still be hard to tap.
    expect(TOUCH_MIN).toBe(44)
  })

  it('brings a control the whole way up, on both sides', () => {
    for (const drawn of [16, 20, 24, 28, 36, 43]) {
      // Slop applies to each edge, so the reachable size is drawn + 2 * slop.
      expect(drawn + 2 * slopFor(drawn)).toBeGreaterThanOrEqual(TOUCH_MIN)
    }
  })

  it('rounds up, so an odd shortfall is not left one point short', () => {
    // 43 needs 0.5 a side. Rounding down gives 43 and passes nothing.
    expect(slopFor(43)).toBe(1)
    expect(slopFor(23)).toBe(11)
  })

  it('asks for nothing when the control is already big enough', () => {
    expect(slopFor(44)).toBe(0)
    expect(slopFor(50)).toBe(0)
  })

  it('covers the stage chip, which is the control that prompted this', () => {
    // ~24 points: `paddingVertical: 3` around a 16-point line plus a border.
    // It had `hitSlop={6}` — a 36-point target on the only control that moves a
    // record between stages.
    expect(24 + 2 * slopFor(24)).toBeGreaterThanOrEqual(TOUCH_MIN)
  })
})
