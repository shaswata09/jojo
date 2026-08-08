import { useMemo, useState } from 'react'
import { AllHidden, ChartLegend } from '@/components/charts/ChartLegend'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { PERIODS, frequencyByPeriod, type Period, type RoleTag } from '@/data/seed'
import { useRoles } from '@/lib/roles-context'
import { useSeriesToggle } from '@/lib/use-series-toggle'

/** Chart slots, assigned to roles in a fixed order so a role keeps its colour
 *  as the filter changes. */
const SLOT = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
]

const CHARTS = [
  { value: 'bar', label: 'Bars' },
  { value: 'line', label: 'Line' },
] as const
type ChartType = (typeof CHARTS)[number]['value']

const W = 640
const H = 200
const PAD = { top: 10, right: 8, bottom: 28, left: 30 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom

const SEGMENT_GAP = 2
const RADIUS = 3

function topRoundedRect(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, h, w / 2))
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`
}

/** Round the domain up so ticks divide evenly and gridlines stay equally spaced. */
function niceDomain(rawMax: number) {
  for (const step of [1, 2, 5, 10, 20, 50]) {
    const top = Math.ceil(rawMax / (step * 2)) * (step * 2)
    if (top / step <= 6) {
      return { top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) }
    }
  }
  return { top: rawMax, ticks: [0, rawMax] }
}

export function ApplicationFrequency() {
  const [hover, setHover] = useState<number | null>(null)
  const [chart, setChart] = useState<ChartType>('bar')
  const [period, setPeriod] = useState<Period>('week')

  // Roles chosen in the topbar decide which series exist at all; the legend
  // then hides individual ones without changing the global filter.
  const { activeRoles } = useRoles()
  const series = activeRoles.map((role, i) => ({
    key: role as RoleTag,
    label: role,
    color: SLOT[i % SLOT.length],
  }))

  const { toggle, isHidden, allHidden } = useSeriesToggle(series.map((s) => s.key))
  const visible = series.filter((s) => !isHidden(s.key))

  const data = frequencyByPeriod[period]

  const { yMax, ticks } = useMemo(() => {
    // The domain follows what is VISIBLE — hiding a series has to rescale the
    // axis, otherwise the remaining bars shrink into the corner of a plot
    // still sized for data nobody can see.
    // Bars stack, so it is the visible total; lines are separate, so it is the
    // largest single visible series.
    const peak =
      chart === 'bar'
        ? Math.max(...data.map((d) => visible.reduce((n, s) => n + d.counts[s.key], 0)), 1)
        : Math.max(...data.flatMap((d) => visible.map((s) => d.counts[s.key])), 1)
    const { top, ticks } = niceDomain(peak)
    return { yMax: top, ticks }
  }, [data, chart, visible])

  const slot = PLOT_W / data.length
  const barW = slot * 0.68
  const y = (v: number) => PAD.top + PLOT_H * (1 - v / yMax)
  const cx = (i: number) => PAD.left + i * slot + slot / 2
  const centerPct = (i: number) => (cx(i) / W) * 100

  // Label every nth tick so they never collide, whatever the period.
  const labelEvery = Math.ceil(data.length / 7)

  return (
    <Panel className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PanelTitle className="mb-0" hint={`by ${period}`}>
          Application frequency
        </PanelTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Segment label="Period" options={PERIODS} value={period} onChange={setPeriod} />
          <Segment label="Chart type" options={CHARTS} value={chart} onChange={setChart} />
        </div>
      </div>

      <ChartLegend
        className="mb-3"
        items={series.map((s) => ({ key: s.key, label: s.label, color: s.color }))}
        isHidden={isHidden}
        onToggle={toggle}
      />

      {allHidden ? (
        <AllHidden />
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            role="img"
            aria-label={`Applications per ${period}, split by ${activeRoles.join(', ')}`}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--hairline)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={y(t) + 4}
                  textAnchor="end"
                  className="fill-text-3 text-[11px]"
                >
                  {t}
                </text>
              </g>
            ))}

            {chart === 'bar'
              ? data.map((d, i) => {
                  const x = PAD.left + i * slot + (slot - barW) / 2
                  const dim = hover !== null && hover !== i
                  // Stack only the visible series, bottom-up. Segments with a
                  // zero value are skipped so they never claim a gap.
                  const parts = visible.filter((s) => d.counts[s.key] > 0)
                  let cursor = y(0)

                  return (
                    <g key={d.label} opacity={dim ? 0.72 : 1}>
                      {parts.map((s, idx) => {
                        const h = (d.counts[s.key] / yMax) * PLOT_H
                        // The 2px gap sits BETWEEN segments, never under the
                        // lowest one and never above the topmost.
                        const gap = idx < parts.length - 1 ? SEGMENT_GAP : 0
                        const top = cursor - h
                        cursor = top - gap
                        const isTop = idx === parts.length - 1
                        return (
                          <path
                            key={s.key}
                            d={
                              isTop
                                ? topRoundedRect(x, top, barW, h, RADIUS)
                                : `M${x},${top} h${barW} v${h - gap} h${-barW} Z`
                            }
                            fill={s.color}
                          />
                        )
                      })}
                    </g>
                  )
                })
              : visible.map((s) => {
                  const pts = data.map((d, i) => `${cx(i)},${y(d.counts[s.key])}`).join(' ')
                  return (
                    <g key={s.key}>
                      <polyline
                        points={pts}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {data.map((d, i) => (
                        <circle
                          key={d.label}
                          cx={cx(i)}
                          cy={y(d.counts[s.key])}
                          r={hover === i ? 4.5 : 3}
                          fill={s.color}
                          stroke="var(--panel)"
                          strokeWidth={1.5}
                        />
                      ))}
                    </g>
                  )
                })}

            {data.map((d, i) =>
              i % labelEvery === 0 ? (
                <text
                  key={d.label}
                  x={cx(i)}
                  y={H - 8}
                  textAnchor="middle"
                  className="fill-text-3 text-[11px]"
                >
                  {d.label}
                </text>
              ) : null,
            )}

            {/* Hit targets are the full slot, and reachable by keyboard and touch. */}
            {data.map((d, i) => (
              <rect
                key={d.label}
                x={PAD.left + i * slot}
                y={PAD.top}
                width={slot}
                height={PLOT_H}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${d.label}: ${visible.map((s) => `${d.counts[s.key]} ${s.label}`).join(', ')}`}
                className="cursor-pointer focus-visible:outline-2 focus-visible:outline-accent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onTouchStart={() => setHover(i)}
              />
            ))}
          </svg>

          {hover !== null && data[hover] && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-hairline bg-raised px-2.5 py-2 text-xs whitespace-nowrap shadow-[var(--shadow-raised)]"
              style={{ left: `${centerPct(hover)}%` }}
            >
              <div className="font-medium">{data[hover].label}</div>
              {visible.map((s) => (
                <div key={s.key} className="mt-1 flex items-center gap-1.5 text-text-2">
                  <span
                    aria-hidden
                    className="size-1.5 rounded-[2px]"
                    style={{ background: s.color }}
                  />
                  {s.label}
                  <span className="tabular ml-auto pl-3 font-mono text-text-1">
                    {data[hover].counts[s.key]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <table className="sr-only">
        <caption>Applications submitted per {period}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              {series.map((s) => (
                <td key={s.key}>{d.counts[s.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}
