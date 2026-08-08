import { useState } from 'react'
import { Donut } from '@/components/charts/Donut'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { applicationSources } from '@/data/seed'
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
  const { toggle, isHidden } = useSeriesToggle(applicationSources.map((s) => s.source))
  // Both views share one hidden-set, so switching bars↔donut keeps your choices.
  const visible = applicationSources.filter((s) => !isHidden(s.source))
  const total = visible.reduce((sum, s) => sum + s.count, 0)

  return (
    <Panel className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PanelTitle className="mb-0" hint={`${total} total`}>
          Where they came from
        </PanelTitle>
        <Segment label="Chart type" options={VIEWS} value={view} onChange={setView} />
      </div>

      {view === 'donut' ? (
        <Donut
          slices={applicationSources.map((s, i) => ({
            label: s.source,
            value: s.count,
            color: RAMP[i % RAMP.length],
            key: s.source,
          }))}

          centerLabel="applications"
          isHidden={isHidden}
          onToggle={toggle}
        />
      ) : (
        <ul className="space-y-3">
          {applicationSources.map((s) => {
            const off = isHidden(s.source)
            return (
              <li key={s.source}>
                <button
                  type="button"
                  onClick={() => toggle(s.source)}
                  aria-pressed={!off}
                  title={off ? `Show ${s.source}` : `Hide ${s.source}`}
                  className="w-full rounded-sm text-left"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className={cn(
                        'text-sm',
                        off ? 'text-text-3 line-through decoration-1' : 'text-text-2',
                      )}
                    >
                      {s.source}
                    </span>
                    <span className={cn('font-mono text-sm', off ? 'text-text-3' : 'text-text-1')}>
                      {s.count}
                      <span className="ml-1.5 text-xs text-text-3">
                        {!off && total > 0 ? Math.round((s.count / total) * 100) : 0}%
                      </span>
                    </span>
                  </div>
                  {/* Scaled by share of the VISIBLE total, so the bars and the
                      percentages beside them always agree. */}
                  <div className="mt-1.5 h-2 overflow-hidden rounded-sm bg-well">
                    <div
                      className="h-full rounded-sm transition-[width] duration-200"
                      style={{
                        width: `${!off && total > 0 ? (s.count / total) * 100 : 0}%`,
                        background: 'var(--info)',
                      }}
                    />
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
