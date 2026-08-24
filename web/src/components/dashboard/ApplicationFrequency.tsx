import { useMemo, useState } from 'react'
import { CalendarOff, ClipboardList, Plus } from 'lucide-react'
import { AllHidden, ChartLegend } from '@/components/charts/ChartLegend'
import { bucketKey, bucketKeys, bucketLabel, sentOn } from '@jojo/service/core/frequency'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { Button } from '@/components/ui/button'
import { PERIODS, type Period, type RoleTag } from '@/data/seed'
import { useRoleVocabulary } from '@jojo/service/react/use-roles'
import { useApplications } from '@jojo/service/react/use-applications'
import { useDialogs } from '@/lib/dialogs-context'
import { TODAY } from '@/lib/today'
import { useSeriesToggle } from '@/lib/use-series-toggle'

/** Chart slots, indexed by the store's role order so a role keeps its colour whichever
 *  other roles happen to be in the store. */
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

const PERIOD_NOUN: Record<Period, string> = { week: 'week', month: 'month', quarter: 'quarter' }

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

const blankCounts = (roles: readonly string[]) =>
  Object.fromEntries(roles.map((r) => [r, 0])) as Record<RoleTag, number>

/**
 * When you applied, from your own records.
 *
 * This panel used to import a frozen `frequencyByPeriod` table from the seed
 * and never call `useApplications` at all — so it was literally incapable of
 * being empty, and kept narrating a search after the store had been cleared.
 * Everything below is counted; what cannot be counted is named in the footnote
 * rather than quietly dropped.
 */
