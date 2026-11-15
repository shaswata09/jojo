/**
 * The values the guide diagrams share that are not components: the dash
 * patterns and the elbow's path. Kept apart from `parts.tsx` so that file
 * exports components only, which is what lets a fast refresh keep its state.
 */

/**
 * Two dash patterns, one per meaning, because there were three for two.
 *
 * `soft` is a relation that is real but optional or repeatable; `derived` is
 * something the app draws but never stores. Keeping them apart by rhythm rather
 * than by colour means they survive both themes and a greyscale print.
 */
export const DASH = {
  soft: '4 3',
  derived: '2 3',
} as const

/**
 * The `d` of an orthogonal route through `points`, each corner rounded by up to
 * `r`. `Elbow` in `parts.tsx` draws it; the reasoning is on that component.
 */
export function roundedPath(points: readonly (readonly [number, number])[], r = 6): string {
  if (points.length < 2) return ''
  const first = points[0]!
  let d = `M ${String(first[0])} ${String(first[1])}`

  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]!
    const corner = points[i]!
    const next = points[i + 1]!

    // How far the corner can be cut without eating either neighbouring run.
    const back = Math.hypot(corner[0] - prev[0], corner[1] - prev[1])
    const on = Math.hypot(next[0] - corner[0], next[1] - corner[1])
    const cut = Math.min(r, back / 2, on / 2)

    const toward = (from: readonly [number, number], to: readonly [number, number], by: number) => {
      const len = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1
      return [from[0] + ((to[0] - from[0]) / len) * by, from[1] + ((to[1] - from[1]) / len) * by]
    }
    const enter = toward(corner, prev, cut)
    const leave = toward(corner, next, cut)

    d += ` L ${String(enter[0])} ${String(enter[1])}`
    d += ` Q ${String(corner[0])} ${String(corner[1])} ${String(leave[0])} ${String(leave[1])}`
  }

  const last = points.at(-1)!
  d += ` L ${String(last[0])} ${String(last[1])}`
  return d
}
