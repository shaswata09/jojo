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
const W = 340
const H = 240
const CX = W / 2
const CY = H / 2
const R = 78
const RINGS = 4

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
  // Start at 12 o'clock and go clockwise, which is how these are read.
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2
  const point = (i: number, value: number) => {
    const r = (Math.max(0, Math.min(100, value)) / 100) * R
    return [CX + r * Math.cos(angle(i)), CY + r * Math.sin(angle(i))] as const
  }
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
          const [x, y] = point(i, 128)
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
