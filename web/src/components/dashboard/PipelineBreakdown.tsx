import { ClipboardList, Plus } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { useApplications } from '@/kg/react/use-applications'
import { useDialogs } from '@/lib/dialogs-context'
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
  const { all, stageCounts } = useApplications()
  const { open } = useDialogs()
  const max = Math.max(...stageCounts.map((s) => s.count), 1)

  return (
    <Panel className="flex flex-col">
      <PanelTitle hint={`${all.length} tracked`}>Pipeline</PanelTitle>

      {/* `stageCounts` always returns all six stages, so on an empty store this
          rendered six labelled bars of zero — technically true and useless, and
          reachable now that Settings can clear the records. A funnel with
          nothing in it should say what would fill it. */}
      {all.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Nothing in the pipeline"
          description="Each application sits in one stage, and this compares how many are in each. Add one and the first bar appears."
          action={
            <Button size="sm" onClick={() => open('application')}>
              <Plus className="size-3.5" strokeWidth={2} aria-hidden />
              New application
            </Button>
          }
        />
      ) : (
        // justify-between spreads the six rows down whatever height the row's
        // taller panel sets, so the card fills rather than trailing off.
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
      )}
    </Panel>
  )
}
