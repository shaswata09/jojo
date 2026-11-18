/**
 * The arithmetic under the phone's overview and focus canvases: which names
 * fit, how a pinch maps onto the picture, and which mark a finger meant.
 *
 * Pure, so it is tested on node (`graph-view.requests.test.ts`). The zoom
 * functions are worklets as well, because a pinch runs them on the UI thread.
 */

/* --------------------------------- labels --------------------------------- */

export type LabelCandidate = {
  id: string
  /** Anchor point: the mark's centre, in screen pixels. */
  x: number
  y: number
  text: string
  /** Higher keeps its label when two collide. */
  rank: number
  /** Which side of the mark the name sits on. `start`/`end` are right/left, physically. */
  placement: 'below' | 'above' | 'start' | 'end'
  /** The mark's radius, so a name below clears it. */
  r: number
  size?: number
}

export type PlacedLabel = LabelCandidate & {
  tx: number
  ty: number
  /** The SVG text anchor, physical: `start` is the text's left edge. */
  anchor: 'start' | 'middle' | 'end'
}

type Box = { left: number; right: number; top: number; bottom: number }

const overlaps = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/** A width the eye agrees with: CJK glyphs are about a full em, the rest about half. */
export function estimateWidth(text: string, size: number): number {
  let em = 0
  for (const ch of text) em += /[⺀-鿿가-힯＀-￯]/.test(ch) ? 1 : 0.56
  return em * size
}

export function truncateLabel(text: string, max = 28): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Places what fits, highest rank first, ties in input order — the web's
 * `pickLabels`, with physical anchors: react-native-svg lays text out
 * left-to-right whatever the app's direction, so the side a name runs to is
 * decided here rather than by the writing direction.
 */
export function pickLabels(
  candidates: readonly LabelCandidate[],
  {
    blocked = [] as readonly Box[],
    limit = Infinity,
    bounds,
  }: {
    blocked?: readonly Box[]
    limit?: number
    bounds?: { width: number; height: number }
  } = {},
): PlacedLabel[] {
  const order = candidates
    .map((c, at) => ({ c, at }))
    .sort((a, b) => b.c.rank - a.c.rank || a.at - b.at)
  const taken: Box[] = [...blocked]
  const out: PlacedLabel[] = []
  for (const { c } of order) {
    if (out.length >= limit) break
    const size = c.size ?? 11
    const w = estimateWidth(c.text, size) + 4
    const h = size * 1.15
    const inside = (b: Box) =>
      !bounds || (b.left >= 0 && b.right <= bounds.width && b.top >= 0 && b.bottom <= bounds.height)
    const at = (placement: LabelCandidate['placement']) => {
      if (placement === 'below' || placement === 'above') {
        const ty = placement === 'below' ? c.y + c.r + size + 1 : c.y - c.r - size * 0.3 - 2
        const tx = bounds ? Math.max(w / 2, Math.min(bounds.width - w / 2, c.x)) : c.x
        return {
          tx,
          ty,
          anchor: 'middle' as const,
          box: { left: tx - w / 2, right: tx + w / 2, top: ty - size, bottom: ty - size + h },
        }
      }
      const right = placement === 'start'
      const tx = right ? c.x + c.r + 4 : c.x - c.r - 4
      const ty = c.y + size * 0.35
      return {
        tx,
        ty,
        anchor: right ? ('start' as const) : ('end' as const),
        box: right
          ? { left: tx, right: tx + w, top: ty - size, bottom: ty - size + h }
          : { left: tx - w, right: tx, top: ty - size, bottom: ty - size + h },
      }
    }
    const tries =
      c.placement === 'below' || c.placement === 'above'
        ? [at(c.placement)]
        : [at(c.placement), at(c.placement === 'start' ? 'end' : 'start')]
    const spot = tries.find((p) => inside(p.box) && !taken.some((t) => overlaps(t, p.box)))
    if (!spot) continue
    taken.push(spot.box)
    out.push({ ...c, tx: spot.tx, ty: spot.ty, anchor: spot.anchor })
  }
  return out
}

/* ---------------------------------- zoom ---------------------------------- */

/** Screen = layout · k + (x, y). Fit is k = 1, which is what the layout already is. */
export type ZoomView = { readonly k: number; readonly x: number; readonly y: number }

export const MAX_ZOOM = 8
export const ZOOM_STEP = 1.6
export const FIT: ZoomView = { k: 1, x: 0, y: 0 }

/** Never out past fit, never in past `MAX_ZOOM`, and never dragged off the box. */
export function clampView(view: ZoomView, width: number, height: number): ZoomView {
  'worklet'
  const k = Math.max(1, Math.min(MAX_ZOOM, view.k))
  return {
    k,
    x: Math.max(width * (1 - k), Math.min(0, view.x)),
    y: Math.max(height * (1 - k), Math.min(0, view.y)),
  }
}

/** The view after zooming by `factor` about the screen point (cx, cy), which stays put. */
export function zoomAbout(
  view: ZoomView,
  factor: number,
  cx: number,
  cy: number,
  width: number,
  height: number,
): ZoomView {
  'worklet'
  const k = Math.max(1, Math.min(MAX_ZOOM, view.k * factor))
  const ratio = k / view.k
  return clampView(
    { k, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio },
    width,
    height,
  )
}

/* ------------------------------- hit testing ------------------------------ */

/**
 * The mark a finger meant: the nearest one within `reach` screen pixels of the
 * tap. A fingertip covers several marks on a dense overview, so the nearest
 * wins rather than the topmost; zooming in is how to reach a crowded one.
 */
export function nearestMark(
  marks: Iterable<{ id: string; x: number; y: number }>,
  at: { x: number; y: number },
  reach: number,
): string | null {
  let best: string | null = null
  let bestD = reach * reach
  for (const m of marks) {
    const d = (m.x - at.x) ** 2 + (m.y - at.y) ** 2
    if (d <= bestD) {
      best = m.id
      bestD = d
    }
  }
  return best
}

/* --------------------------------- batching -------------------------------- */

/**
 * Many dots as ONE path: two arcs per circle. react-native-svg mounts every
 * element as a native view, and measured on the emulator with a 500-application
 * store, five hundred `<Circle>`s cost about seven seconds of the overview's
 * first paint in a debug build; one path per colour costs next to nothing. The
 * marks need no element each — a tap is hit-tested (`nearestMark`) and
 * TalkBack reaches each record through the Groups list.
 */
export function circlesPath(dots: readonly { x: number; y: number; r: number }[]): string {
  let d = ''
  for (const { x, y, r } of dots) {
    const left = (x - r).toFixed(2)
    const cy = y.toFixed(2)
    const rr = r.toFixed(2)
    const across = (2 * r).toFixed(2)
    d += `M${left} ${cy}a${rr} ${rr} 0 1 0 ${across} 0a${rr} ${rr} 0 1 0 -${across} 0Z`
  }
  return d
}

/** Many lines as one path, for the same reason. */
export function segmentsPath(
  segments: readonly { a: { x: number; y: number }; b: { x: number; y: number } }[],
): string {
  let d = ''
  for (const { a, b } of segments) {
    d += `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`
  }
  return d
}
