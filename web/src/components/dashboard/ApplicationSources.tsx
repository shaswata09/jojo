import { useMemo, useState } from 'react'
import { ClipboardList, Plus } from 'lucide-react'
import { Donut } from '@/components/charts/Donut'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { Button } from '@/components/ui/button'
import { useDialogs } from '@/lib/dialogs-context'
import { useApplications } from '@/lib/store-context'
import { useSeriesToggle } from '@/lib/use-series-toggle'
import { cn } from '@/lib/utils'

const VIEWS = [
  { value: 'bars', label: 'Bars' },
  { value: 'donut', label: 'Donut' },
] as const
type View = (typeof VIEWS)[number]['value']

// A sequential ramp, not the categorical series: this is a share-of-total
// split, and one hue light-to-dark is the correct form for that.
const RAMP = ['var(--ramp-1)', 'var(--ramp-2)', 'var(--ramp-3)', 'var(--ramp-4)']

/** Not a source, so not a colour from the source ramp — a neutral slice for
 *  the records that have not answered the question. */
const UNRECORDED = 'Not recorded'
const UNRECORDED_COLOR = 'var(--text-3)'

/**
 * Two readings of the same part-to-whole split.
 *
 * Bars compare magnitudes precisely; the donut shows share of the total with
 * the total itself in the hole, which is the one thing a donut does better
 * than a bar. The donut opens first — the question this panel answers is
 * "where do my applications come from", which is a share, not a magnitude.
 */
export function ApplicationSources() {
  const [view, setView] = useState<View>('donut')
  const { all, sourceCounts } = useApplications()
  const { open } = useDialogs()

  /**
   * `sourceCounts` only counts the four known sources, and the new-application
   * dialog opens with Source unset — so adding one record left the dashboard
   * saying 13 while this panel said 12, with nothing on screen to explain the
   * missing one. The slice appears only when it has something in it; an
   * always-zero legend row would be worse than the bug.
   *
   * Every source keeps its slot even at zero, so the ramp colours and the
   * legend order hold still as applications move between them.
   */
  const slices = useMemo(() => {
    const known = sourceCounts.map((s, i) => ({
      key: s.source as string,
      label: s.source as string,
      value: s.count,
      color: RAMP[i % RAMP.length],
    }))
    const unrecorded = all.filter((a) => a.source === undefined).length
    return unrecorded > 0
      ? [
          ...known,
          { key: UNRECORDED, label: UNRECORDED, value: unrecorded, color: UNRECORDED_COLOR },
        ]
      : known
  }, [all, sourceCounts])

  // Both views share one hidden-set, so switching bars↔donut keeps your choices.
  const { toggle, showAll, isHidden, allHidden } = useSeriesToggle(slices.map((s) => s.key))
  const total = slices.filter((s) => !isHidden(s.key)).reduce((sum, s) => sum + s.value, 0)

  return (
    <Panel className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PanelTitle
          className="mb-0"
          // Singular-safe: a first-run store holds exactly one record, and
          // "1 applications" is the first number a new user reads on this page.
          hint={
            total === all.length
              ? `${all.length} application${all.length === 1 ? '' : 's'}`
              : `${total} of ${all.length}`
          }
        >
          Where they came from
        </PanelTitle>
        {all.length > 0 ? (
          <Segment label="Chart type" options={VIEWS} value={view} onChange={setView} />
        ) : null}
      </div>

      {/* `sourceCounts` returns all four sources whether or not anything is in
          them, so an empty store drew a bare grey ring reading "0 applications"
          — a panel that looks broken rather than one that is waiting. Reachable
          now that Settings can clear the records. */}
      {all.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Nothing to break down yet"
          description="Each application records where you found it — a job board, a referral, the department page. This splits them once there are some."
          action={
            <Button size="sm" onClick={() => open('application')}>
              <Plus className="size-3.5" strokeWidth={2} aria-hidden />
              New application
            </Button>
          }
        />
      ) : view === 'donut' ? (
        <Donut slices={slices} centerLabel="applications" isHidden={isHidden} onToggle={toggle} />
      ) : (
        <ul className="space-y-3">
          {slices.map((s) => {
            const off = isHidden(s.key)
            return (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => toggle(s.key)}
                  aria-pressed={!off}
                  title={off ? `Show ${s.label}` : `Hide ${s.label}`}
                  className="w-full rounded-sm text-left"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className={cn(
                        'text-sm',
                        off ? 'text-text-3 line-through decoration-1' : 'text-text-2',
                      )}
                    >
                      {s.label}
                    </span>
                    <span
                      className={cn(
                        'tabular font-mono text-sm',
                        off ? 'text-text-3' : 'text-text-1',
                      )}
                    >
                      {s.value}
                      <span className="ml-1.5 text-xs text-text-3">
                        {!off && total > 0 ? Math.round((s.value / total) * 100) : 0}%
                      </span>
                    </span>
                  </div>
                  {/* Scaled by share of the VISIBLE total, so the bars and the
                      percentages beside them always agree. Each bar carries its
                      own slice colour, so the two views key the same. */}
                  <div className="mt-1.5 h-2 overflow-hidden rounded-sm bg-well">
                    <div
                      className="h-full rounded-sm transition-[width] duration-200"
                      style={{
                        width: `${!off && total > 0 ? (s.value / total) * 100 : 0}%`,
                        background: s.color,
                      }}
                    />
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* Not `AllHidden`, which replaces the chart it sits in front of: here the
          legend IS the value table and the only way back on, so swallowing it
          would remove the reset it is advertising. The Outcomes panel in
          Statistics takes the same shape for the same reason — say what
          happened, offer the one press, leave the toggles alone. */}
      {all.length > 0 && allHidden ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-3">
          Every source is switched off.
          <button
            type="button"
            onClick={showAll}
            className="cursor-pointer rounded-sm border border-hairline bg-well px-2 py-0.5 text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1"
          >
            Show all
          </button>
        </div>
      ) : null}
    </Panel>
  )
}
