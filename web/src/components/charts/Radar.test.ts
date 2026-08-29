import { describe, expect, it } from 'vitest'
import { H, LABEL_RING, plot, ringPoint, W } from './Radar'

/**
 * The two rings this chart draws things on, and why they are two functions.
 *
 * `plot` clamps to 0–100 because it takes series data. The axis labels ask for
 * 128% and used to go through that same clamp, so `point(i, 128)` returned
 * `point(i, 100)` and every label was stamped on the outer ring's own vertex —
 * the 100 units of horizontal gutter the viewBox was widened to 340 to provide
 * went unused, and the labels overlapped the hairline they were meant to stand
 * outside. Nothing caught it because the collapse is silent: a clamp returns a
 * perfectly good coordinate, just not the one that was asked for.
 *
 * Six axes throughout, because that is what `SearchHealth` ships — Sent,
 * Replies, Interviews, Referrals, Follow-ups, Kept moving.
 */
const N = 6

describe('the label ring', () => {
  it('is outside the plot edge on every axis', () => {
    for (let i = 0; i < N; i++) {
      const [lx, ly] = ringPoint(i, N, LABEL_RING)
      const [ex, ey] = plot(i, N, 100)
      const centre = [W / 2, H / 2] as const

      const labelRadius = Math.hypot(lx - centre[0], ly - centre[1])
      const edgeRadius = Math.hypot(ex - centre[0], ey - centre[1])

      expect(labelRadius).toBeGreaterThan(edgeRadius)
    }
  })

  it('is the ratio the constant names', () => {
    const centre = [W / 2, H / 2] as const
    const [lx, ly] = ringPoint(1, N, LABEL_RING)
    const [ex, ey] = plot(1, N, 100)

    const ratio =
      Math.hypot(lx - centre[0], ly - centre[1]) / Math.hypot(ex - centre[0], ey - centre[1])

    expect(ratio).toBeCloseTo(LABEL_RING / 100, 6)
  })

  /**
   * The gutter is finite: at 128% the anchor for the right-hand labels sits at
   * x≈256, leaving ~84 units for text that starts there. This is the guard on
   * pushing the ring further out — a bigger LABEL_RING would clip the labels
   * off the viewBox, which is the bug the 340 width was cut to fix.
   */
  it('leaves every anchor inside the viewBox', () => {
    for (let i = 0; i < N; i++) {
      const [x, y] = ringPoint(i, N, LABEL_RING)
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(W)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(H)
    }
  })
})

describe('a plotted value', () => {
  it('is clamped, because a score is computed elsewhere', () => {
    expect(plot(0, N, 128)).toEqual(plot(0, N, 100))
    expect(plot(0, N, -20)).toEqual(plot(0, N, 0))
  })

  it('starts at 12 o_clock and goes clockwise', () => {
    const [x, y] = plot(0, N, 100)
    expect(x).toBeCloseTo(W / 2, 6)
    expect(y).toBeLessThan(H / 2)

    // The next axis is to the RIGHT of centre, not the left.
    expect(plot(1, N, 100)[0]).toBeGreaterThan(W / 2)
  })
})

/**
 * And that the component asks the UNCLAMPED helper for them.
 *
 * Splitting the helper in two fixes nothing on its own: the original bug was
 * one call site handing 128 to a function that clamped at 100, and putting the
 * label call back to `point(i, LABEL_RING)` reproduces it exactly. Measured —
 * with that one line reverted, every assertion above still passed, because they
 * all test the geometry and none of them tests which geometry gets used.
 *
 * Read off the source because D20 bans mounting; the `?raw` glob is the same
 * technique `RowMenu.test.ts` uses to assert something the compiler cannot.
 */
const sources = import.meta.glob('/src/components/charts/Radar.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('the label call site', () => {
  const source = sources['/src/components/charts/Radar.tsx'] ?? ''

  it('was found', () => {
    expect(source).toContain('export function Radar')
  })

  it('places the axis labels with the unclamped helper', () => {
    // The <text> block that draws the axis labels, and only it.
    const labels = /axes\.map\(\(label, i\) => \{[\s\S]*?\}\)\}/.exec(source)?.[0] ?? ''
    expect(labels).not.toBe('')
    expect(labels).toContain('ringPoint(i, n, LABEL_RING)')
    // `point` is the clamped one — asking it for 128 is the bug itself.
    expect(labels).not.toMatch(/\bpoint\(i,\s*(128|LABEL_RING)\)/)
  })

  it('plots series data with the clamped one', () => {
    expect(source).toMatch(/const point = \(i: number, value: number\) => plot\(i, n, value\)/)
  })
})
