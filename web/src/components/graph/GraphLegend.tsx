import { NODE_TYPE_LABEL } from '@/lib/graph'
import type { GraphNodeType } from '@/lib/graph'
import { cn } from '@/lib/utils'
import { LEGEND_ORDER, TypeSwatch } from './visuals'

/**
 * The key, and the filter — one control rather than two.
 *
 * A legend that only names colours is a second thing to maintain and a wasted
 * click target. Pressing a row hides that kind of node, which is the fastest
 * way to make a dense graph legible: hide keywords and the applications snap
 * into their organisations.
 *
 * Only kinds that exist in this session are listed. A row reading "Snippet 0"
 * would be a legend entry for a colour nothing on the canvas is painted with.
 */
export function GraphLegend({
  counts,
  hidden,
  onToggle,
  onShowAll,
}: {
  counts: ReadonlyMap<GraphNodeType, number>
  hidden: ReadonlySet<GraphNodeType>
  onToggle: (type: GraphNodeType) => void
  onShowAll: () => void
}) {
  const present = LEGEND_ORDER.filter((type) => (counts.get(type) ?? 0) > 0)
  const allHidden = present.length > 0 && present.every((type) => hidden.has(type))

  if (present.length === 0) return null

  return (
    <div className="mt-3">
      <ul className="flex flex-wrap gap-1">
        {present.map((type) => {
          const off = hidden.has(type)
          return (
            <li key={type}>
              <button
                type="button"
                onClick={() => onToggle(type)}
                aria-pressed={!off}
                title={off ? `Show ${NODE_TYPE_LABEL[type]}` : `Hide ${NODE_TYPE_LABEL[type]}`}
                className={cn(
                  'pressable flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs transition-colors hover:bg-row-hover',
                  off ? 'text-text-3' : 'text-text-2',
                )}
              >
                <span className={cn(off && 'opacity-40')}>
                  <TypeSwatch type={type} />
                </span>
                <span className={cn(off && 'line-through decoration-1')}>
                  {NODE_TYPE_LABEL[type]}
                </span>
                <span className="tabular font-mono text-text-3">{counts.get(type)}</span>
              </button>
            </li>
          )
        })}
      </ul>

      {/* Hiding every kind leaves an empty frame, which reads as the component
          having broken rather than as a filter being on. */}
      {allHidden ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-3">
          Every kind of record is hidden.
          <button
            type="button"
            onClick={onShowAll}
            className="pressable cursor-pointer rounded-sm border border-hairline bg-well px-2 py-0.5 text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1"
          >
            Show all
          </button>
        </div>
      ) : null}
    </div>
  )
}
