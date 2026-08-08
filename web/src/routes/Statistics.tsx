import { TrendingDown, TrendingUp } from 'lucide-react'
import { Panel, PanelScroll, PanelTitle } from '@/components/common/Panel'
import { useState } from 'react'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Chip } from '@/components/common/Chip'
import { Switch } from '@/components/ui/switch'
import { ApplicationFrequency } from '@/components/dashboard/ApplicationFrequency'
import { ApplicationSources } from '@/components/dashboard/ApplicationSources'
import { SearchHealth } from '@/components/dashboard/SearchHealth'
import { funnel, kpis, outcomes, trackComparison } from '@/data/statistics'
import { useSeriesToggle } from '@/lib/use-series-toggle'
import { cn } from '@/lib/utils'

export function Statistics() {
  // Page option: the deltas are useful but noisy when reading absolute numbers.
  const [showDeltas, setShowDeltas] = useState(true)
  // `funnel[0].count` threw outright on an empty funnel, taking the whole app
  // down. Every ratio below is guarded too — an unguarded divide rendered
  // "NaN%" the moment a total was zero.
  const applied = funnel[0]?.count ?? 0
  const outcomeToggle = useSeriesToggle(outcomes.map((o) => o.label))
  const visibleOutcomes = outcomes.filter((o) => !outcomeToggle.isHidden(o.label))
  const outcomeTotal = visibleOutcomes.reduce((n, o) => n + o.count, 0)
  const share = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)

  return (
    <>
      <PageHeader
        title="Statistics"
        subtitle="How the search is actually going"
        settings={
          <PageOption
            label="Show KPI deltas"
            hint="Change against the previous period"
            control={
              <Switch
                checked={showDeltas}
                onCheckedChange={setShowDeltas}
                aria-label="Show KPI deltas"
              />
            }
          />
        }
      />

      {/* KPI row — headline numbers, so stat tiles rather than a chart. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-3.5 lg:grid-cols-4">
        {kpis.map((k) => {
          // A rising median reply time is bad news, so the arrow direction and
          // its colour are decided separately.
          const good = k.inverse ? k.trend === 'down' : k.trend === 'up'
          const Arrow = k.trend === 'up' ? TrendingUp : TrendingDown
          return (
            <div key={k.label} className="surface rounded-lg px-4 py-3.5 sm:px-5 sm:py-4">
              <div className="text-xs text-text-2">{k.label}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold sm:text-2xl">{k.value}</span>
                {showDeltas && k.delta ? (
                  <span
                    className={cn(
                      'flex items-center gap-0.5 text-xs',
                      good ? 'text-success' : 'text-warning',
                    )}
                  >
                    <Arrow className="size-3" strokeWidth={2} aria-hidden />
                    {k.delta}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-xs text-text-3">{k.note}</div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[1.5fr_1fr]">
        <ApplicationFrequency />
        <ApplicationSources />
      </div>

      <SearchHealth />

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[1fr_1fr]">
        {/* Funnel: one hue, because length already encodes magnitude and the
            conversion percentage carries the meaning. */}
        <Panel className="min-w-0">
          <PanelTitle hint="share of all applications">Conversion funnel</PanelTitle>
          <dl className="space-y-3.5">
            {funnel.map((step, i) => {
              const pct = applied > 0 ? (step.count / applied) * 100 : 0
              const prev = i === 0 ? null : funnel[i - 1]
              return (
                <div key={step.stage}>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-sm text-text-2">{step.stage}</dt>
                    <dd className="font-mono text-sm text-text-1">
                      {step.count}
                      <span className="ml-1.5 text-xs text-text-3">{Math.round(pct)}%</span>
                    </dd>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-sm bg-well">
                    <div
                      className="h-full rounded-sm"
                      style={{ width: `${pct}%`, background: 'var(--info)' }}
                    />
                  </div>
                  {prev ? (
                    <div className="mt-1 text-xs text-text-3">
                      {share(step.count, prev.count)}% carried through from{' '}
                      {prev.stage.toLowerCase()}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </dl>
        </Panel>

        <Panel className="min-w-0">
          <PanelTitle hint={`${outcomeTotal} applications`}>Outcomes</PanelTitle>

          {/* Part-to-whole, so a single stacked bar with a 2px surface gap
              between segments. */}
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {visibleOutcomes.map((o) => (
              <div
                key={o.label}
                className={cn(
                  'h-full first:rounded-l-full last:rounded-r-full',
                  o.tone === 'teal'
                    ? 'bg-info'
                    : o.tone === 'red'
                      ? 'bg-danger'
                      : o.tone === 'green'
                        ? 'bg-success'
                        : 'bg-text-3',
                )}
                style={{ width: `${share(o.count, outcomeTotal)}%` }}
              />
            ))}
          </div>

          {/* Legend toggles each band; the bar and the percentages both
              rebase on what remains visible. */}
          <ul className="mt-4 space-y-0.5">
            {outcomes.map((o) => {
              const off = outcomeToggle.isHidden(o.label)
              return (
                <li key={o.label}>
                  <button
                    type="button"
                    onClick={() => outcomeToggle.toggle(o.label)}
                    aria-pressed={!off}
                    title={off ? `Show ${o.label}` : `Hide ${o.label}`}
                    className="flex w-full items-center gap-2.5 rounded-sm px-1 py-1 text-sm transition-colors hover:bg-row-hover"
                  >
                    <Chip
                      tone={o.tone === 'teal' ? 'teal' : o.tone}
                      className={cn(off && 'opacity-45')}
                    >
                      {o.label}
                    </Chip>
                    <span
                      className={cn(
                        'ml-auto font-mono',
                        off ? 'text-text-3 line-through decoration-1' : 'text-text-1',
                      )}
                    >
                      {o.count}
                      <span className="ml-1.5 text-xs text-text-3">
                        {off ? 0 : share(o.count, outcomeTotal)}%
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Panel>
      </div>

      <Panel className="min-w-0">
        <PanelTitle hint="academia vs industry">Track comparison</PanelTitle>
        <PanelScroll axis="x" className="flex-none">
          <table className="w-full min-w-[440px] text-sm">
            <caption className="sr-only">
              Applications, responses, interviews and offers by track
            </caption>
            <thead>
              <tr className="text-left text-xs text-text-3">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Track
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Applied
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Responded
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Interviews
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Offers
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {trackComparison.map((r) => (
                <tr key={r.track}>
                  <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                    <Chip tone={r.track === 'Academia' ? 'teal' : 'gray'}>{r.track}</Chip>
                  </th>
                  <td className="py-2.5 pr-3 text-right font-mono">{r.applied}</td>
                  <td className="py-2.5 pr-3 text-right font-mono">
                    {r.responded}
                    <span className="ml-1.5 text-xs text-text-3">
                      {share(r.responded, r.applied)}%
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-right font-mono">{r.interviews}</td>
                  <td className="py-2.5 text-right font-mono">{r.offers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PanelScroll>
      </Panel>
    </>
  )
}
