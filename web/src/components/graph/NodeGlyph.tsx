import type { GraphNodeType } from '@/lib/graph/model'
import { NODE_COLOR, NODE_SHAPE } from './visuals'

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
