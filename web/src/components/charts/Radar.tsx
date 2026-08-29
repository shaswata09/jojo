import { cn } from '@/lib/utils'

export type RadarSeries = { label: string; color: string; values: number[] }

/**
 * Wider than it is tall, and deliberately.
 *
 * The axis labels ring at 128% of R, so on the old square 240 viewBox the two
 * widest ones ran off the left and right edges — "Interview prep" rendered as
 * "erview prep". The plot itself is unchanged; the extra 100 units are gutter
 * for the labels, which only ever grow sideways.
 */
export const W = 340
export const H = 240
const CX = W / 2
const CY = H / 2
const R = 78
const RINGS = 4

/**
 * Where the axis labels sit, as a percentage of R. The gutter in `W` above is
 * cut for exactly this ring.
 */
export const LABEL_RING = 128

// Start at 12 o'clock and go clockwise, which is how these are read.
function angleOf(i: number, n: number) {
  return (Math.PI * 2 * i) / n - Math.PI / 2
}

/**
 * A point on axis `i`, at `pct` percent of the plot radius. NOT clamped, and
 * that is the whole reason it is separate from `plot` below.
 *
 * The clamp used to live in the one shared helper, so the label call — the only
 * caller that asks for anything past the rim — was silently rewritten from 128
 * to 100 and every label was stamped on the outer ring's own vertex, sitting on
 * the hairline it was supposed to stand clear of. Measured: for the six axes
 * this chart ships with, `plot(i, 6, 128)` returned (170, 42), which is exactly
 * `plot(i, 6, 100)`. The file header has claimed a 128% ring since the viewBox
 * was widened to 340 to make room for one, and nothing rendered there.
 *
 * At 128% the widest label ('Interviews', ~50px at 10px) starts at x≈256 and
 * ends near 306, inside the 340 the viewBox gives it.
 */
export function ringPoint(i: number, n: number, pct: number) {
  const r = (pct / 100) * R
  return [CX + r * Math.cos(angleOf(i, n)), CY + r * Math.sin(angleOf(i, n))] as const
}

/**
 * Where a plotted VALUE goes. Clamped, because this one takes series data: a
 * score is computed elsewhere and a negative or a 121 would otherwise draw a
 * polygon vertex inside-out or past the rings that are supposed to scale it.
 */
export function plot(i: number, n: number, value: number) {
  return ringPoint(i, n, Math.max(0, Math.min(100, value)))
}

/**
 * Radar / spider chart on a 0–100 scale.
 *
 * Two series only, and deliberately so: radar overlaps badly past two, and the
 * job here is one subject against one benchmark.
 */
export function Radar({
  axes,
  series,
  className,
}: {
  axes: string[]
  series: RadarSeries[]
  className?: string
}) {
  const n = axes.length
  const point = (i: number, value: number) => plot(i, n, value)
  const polygon = (values: number[]) => values.map((v, i) => point(i, v).join(',')).join(' ')

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-w-[340px]"
        role="img"
        aria-label={`Radar comparing ${series.map((s) => s.label).join(' and ')} across ${axes.join(', ')}`}
      >
        {/* Concentric rings as the scale, spokes to each axis. */}
        {Array.from({ length: RINGS }, (_, ring) => {
          const scale = ((ring + 1) / RINGS) * 100
          return (
            <polygon
              key={ring}
              points={polygon(Array(n).fill(scale))}
              fill="none"
              stroke="var(--hairline)"
              strokeWidth={1}
            />
          )
        })}
        {axes.map((_, i) => {
          const [x, y] = point(i, 100)
          return (
            <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="var(--hairline)" strokeWidth={1} />
          )
        })}

        {series.map((s) => (
          <polygon
            key={s.label}
            points={polygon(s.values)}
            fill={s.color}
            fillOpacity={0.16}
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}

        {/* Markers only on the subject series, so the benchmark stays quiet. */}
        {series[0]?.values.map((v, i) => {
          const [x, y] = point(i, v)
          return <circle key={i} cx={x} cy={y} r={3} fill={series[0].color} />
        })}

        {axes.map((label, i) => {
          const [x, y] = ringPoint(i, n, LABEL_RING)
          return (
            <text
              key={label}
              x={x}
              y={y}
              textAnchor={x < CX - 4 ? 'end' : x > CX + 4 ? 'start' : 'middle'}
              dominantBaseline="middle"
              className="fill-text-3 text-[10px]"
            >
              {label}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
