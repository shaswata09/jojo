import { intlLocale } from '@jojo/service/core/intl-locale'
import {
  CX,
  CY,
  H,
  LABEL_RING,
  RINGS,
  W,
  plot,
  ringPoint,
} from '@/components/charts/radar-geometry'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type RadarSeries = { label: string; color: string; values: number[] }

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
  const { t, i18n } = useTranslation('charts')
  const n = axes.length
  const point = (i: number, value: number) => plot(i, n, value)
  const polygon = (values: number[]) => values.map((v, i) => point(i, v).join(',')).join(' ')

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-w-[340px]"
        role="img"
        aria-label={t('radar.aria', {
          series: new Intl.ListFormat(intlLocale(i18n.language), { type: 'conjunction' }).format(
            series.map((s) => s.label),
          ),
          axes: new Intl.ListFormat(intlLocale(i18n.language), { type: 'unit' }).format(axes),
        })}
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
