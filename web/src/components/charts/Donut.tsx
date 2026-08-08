import { useState } from 'react'
import { cn } from '@/lib/utils'

export type DonutSlice = { key: string; label: string; value: number; color: string }

const SIZE = 200
const R = 74 // radius of the ring's centre-line
const THICKNESS = 30
const GAP = 2 // surface gap between slices, in path units

/**
 * Donut, drawn as stroked arcs on a single circle.
 *
 * Stroke-dash rather than wedge paths: the arc length maths is one line, the
 * ring thickness is a single value, and the 2px inter-slice gap is just a
 * shortened dash. Infogram's note that a donut can "emphasize a specific data
 * point in the center" is why the hole carries the total.
 */
export function Donut({
  slices,
  centerLabel,
  isHidden,
  onToggle,
  className,
}: {
  slices: DonutSlice[]
  centerLabel: string
  isHidden: (key: string) => boolean
  onToggle: (key: string) => void
  className?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  // Arcs and the centre figure both follow what's visible, so the ring always
  // closes and the total always matches the slices you can actually see.
  const visible = slices.filter((s) => !isHidden(s.key))
  const total = visible.reduce((n, s) => n + s.value, 0)
  const circumference = 2 * Math.PI * R

  let offset = 0

  return (
    <div className={cn('flex flex-wrap items-center gap-4', className)}>
      <div className="relative shrink-0">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-auto w-[168px]"
          role="img"
          aria-label={`${total} ${centerLabel}`}
        >
          {/* Track, so the ring still reads when a slice is tiny. */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--well)"
            strokeWidth={THICKNESS}
          />

          {visible.map((s, i) => {
            const share = total > 0 ? s.value / total : 0
            const len = Math.max(0, share * circumference - GAP)
            const dash = `${len} ${circumference - len}`
            const rotation = (offset / circumference) * 360 - 90
            offset += share * circumference

            return (
              <circle
                key={s.label}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={hover === i ? THICKNESS + 6 : THICKNESS}
                strokeDasharray={dash}
                transform={`rotate(${rotation} ${SIZE / 2} ${SIZE / 2})`}
                className="cursor-pointer transition-[stroke-width] duration-150"
                opacity={hover === null || hover === i ? 1 : 0.75}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            )
          })}
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-xl font-semibold">{total}</span>
          <span className="text-xs text-text-3">{centerLabel}</span>
        </div>
      </div>

      {/* Legend doubles as the value table and the toggle — a donut alone
          can't be read precisely, and every entry switches its slice. */}
      <ul className="min-w-0 flex-1 space-y-0.5">
        {slices.map((s) => {
          const off = isHidden(s.key)
          const vi = visible.findIndex((v) => v.key === s.key)
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => onToggle(s.key)}
                aria-pressed={!off}
                title={off ? `Show ${s.label}` : `Hide ${s.label}`}
                onMouseEnter={() => setHover(vi === -1 ? null : vi)}
                onMouseLeave={() => setHover(null)}
                className="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-sm transition-colors hover:bg-row-hover"
              >
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[2px] border"
                  style={{ background: off ? 'transparent' : s.color, borderColor: s.color }}
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-left',
                    off ? 'text-text-3 line-through decoration-1' : 'text-text-2',
                  )}
                >
                  {s.label}
                </span>
                <span
                  className={cn('tabular shrink-0 font-mono', off ? 'text-text-3' : 'text-text-1')}
                >
                  {s.value}
                  <span className="ml-1.5 text-xs text-text-3">
                    {!off && total > 0 ? Math.round((s.value / total) * 100) : 0}%
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
