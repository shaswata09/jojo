import { useState } from 'react'
import { PIE_VIEWBOX, pieSlices } from '@jojo/service/core/pie'
import { cn } from '@/lib/utils'

export type PieDatum = { key: string; label: string; value: number; color: string }

/**
 * A pie, and a legend that doubles as the value table.
 *
 * The geometry is `@jojo/service/core/pie` — shared with the phone, which draws
 * the identical path strings through `react-native-svg`. Nothing about the
 * arithmetic lives here; this file is the web's rendering of it and the colours,
 * which are a platform token and may not travel through the service layer.
 *
 * WHY THE LEGEND IS THE CONTROL.
 *
 * A wedge is a pointer target: it has no tab stop, no name a screen reader can
 * read, and no way to be reached without a mouse. So the SVG is `role="img"`
 * with one summarising label, and every action is a real `<button>` in the
 * legend beneath it. Pointer users can still hit the wedge — it calls the same
 * handler — but nothing is only reachable that way, which is the rule the rest
 * of this app already follows for charts.
 *
 * A pie is also the wrong chart for precise comparison, which is why the legend
 * is not optional: the wedge shows the share, the row beside it gives the count
 * and the percentage that a wedge cannot be read to.
 */
export function Pie({
  data,
  onSelect,
  ariaLabel,
  className,
}: {
  data: PieDatum[]
  /** Called with the datum's key. Wedge and legend row both route here. */
  onSelect?: (key: string) => void
  ariaLabel: string
  className?: string
}) {
  const [hover, setHover] = useState<string | null>(null)

  const slices = pieSlices(data)
  const total = data.reduce((n, d) => n + d.value, 0)
  const byKey = new Map(slices.map((s) => [s.key, s]))

  return (
    <div className={cn('flex flex-wrap items-center gap-4', className)}>
      <svg
        viewBox={PIE_VIEWBOX}
        className="h-auto w-[152px] shrink-0"
        role="img"
        aria-label={ariaLabel}
      >
        {slices.map((slice) => {
          const datum = data.find((d) => d.key === slice.key)
          const lit = hover === null || hover === slice.key
          return (
            <path
              key={slice.key}
              d={slice.path}
              fill={datum?.color}
              /* The separator is the panel behind it rather than a grey line,
                 so two adjacent wedges are divided by the card's own surface
                 and the ring reads as one shape in either theme. */
              stroke="var(--panel)"
              strokeWidth={1.5}
              opacity={lit ? 1 : 0.55}
              className={cn('transition-opacity duration-150', onSelect && 'cursor-pointer')}
              onMouseEnter={() => setHover(slice.key)}
              onMouseLeave={() => setHover(null)}
              onClick={onSelect ? () => onSelect(slice.key) : undefined}
            />
          )
        })}
      </svg>

      <ul className="min-w-0 flex-1 space-y-0.5">
        {data.map((datum) => {
          const slice = byKey.get(datum.key)
          const empty = slice === undefined
          return (
            <li key={datum.key}>
              <button
                type="button"
                onClick={onSelect ? () => onSelect(datum.key) : undefined}
                onMouseEnter={() => setHover(datum.key)}
                onMouseLeave={() => setHover(null)}
                /* A stage with nothing in it still lists, because the six are a
                   fixed vocabulary and a row vanishing at zero would make the
                   legend reorder itself as records move. It is not a target:
                   there is nothing to go and look at. */
                disabled={empty || !onSelect}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-1 py-1 text-sm transition-colors',
                  empty || !onSelect ? 'cursor-default' : 'hover:bg-row-hover',
                )}
              >
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[2px] border"
                  style={{
                    background: empty ? 'transparent' : datum.color,
                    borderColor: datum.color,
                  }}
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-left',
                    empty ? 'text-text-3' : 'text-text-2',
                  )}
                >
                  {datum.label}
                </span>
                <span className="tabular shrink-0 font-mono text-text-1">
                  {datum.value}
                  <span className="ml-1.5 text-xs text-text-3">
                    {total > 0 ? (slice?.percent ?? 0) : 0}%
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
