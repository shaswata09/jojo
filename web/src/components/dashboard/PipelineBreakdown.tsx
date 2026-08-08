import { Panel, PanelTitle } from '@/components/common/Panel'
import { applications, stageCounts } from '@/data/seed'
import { cn } from '@/lib/utils'

/**
 * Where everything currently sits. The single most informative thing a job
 * dashboard can show: totals say how much you've done, this says whether it's
 * progressing or piling up in one stage.
 *
 * Laid out as a vertical funnel rather than the band of six columns it used to
 * be. The band needed a full row to itself; sharing a row halves the width,
 * and six columns in half a row give each stage ~80px — enough for the figure
 * but not for a bar long enough to compare against its neighbours. Stacked, the
 * bars all start at the same x and run the full width of the panel, which is
 * the comparison this chart exists to make, and reading top-to-bottom matches
 * the order applications actually move through.
 */
export function PipelineBreakdown() {
  const max = Math.max(...stageCounts.map((s) => s.count), 1)

  return (
    <Panel className="flex flex-col">
      <PanelTitle hint={`${applications.length} tracked`}>Pipeline</PanelTitle>

      {/* justify-between spreads the six rows down whatever height the row's
          taller panel sets, so the card fills rather than trailing off. */}
      <ol className="flex flex-1 flex-col justify-between gap-y-2">
        {stageCounts.map((s) => (
          <li key={s.id}>
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-text-2">{s.label}</span>
              <span className="tabular text-sm font-semibold">{s.count}</span>
            </div>
            {/* Proportional fill; the track spans the panel so every stage is
                measured against the same baseline. */}
            <div className="mt-1 h-2 overflow-hidden rounded-sm bg-well">
              <div
                className={cn('h-full rounded-sm', s.dot)}
                style={{ width: `${(s.count / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
