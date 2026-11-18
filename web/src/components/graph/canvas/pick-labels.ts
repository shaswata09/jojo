/**
 * Which names fit, for the overview and the focus view.
 *
 * The free layout's `labels.ts` measures each label in the DOM because its
 * labels are mounted on every node and moved by the physics. These two views
 * mount a label only when it is wanted and never move it, so a width estimated
 * from the text is enough — and it lets the choice be made before anything is
 * rendered, so no label flashes up and is then hidden.
 *
 * Greedy, highest rank first, ties on input order: what is being looked at
 * keeps its name in a crowd, and the same picture resolves the same way twice.
 */

export type LabelCandidate = {
  id: string
  /** Anchor point: the node's centre. */
  x: number
  y: number
  text: string
  /** Higher keeps its label when two collide. */
  rank: number
  /** How far from the anchor the text sits, and which way it runs. */
  placement: 'below' | 'above' | 'start' | 'end'
  /** The node's radius, so a label below clears it. */
  r: number
  size?: number
}

export type PlacedLabel = LabelCandidate & {
  /** Where the text element goes, and its anchor. */
  tx: number
  ty: number
  anchor: 'start' | 'middle' | 'end'
}

type Box = { left: number; right: number; top: number; bottom: number }

const overlaps = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/** A width the eye agrees with: CJK glyphs are about a full em, Latin about half. */
export function estimateWidth(text: string, size: number): number {
  let em = 0
  for (const ch of text) em += /[⺀-鿿가-힯＀-￯]/.test(ch) ? 1 : 0.56
  return em * size
}

export function truncateLabel(text: string, max = 28): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Places what fits. `start`/`end` are physical sides (right/left of the node);
 * the returned `anchor` is the SVG `text-anchor` that runs the text away from
 * the node in the given writing direction, so Arabic labels grow outward too.
 */
export function pickLabels(
  candidates: readonly LabelCandidate[],
  {
    rtl = false,
    blocked = [] as readonly Box[],
    limit = Infinity,
    bounds,
  }: {
    rtl?: boolean
    blocked?: readonly Box[]
    limit?: number
    /** The drawn box: a label that would leave it moves to the node's other side, or is dropped. */
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
        // Slid along, not dropped, when it would run off a side of the box.
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
        // `start` in SVG follows the writing direction: in Arabic, "start" is
        // the right edge of the text, so the side that grows outward flips.
        anchor: right !== rtl ? ('start' as const) : ('end' as const),
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