export function ApplicationFrequencyBody() {
  const [hover, setHover] = useState<number | null>(null)
  const [chart, setChart] = useState<ChartType>('bar')
  const [period, setPeriod] = useState<Period>('week')

  const { all } = useApplications()
  const vocabulary = useRoleVocabulary()
  const { open } = useDialogs()

  const { data, series, inWindow, undated, earlier, firstLabel } = useMemo(() => {
    const dated = all.filter((a) => sentOn(a) !== undefined)
    const dates = dated.map((a) => sentOn(a) as string)

    // The axis always contains today, so an empty store still draws a frame
    // and a record dated ahead of today still has a bucket to land in.
    const from = dates.reduce((min, d) => (d < min ? d : min), TODAY)
    const to = dates.reduce((max, d) => (d > max ? d : max), TODAY)
    const keys = bucketKeys(from, to, period)

    const counts = new Map(keys.map((k) => [k, blankCounts(vocabulary)]))
    let hit = 0
    for (const a of dated) {
      const row = counts.get(bucketKey(sentOn(a) as string, period))
      if (!row) continue
      row[a.roleTag] += 1
      hit += 1
    }

    return {
      data: keys.map((key) => ({ label: bucketLabel(key, period), counts: counts.get(key)! })),
      // Only the roles actually present get a series — an always-empty legend
      // entry is a filter that filters nothing.
      series: vocabulary
        .filter((role) => dated.some((a) => a.roleTag === role))
        .map((role) => ({
          key: role,
          label: role,
          color: SLOT[vocabulary.indexOf(role) % SLOT.length],
        })),
      inWindow: hit,
      undated: all.length - dated.length,
      earlier: dated.length - hit,
      firstLabel: keys.length > 0 ? bucketLabel(keys[0], period) : '',
    }
  }, [all, period, vocabulary])

  const { toggle, showAll, isHidden, allHidden } = useSeriesToggle(series.map((s) => s.key))
  const visible = series.filter((s) => !isHidden(s.key))

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

  const slot = PLOT_W / Math.max(1, data.length)
  const barW = slot * 0.68
  const y = (v: number) => PAD.top + PLOT_H * (1 - v / yMax)
  const cx = (i: number) => PAD.left + i * slot + slot / 2
  const centerPct = (i: number) => (cx(i) / W) * 100

  // Label every nth tick so they never collide, whatever the period.
  const labelEvery = Math.ceil(data.length / 7)

  const noRecords = all.length === 0
  const noDates = !noRecords && series.length === 0
  const showChart = !noRecords && !noDates

  // What the chart cannot show, said out loud. Silently dropping the records
  // without a date is how the dashboard came to say 13 while this said 12.
  const gaps: string[] = []
  if (undated > 0) gaps.push(`${undated} ${undated === 1 ? 'has' : 'have'} no date yet`)
  if (earlier > 0) gaps.push(`${earlier} ${earlier === 1 ? 'falls' : 'fall'} before ${firstLabel}`)

  return (
    <>
      {/* Hidden at zero: a period switch and a chart-type switch over nothing
          are two controls that change nothing you can see.

          In their own row rather than beside the title, because this body is
          rendered in two places now — its own panel on Statistics, and inside
          `StatsCard` on the dashboard, where the title row already carries the
          switch between statistics. Three segmented controls on one line is a
          line nobody reads. */}
      {showChart ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Segment label="Period" options={PERIODS} value={period} onChange={setPeriod} />
          {/* Pushed to the right, because the two controls are not the same kind
              of thing: the period changes what is being counted and the chart
              type changes how it is drawn. Separating them across the row says
              so without a label, and it puts the drawing control on the same
              edge as the one in the card's title above it.

              `ml-auto` rather than `justify-between` on the row, so that when
              the two do wrap on a narrow card the second still sits right and
              does not stretch away from the first. */}
          <Segment
            className="ml-auto"
            label="Chart type"
            options={CHARTS}
            value={chart}
            onChange={setChart}
          />
        </div>
      ) : null}

      {showChart ? (
        <ChartLegend
          className="mb-3"
          items={series.map((s) => ({ key: s.key, label: s.label, color: s.color }))}
          isHidden={isHidden}
          onToggle={toggle}
        />
      ) : null}

      {noRecords ? (
        <EmptyState
          icon={ClipboardList}
          title="Nothing to chart yet"
          description="This counts the applications you send, week by week, split by the kind of role. Add one and the first bar appears."
          action={
            <Button size="sm" onClick={() => open('application')}>
              <Plus className="size-3.5" strokeWidth={2} aria-hidden />
              New application
            </Button>
          }
        />
      ) : noDates ? (
        <EmptyState
          icon={CalendarOff}
          title="No send dates recorded yet"
          description={
            // Singular-safe: at one record this line read "None of your 1
            // applications", which is the first-run state of this panel.
            all.length === 1
              ? 'Your one application carries no date yet. One is stamped when you move a record to Submitted.'
              : `None of your ${all.length} applications carries a date yet. One is stamped when you move a record to Submitted.`
          }
        />
      ) : allHidden ? (
        <AllHidden onShowAll={showAll} />
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            role="img"
            aria-label={`Applications sent per ${PERIOD_NOUN[period]}, split by ${visible.map((s) => s.label).join(', ')}`}
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
                /*
                 * Not focusable, and not a button.
                 *
                 * The <svg> around these carries role="img", which makes its
                 * whole subtree presentational — so a screen reader announced
                 * none of these while the keyboard still stopped on all twelve.
                 * Twelve tab stops that say nothing is worse than none.
                 *
                 * The alternative already exists and is better: Statistics
                 * renders an sr-only <table> of the same numbers. These stay as
                 * pointer affordances for the hover tooltip, which is what they
                 * were really for.
                 */
                aria-hidden
                className="cursor-pointer"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
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

      {showChart && gaps.length > 0 ? (
        <p className="mt-3 text-xs text-text-3">
          Counting {inWindow} of {all.length} applications — {gaps.join(' and ')}.
        </p>
      ) : null}

      {/* `sr-only` on a <div>, not on the <table>. On a table the utility's
          `width: 1px` is only a minimum — table-layout:auto grows the box to fit
          its content, so this laid out 463px wide, and an absolutely positioned
          box that wide still counts towards the document's scrollable overflow.
          The dashboard and Statistics both scrolled sideways on a phone because
          of it. A block wrapper honours the 1px and clips the table inside. */}
      {showChart ? (
        <div className="sr-only">
          <table>
            <caption>Applications sent per {PERIOD_NOUN[period]}</caption>
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
        </div>
      ) : null}
    </>
  )
}

/**
 * The card, for anywhere that wants only this one.
 *
 * Split from its contents so `StatsCard` can show them under a shared title
 * without nesting one Panel inside another. The period hint that used to sit
 * beside this title went with the split: it read `by week`, and the Period
 * control that says the same thing is now the first thing under the title.
 */
export function ApplicationFrequency() {
  return (
    <Panel className="min-w-0">
      <PanelTitle>When you applied</PanelTitle>
      <ApplicationFrequencyBody />
    </Panel>
  )
}
