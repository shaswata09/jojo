import { Radar } from '@/components/charts/Radar'
import { AllHidden, ChartLegend } from '@/components/charts/ChartLegend'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { searchHealth } from '@/data/statistics'
import { useSeriesToggle } from '@/lib/use-series-toggle'
import { cn } from '@/lib/utils'

/**
 * Radar of the search against a healthy benchmark, plus the suggestions that
 * fall out of it.
 *
 * Per Infogram, radar is for "comparing multiple variables for a single data
 * point" to reveal "strengths and weaknesses at a glance" — so the chart is
 * the diagnosis and the list beneath is the prescription, ranked by the size
 * of each gap rather than by raw score.
 */
const RADAR_SERIES = [
  { key: 'you', label: 'You', color: 'var(--series-1)' },
  { key: 'target', label: 'Target', color: 'var(--text-3)' },
] as const

export function SearchHealth() {
  const { toggle, isHidden, allHidden } = useSeriesToggle(RADAR_SERIES.map((s) => s.key))
  const ranked = [...searchHealth].sort((a, b) => a.score - a.target - (b.score - b.target))
  const behind = ranked.filter((a) => a.score < a.target)

  return (
    <Panel className="min-w-0">
      <PanelTitle hint="you vs a healthy search">Search health</PanelTitle>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        <div>
          {allHidden ? (
            <AllHidden />
          ) : (
            <Radar
              axes={searchHealth.map((a) => a.axis)}
              series={RADAR_SERIES.filter((s) => !isHidden(s.key)).map((s) => ({
                label: s.label,
                color: s.color,
                values: searchHealth.map((a) => (s.key === 'you' ? a.score : a.target)),
              }))}
            />
          )}
          <ChartLegend
            className="mt-2 justify-center"
            items={RADAR_SERIES.map((s) => ({ key: s.key, label: s.label, color: s.color }))}
            isHidden={isHidden}
            onToggle={toggle}
          />
        </div>

        <div className="min-w-0">
          <h3 className="mb-2 text-xs tracking-wide text-text-3 uppercase">
            {behind.length > 0 ? 'Where to put your effort' : 'On track everywhere'}
          </h3>

          <ol className="divide-y divide-hairline">
            {ranked.map((a) => {
              const gap = a.score - a.target
              return (
                <li key={a.axis} className="flex items-start gap-3 py-2.5">
                  <span
                    className={cn(
                      'tabular mt-0.5 w-12 shrink-0 rounded-sm border px-1 text-center text-xs font-medium',
                      gap < -20
                        ? 'border-danger-border bg-danger-soft text-danger'
                        : gap < 0
                          ? 'border-warning-border bg-warning-soft text-warning'
                          : 'border-success-border bg-success-soft text-success',
                    )}
                  >
                    {gap > 0 ? `+${gap}` : gap}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm">{a.axis}</div>
                    <p className="mt-0.5 text-xs text-text-3">{a.suggestion}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </Panel>
  )
}
