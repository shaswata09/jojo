import type { GraphNodeType } from '@/lib/graph'

/**
 * How each kind of node looks, in one place.
 *
 * Two rules constrain the palette. Colour law reserves red for past due and
 * amber for due inside 48 hours, so neither `--danger` nor `--warning` can name
 * a node type here — a red dot on this canvas would read as "overdue" to
 * anyone who has used the rest of the app. The `--stage-*` ramp is out for the
 * same reason: it means pipeline stage everywhere else. What is left is the
 * chart palette, which is exactly what this is — a key, not a status.
 *
 * Shape carries the grouping so colour does not have to carry it alone: live
 * records are circles, things filed in the Vault are rounded squares, and the
 * four derived facets — organisation, role, keyword, source — are diamonds,
 * because they are not records at all. That is also the non-colour cue the
 * legend needs to stay readable under colour-blind simulation.
 */
export type NodeShape = 'circle' | 'square' | 'diamond'

/**
 * Declared in legend order — the spine first, then what hangs off it, then the
 * derived facets — because the legend is generated from these keys.
 *
 * Colours are only ever compared *within* a shape family, which is why sage
 * appears twice (a Scout match circle, a Role diamond) and violet twice (a
 * Saved posting circle, a Snippet square): nothing is ambiguous, because the
 * two are never the same silhouette. That freedom is what keeps every type on a
 * token that holds up in both themes — the sequential `--ramp-3` and `--ramp-4`
 * are deliberately unused, because they are built as large sequential fills and
 * at a 6px mark on the light well `--ramp-4` is close to invisible.
 *
 * The one warm hue, `--series-2`, goes to keywords and nowhere else. It is the
 * furthest thing here from `--danger`, and keeping it to a single type means no
 * one can mistake a field of red-ish marks for something being overdue.
 */
export const NODE_COLOR: Record<GraphNodeType, string> = {
  application: 'var(--series-1)',
  item: 'var(--series-3)',
  link: 'var(--ramp-1)',
  file: 'var(--text-2)',
  snippet: 'var(--series-5)',
  posting: 'var(--series-5)',
  match: 'var(--series-4)',
  organisation: 'var(--info)',
  role: 'var(--series-4)',
  keyword: 'var(--series-2)',
  source: 'var(--text-3)',
}

export const NODE_SHAPE: Record<GraphNodeType, NodeShape> = {
  application: 'circle',
  item: 'circle',
  match: 'circle',
  posting: 'circle',
  link: 'square',
  file: 'square',
  snippet: 'square',
  organisation: 'diamond',
  role: 'diamond',
  keyword: 'diamond',
  source: 'diamond',
}

/**
 * Derived from the colour map rather than written out again, so a node type
 * added to the model cannot be missed by the legend — the map is a complete
 * `Record` and will not compile without it.
 */
export const LEGEND_ORDER = Object.keys(NODE_COLOR) as GraphNodeType[]

/**
 * Size by degree, on a square root so a hub with twenty edges is legibly bigger
 * than one with four without being five times the area — linear sizing turns
 * the applications into planets and everything else into dust.
 */
export function nodeRadius(degree: number) {
  return Math.min(17, 5.5 + Math.sqrt(degree) * 2.4)
}

/**
 * The shape itself, centred on the origin, so the canvas and the legend cannot
 * disagree about what a keyword looks like.
 */
export function NodeGlyph({
  type,
  r,
  stroke,
}: {
  type: GraphNodeType
  r: number
  /** Outline colour. Separates nodes that overlap; omit inside a legend swatch. */
  stroke?: string
}) {
  const fill = NODE_COLOR[type]
  const common = { fill, stroke, strokeWidth: stroke ? 1 : undefined }

  if (NODE_SHAPE[type] === 'square') {
    const side = r * 1.72
    return <rect x={-side / 2} y={-side / 2} width={side} height={side} rx={r * 0.34} {...common} />
  }

  if (NODE_SHAPE[type] === 'diamond') {
    const d = r * 1.22
    return <path d={`M0 ${-d} L${d} 0 L0 ${d} L${-d} 0 Z`} {...common} />
  }

  return <circle r={r} {...common} />
}

/** The same glyph at a fixed size, for legends, tables and the detail panel. */
export function TypeSwatch({ type, size = 12 }: { type: GraphNodeType; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-8 -8 16 16" aria-hidden className="shrink-0">
      <NodeGlyph type={type} r={5.5} />
    </svg>
  )
}
