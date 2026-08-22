/**
 * A pie chart's geometry, as data.
 *
 * Both apps draw this chart and both draw it with SVG — the web with `<svg>`,
 * the phone with `react-native-svg` — so the path strings are not merely
 * similar between them, they are the same characters. That is the whole reason
 * this is here rather than twice in `components/`: `check-no-copies` exists
 * because a chart's arithmetic is exactly the sort of thing that gets pasted
 * and then drifts, and the drift is invisible until two platforms disagree
 * about what 33% looks like.
 *
 * Pure by construction — no colour, no label, no React. Colour is a platform
 * token (`STAGE_DOT` is a Tailwind class on the web and a palette lookup on the
 * phone, and neither may travel through this layer), so a caller pairs these
 * slices with its own colours by `key`.
 *
 * Coordinates are a fixed 100 × 100 box. The renderer sets the drawn size with
 * `width`/`height` and lets `viewBox` scale it, which keeps every number below
 * an integer-ish constant instead of a function of the caller's layout.
 */

/** Half of `BOX`, and the centre of the circle. */
const BOX = 100
const C = BOX / 2
/** Leaves a hair of room so a stroked separator is not clipped by the viewBox. */
const R = 49

export type PieInput = {
  key: string
  value: number
}

export type PieSlice = {
  key: string
  value: number
  /** 0–1 of the visible total. */
  share: number
  /**
   * 0–100, and these SUM TO 100 across the returned slices.
   *
   * Rounded by largest remainder rather than independently. Three equal slices
   * rounded on their own read 33 / 33 / 33 and invite the reader to wonder
   * where the last percent went; the same three here read 34 / 33 / 33.
   */
  percent: number
  /** An SVG `d` for the wedge, in the 100 × 100 box. */
  path: string
}

const point = (angle: number) => {
  // From twelve o'clock, clockwise — the direction a pie is read, and the one
  // the funnel's first stage should start at.
  const rad = ((angle - 90) * Math.PI) / 180
  return { x: C + R * Math.cos(rad), y: C + R * Math.sin(rad) }
}

/**
 * The whole circle, as one path.
 *
 * A wedge of exactly 360° cannot be drawn as an arc: its start and end points
 * are the same coordinate, and `A` between two identical points is a no-op, so
 * the one case where a single stage holds every application would render as
 * nothing at all. Two half-arcs is the standard answer and the only special
 * case in this file.
 */
const fullCircle = () =>
  `M ${String(C)} ${String(C - R)} ` +
  `A ${String(R)} ${String(R)} 0 1 1 ${String(C)} ${String(C + R)} ` +
  `A ${String(R)} ${String(R)} 0 1 1 ${String(C)} ${String(C - R)} Z`

const wedge = (from: number, to: number) => {
  const a = point(from)
  const b = point(to)
  const large = to - from > 180 ? 1 : 0
  return (
    `M ${String(C)} ${String(C)} ` +
    `L ${a.x.toFixed(3)} ${a.y.toFixed(3)} ` +
    `A ${String(R)} ${String(R)} 0 ${String(large)} 1 ${b.x.toFixed(3)} ${b.y.toFixed(3)} Z`
  )
}

/**
 * Percentages that add up.
 *
 * Largest remainder: floor everything, then hand the leftover points to
 * whichever slices lost the most in the floor. Ties go to the earlier slice, so
 * the result is a function of the input order rather than of sort stability.
 */
function percents(shares: readonly number[]): number[] {
  const exact = shares.map((s) => s * 100)
  const out = exact.map(Math.floor)
  let left = 100 - out.reduce((n, v) => n + v, 0)
  const order = exact
    .map((v, i) => ({ i, rest: v - Math.floor(v) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    // `noUncheckedIndexedAccess` is on, and rightly: `out[i]` is only certainly
    // there because `order` was built from the same array. Read it back rather
    // than asserting it.
    out[i] = (out[i] ?? 0) + 1
    left -= 1
  }
  return out
}

/**
 * Slices for everything with a value, in the order given.
 *
 * Order is the caller's and is never sorted here: the pipeline's six stages are
 * a funnel, and a pie that reordered them by size would stop being readable as
 * the sequence an application moves through.
 *
 * Zero-value entries produce no slice. They are not dropped from the caller's
 * legend — a stage with nothing in it is worth showing as a row reading 0 — but
 * a zero-width wedge is an invisible target that still answers hit-tests, which
 * is how a pie ends up navigating somewhere the reader never aimed at.
 */
export function pieSlices(items: readonly PieInput[]): PieSlice[] {
  const live = items.filter((i) => i.value > 0)
  const total = live.reduce((n, i) => n + i.value, 0)
  if (total <= 0) return []

  const shares = live.map((i) => i.value / total)
  const pct = percents(shares)

  let from = 0
  return live.map((item, i) => {
    const share = shares[i] ?? 0
    const to = from + share * 360
    const path = live.length === 1 ? fullCircle() : wedge(from, to)
    from = to
    return { key: item.key, value: item.value, share, percent: pct[i] ?? 0, path }
  })
}

/** The box every path above is drawn in. Renderers pass this to `viewBox`. */
export const PIE_VIEWBOX = `0 0 ${String(BOX)} ${String(BOX)}`
