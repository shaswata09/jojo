/**
 * Where the radar draws things, apart from the component so `Radar.tsx`
 * exports components only, which is what lets a fast refresh keep its state.
 */

/**
 * Wider than it is tall, and deliberately.
 *
 * The axis labels ring at 128% of R, so on the old square 240 viewBox the two
 * widest ones ran off the left and right edges — "Interview prep" rendered as
 * "erview prep". The plot itself is unchanged; the extra 100 units are gutter
 * for the labels, which only ever grow sideways.
 */
export const W = 340
export const H = 240
export const CX = W / 2
export const CY = H / 2
const R = 78
export const RINGS = 4

/**
 * Where the axis labels sit, as a percentage of R. The gutter in `W` above is
 * cut for exactly this ring.
 */
export const LABEL_RING = 128

// Start at 12 o'clock and go clockwise, which is how these are read.
function angleOf(i: number, n: number) {
  return (Math.PI * 2 * i) / n - Math.PI / 2
}

/**
 * A point on axis `i`, at `pct` percent of the plot radius. NOT clamped, and
 * that is the whole reason it is separate from `plot` below.
 *
 * The clamp used to live in the one shared helper, so the label call — the only
 * caller that asks for anything past the rim — was silently rewritten from 128
 * to 100 and every label was stamped on the outer ring's own vertex, sitting on
 * the hairline it was supposed to stand clear of. Measured: for the six axes
 * this chart ships with, `plot(i, 6, 128)` returned (170, 42), which is exactly
 * `plot(i, 6, 100)`. The file header has claimed a 128% ring since the viewBox
 * was widened to 340 to make room for one, and nothing rendered there.
 *
 * At 128% the widest label ('Interviews', ~50px at 10px) starts at x≈256 and
 * ends near 306, inside the 340 the viewBox gives it.
 */
export function ringPoint(i: number, n: number, pct: number) {
  const r = (pct / 100) * R
  return [CX + r * Math.cos(angleOf(i, n)), CY + r * Math.sin(angleOf(i, n))] as const
}

/**
 * Where a plotted VALUE goes. Clamped, because this one takes series data: a
 * score is computed elsewhere and a negative or a 121 would otherwise draw a
 * polygon vertex inside-out or past the rings that are supposed to scale it.
 */
export function plot(i: number, n: number, value: number) {
  return ringPoint(i, n, Math.max(0, Math.min(100, value)))
}
