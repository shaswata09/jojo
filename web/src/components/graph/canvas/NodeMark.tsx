/**
 * One record on the canvas: its glyph, its selection ring, its label.
 *
 * A real `<g>` per node rather than a canvas draw call, so every record is
 * focusable, hoverable, nameable and reachable by Tab. It carries no position —
 * the `transform` is written straight to the element by the simulation, and a
 * position passed as a prop would be clobbered by the next re-render for hover.
 */

import { NodeGlyph } from '@/components/graph/NodeGlyph'
import { nodeRadius } from '@/components/graph/visuals'
import { NODE_TYPE_LABEL } from '@/lib/graph/model'
import type { GraphNode } from '@/lib/graph/model'
import { LABEL_DY, LABEL_SIZE, truncate } from './labels'
import type { NodeDragHandlers } from './use-node-drag'

/** A hub is labelled whatever else is going on: it is the shape of the graph. */
const LABEL_DEGREE = 4

export function NodeMark({
  node,
  lit,
  labelEverything,
  selectedId,
  onSelect,
  setHover,
  setFocus,
  drag,
  groupRef,
  labelRef,
}: {
  node: GraphNode
  /** Null when nothing is lit; otherwise what stays at full opacity. */
  lit: { nodes: ReadonlySet<string>; edges: ReadonlySet<string> } | null
  labelEverything: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  setHover: React.Dispatch<React.SetStateAction<string | null>>
  setFocus: React.Dispatch<React.SetStateAction<string | null>>
  drag: NodeDragHandlers
  groupRef: (el: SVGGElement | null) => void
  labelRef: (el: SVGTextElement | null) => void
}) {
  const r = nodeRadius(node.degree)
  const selected = selectedId === node.id
  const dim = lit !== null && !lit.nodes.has(node.id)
  // Hubs are labelled always; everything else earns its label by being
  // part of what you are looking at. Labelling all ninety at rest turns
  // the canvas into overlapping type and hides the shape of the graph,
  // which is the one thing it exists to show.
  const showLabel =
    labelEverything || node.degree >= LABEL_DEGREE || selected || (lit !== null && !dim)

  return (
    <g
      ref={groupRef}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`${node.label}. ${NODE_TYPE_LABEL[node.type]}, ${node.degree} ${
        node.degree === 1 ? 'connection' : 'connections'
      }`}
      className="cursor-pointer"
      opacity={dim ? 0.25 : 1}
      onPointerDown={(event) => drag.onPointerDown(event, node.id)}
      onPointerMove={drag.onPointerMove}
      onPointerUp={(event) => drag.onPointerUp(event, node.id)}
      onPointerCancel={drag.onPointerCancel}
      onPointerEnter={() => setHover(node.id)}
      onPointerLeave={() => setHover((id) => (id === node.id ? null : id))}
      onFocus={() => setFocus(node.id)}
      onBlur={() => setFocus((id) => (id === node.id ? null : id))}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelect(selectedId === node.id ? null : node.id)
      }}
    >
      <title>{node.detail ? `${node.label} — ${node.detail}` : node.label}</title>

      {/* Selection gets a ring; keyboard focus does not need one from
          here. The app's global `:focus-visible` rule already draws an
          outline around this group, and that outline is the one tuned
          to pass 3:1 — a second indicator under it only makes a
          focused, selected node look like a bullseye. */}
      {selected ? <circle r={r + 4.5} fill="none" stroke="var(--accent)" strokeWidth={2} /> : null}

      <NodeGlyph type={node.type} r={r} stroke="var(--panel)" />

      {/* Mounted by the rule above and made visible by the collision
          pass, which owns the `visibility` attribute from here on —
          do not set one as a prop, or a re-render for hover would put
          back a label the pass had just hidden. */}
      {showLabel ? (
        <text
          ref={labelRef}
          y={r + LABEL_DY}
          textAnchor="middle"
          fill="var(--text-2)"
          style={{ fontSize: LABEL_SIZE, pointerEvents: 'none' }}
        >
          {truncate(node.label)}
        </text>
      ) : null}
    </g>
  )
}
