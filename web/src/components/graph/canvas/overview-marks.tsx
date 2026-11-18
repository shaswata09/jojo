/**
 * The overview's small pieces: one record's mark, the loose stack, and the zoom
 * buttons. Out of `OverviewCanvas` so that file is the wiring — layout, light,
 * zoom — and these are the markup.
 */

import { GROUP_LOOSE } from '@jojo/service/core/graph-view'
import type { ViewNode } from '@jojo/service/core/graph-view'
import { Maximize, Minus, Plus } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { GraphNodeType } from '@/lib/graph/model'
import { NodeGlyph } from '../NodeGlyph'

/**
 * One record in the static layer. Memoised and position-only: nothing about
 * hover, selection or zoom is a prop, so none of them re-renders it.
 */
export const Mark = memo(function Mark({
  node,
  x,
  y,
  r,
  tabbable,
  label,
}: {
  node: ViewNode
  x: number
  y: number
  r: number
  tabbable: boolean
  label: string
}) {
  return (
    <g
      data-id={node.id}
      role="button"
      tabIndex={tabbable ? 0 : -1}
      aria-pressed={false}
      aria-label={label}
      transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
      className="ov-node cursor-pointer"
    >
      <title>{node.label}</title>
      <NodeGlyph type={node.type as GraphNodeType} r={r} stroke="var(--panel)" />
    </g>
  )
})

/** The records linked to nothing, as one counted stack rather than a field of dots. */
export function LooseMark({ x, y, r, label }: { x: number; y: number; r: number; label: string }) {
  return (
    <g
      data-id={GROUP_LOOSE}
      role="button"
      tabIndex={0}
      aria-pressed={false}
      aria-label={label}
      className="ov-node cursor-pointer"
    >
      <title>{label}</title>
      <StackGlyph x={x} y={y} r={r} />
    </g>
  )
}

/** Three stacked squares: many records, none linked. */
export function StackGlyph({ x, y, r }: { x: number; y: number; r: number }) {
  const side = r * 1.5
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
      {[2, 1, 0].map((step) => (
        <rect
          key={step}
          x={-side / 2 + step * 3}
          y={-side / 2 - step * 3}
          width={side}
          height={side}
          rx={side * 0.2}
          fill="var(--text-2)"
          stroke="var(--panel)"
          opacity={1 - step * 0.25}
        />
      ))}
    </g>
  )
}

/**
 * Zoom in, zoom out, fit. Real buttons in the Tab order, named, with the key
 * each one answers to in its tooltip (+, −, 0 work anywhere on the canvas).
 */
export function ZoomControls({
  zoomed,
  atMax,
  onIn,
  onOut,
  onFit,
}: {
  zoomed: boolean
  atMax: boolean
  onIn: () => void
  onOut: () => void
  onFit: () => void
}) {
  const { t } = useTranslation('graph')
  return (
    <div
      role="group"
      aria-label={t('view.zoom.label')}
      className="absolute end-2 bottom-2 z-10 flex gap-1 rounded-lg border border-hairline bg-panel p-0.5"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onIn}
        disabled={atMax}
        aria-label={t('view.zoom.in')}
        title={`${t('view.zoom.in')} (+)`}
      >
        <Plus className="size-3.5" strokeWidth={2} aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onOut}
        disabled={!zoomed}
        aria-label={t('view.zoom.out')}
        title={`${t('view.zoom.out')} (−)`}
      >
        <Minus className="size-3.5" strokeWidth={2} aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onFit}
        disabled={!zoomed}
        aria-label={t('view.zoom.fit')}
        title={`${t('view.zoom.fit')} (0)`}
      >
        <Maximize className="size-3.5" strokeWidth={2} aria-hidden />
      </Button>
    </div>
  )
}
