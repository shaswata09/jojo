import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ChartColumn, Plus, SendHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Panel, PanelScroll, PanelTitle } from '@/components/common/Panel'
import { ApplicationFrequency } from '@/components/dashboard/ApplicationFrequency'
import { HeadlineRatesBody } from '@/components/dashboard/HeadlineRates'
import { ApplicationSources } from '@/components/dashboard/ApplicationSources'
import { SearchHealth } from '@/components/dashboard/SearchHealth'
import { NextSteps } from '@/components/statistics/NextSteps'
import { WhatIsWorking } from '@/components/statistics/WhatIsWorking'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { statsFor } from '@/data/statistics'
import { useDialogs } from '@/lib/dialogs-context'
import { applicationsPath, useTitle } from '@/lib/links'
import { useFocusParam } from '@/lib/link-params'
import { useArrivalHighlight, useFocusArrival } from '@/lib/use-arrival-highlight'
import { RoleScopeEmpty } from '@/lib/roles-scope-empty'
import { useScopedApplications } from '@/lib/roles-scope'
import { useSeriesToggle } from '@/lib/use-series-toggle'
import { cn } from '@/lib/utils'
import { useDomain } from '@/i18n/domain'

/**
 * Outcomes are slices of one whole, so a sequential ramp — the same treatment
 * "Where they came from" gets. They used to be teal / red / grey / green, which
 * spent the app's past-due red on "Rejected" and its success green on a band
 * one record wide. Neither is a status here; both were scoring a person.
 *
 * "No reply" takes the neutral rather than a fifth ramp step, the way the
 * sources donut paints "Not recorded": nothing happened to those records, and
 * the ramp only has four rungs to spend.
 */
const OUTCOME_RAMP = [
  'var(--ramp-1)',
  'var(--ramp-2)',
  'var(--ramp-3)',
  'var(--ramp-4)',
  'var(--text-3)',
]

export function Statistics() {
  const { t } = useTranslation('pages')
  const domain = useDomain()
  useTitle(t('statistics.title'))
  // A search result naming one card (`?focus=stats-funnel`) — see `Settings`.
  const { focus, clearFocus, arrival } = useFocusParam()
  useArrivalHighlight(focus, clearFocus, arrival)
  useFocusArrival(focus, { arrival })
  // The benchmark is useful, and noisy when you are reading your own numbers.
  const [showTypical, setShowTypical] = useState(true)
  // Every figure on this page counts the roles picked in the top bar, and all
  // of them when none are picked.
  const { all, total, filtered } = useScopedApplications()
  const { open } = useDialogs()

  const { sent, funnel, outcomes, roles } = useMemo(() => statsFor(all), [all])

  const outcomeToggle = useSeriesToggle(outcomes.map((o) => o.label))
  const visibleOutcomes = outcomes.filter((o) => !outcomeToggle.isHidden(o.label))
  const outcomeTotal = visibleOutcomes.reduce((n, o) => n + o.count, 0)
  const share = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)

  // Nothing on this page survives a zero: a rate has no denominator, a funnel
  // has no first step, and every panel would be an invented search sitting
  // beside a store the user has just emptied.
  //
  // A filter that hides every record is not that zero: the records are there,
  // so the page says what is hiding them and how to bring them back.
  if (total > 0 && all.length === 0) {
    return (
      <>
        <PageHeader title={t('statistics.title')} subtitle={t('statistics.scopedEmptySubtitle')} />
        <Panel>
          <RoleScopeEmpty />
        </Panel>
      </>
    )
  }

  if (all.length === 0) {
    return (
      <>
        <PageHeader title={t('statistics.title')} subtitle={t('statistics.emptySubtitle')} />
        <Panel>
          <EmptyState
            icon={ChartColumn}
            title={t('statistics.emptyTitle')}
            description={t('statistics.emptyDescription')}
            action={
              <Button size="sm" onClick={() => open('application')}>
                <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                {t('statistics.newApplication')}
              </Button>
            }
          />
        </Panel>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={t('statistics.title')}
        // Both halves are conditional on the same thing: with nothing sent,
        // there are no headline rates for the switch to change and no figure
        // on the page wearing the word "typical" for the subtitle to explain.
        subtitle={
          // Says when the role filter is narrowing it, since the filter
          // itself sits up in the top bar, away from these figures.
          `${
            filtered
              ? t('statistics.countedScoped', { shown: all.length, count: total })
              : t('statistics.counted')
          } ${sent > 0 ? t('statistics.typicalNote') : t('statistics.fillsIn')}`
        }
        settings={
          sent > 0 ? (
            <PageOption
              label={t('statistics.compareTypical')}
              hint={t('statistics.compareTypicalHint')}
              control={
                <Switch
                  checked={showTypical}
                  onCheckedChange={setShowTypical}
                  aria-label={t('statistics.compareTypical')}
                />
              }
            />
          ) : undefined
        }
      />

      {/* Above the figures, because somebody opening this page on a Sunday
          evening is asking what to do and the funnel answers how it is going.
          Renders nothing on an empty search — a plan for a search nobody has
          started is the fabricated-search failure this page was rebuilt to
          remove. */}
      <NextSteps />

      {/* The tiles moved to `dashboard/HeadlineRates` when the dashboard's
          StatsCard needed the same four. They were written inline here and could
          only ever appear here; a second copy would have been a second
          definition of what "reply rate" means.

          `showTypical` stays this page's business: the sample comparison is a
          reading aid for a page about figures, and the dashboard card has no
          room for a second number under each one. */}
      {sent > 0 ? (
        <section data-tour="stats" data-focus-id="stats-headline">
          <h2 className="mb-3.5 text-base font-medium">{t('statistics.headlineRates')}</h2>
          <HeadlineRatesBody showTypical={showTypical} />
        </section>
      ) : null}

      {/* Under the headline rates, because it is the only panel that COMPARES
          and every rate it draws is one of those four cut a different way.
          Renders nothing until two groups have enough records to be worth
          putting side by side. */}
      <WhatIsWorking />

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[1.5fr_1fr]">
        <ApplicationFrequency />
        <ApplicationSources />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[1fr_1fr]">
        {/* Funnel: one hue, because length already encodes magnitude and the
            percentage carries the meaning. */}
        <Panel className="min-w-0" focusId="stats-funnel">
          {/* The hint is load-bearing, not decoration. Only the current stage
              is stored, so a record that was rejected after an interview counts
              as far as the dates it carries and no further — the panel says so
              rather than quietly reporting a number it cannot stand behind. */}
          <PanelTitle hint={sent > 0 ? t('statistics.asFarAsShown') : undefined}>
            {t('statistics.funnelTitle')}
          </PanelTitle>
          {sent === 0 ? (
            <EmptyState
              icon={SendHorizontal}
              title={t('statistics.nothingSentTitle')}
              description={t('statistics.nothingSentDescription')}
              action={
                <Button variant="outline" size="sm" asChild>
                  <Link to={applicationsPath()}>{t('statistics.openBoard')}</Link>
                </Button>
              }
            />
          ) : (
            <dl className="space-y-3.5">
              {funnel.map((step, i) => {
                const pct = (step.count / sent) * 100
                const prev = i === 0 ? null : funnel[i - 1]
                return (
                  /*
                   * Grid rather than a nested flex row, so <dt> and <dd> are
                   * DIRECT children of this group.
                   *
                   * A <div> wrapping each pair inside a <dl> is valid HTML, but
                   * only when the <dt>/<dd> are its own children. They used to
                   * sit one level deeper, inside a flex row, which put two
                   * elements between the list and its terms and broke the
                   * pairing — a screen reader read ten orphaned items rather
                   * than five term-and-value pairs.
                   *
                   * Two columns for the term and its figure; the bar and the
                   * carry-through line span both.
                   */
                  <div
                    key={step.stage}
                    className="grid grid-cols-[1fr_auto] items-baseline gap-x-3"
                  >
                    <dt className="text-sm text-text-2">{domain.funnel(step.stage)}</dt>
                    <dd className="font-mono text-sm text-text-1">
                      {step.count}
                      <span className="ms-1.5 text-xs text-text-3 [unicode-bidi:isolate]">
                        {Math.round(pct)}%
                      </span>
                    </dd>
                    <div className="col-span-2 mt-1.5 h-2 overflow-hidden rounded-sm bg-well">
                      <div
                        className="h-full rounded-sm"
                        style={{ width: `${pct}%`, background: 'var(--info)' }}
                      />
                    </div>
                    {prev ? (
                      <div className="col-span-2 mt-1 text-xs text-text-3">
                        {t('statistics.carriedThrough', { percent: share(step.count, prev.count) })}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </dl>
          )}
        </Panel>

        <Panel className="min-w-0" focusId="stats-outcomes">
          {/* Every sent record lands in exactly one band, so these sum to the
              funnel's first step beside it and the offer band is the same 1 of
              9 the headline tile reports. The drafts are named rather than
              dropped silently — they are on the board, and a heading reading a
              smaller number than the board's with no explanation is the kind of
              gap a reader has to go and check. */}
          <PanelTitle
            hint={
              outcomeTotal !== sent
                ? t('statistics.outcomesShown', { shown: outcomeTotal, count: sent })
                : sent === all.length
                  ? t('statistics.outcomesSent', { count: sent })
                  : t('statistics.outcomesSentOf', { sent, count: all.length })
            }
          >
            {t('statistics.outcomes')}
          </PanelTitle>

          {/* Nothing sent means five bands of zero under a bar with no fill —
              a panel that looks broken rather than empty. The funnel beside it
              already offers the way out of this state, so this says what it is
              and leaves the one button where it was. */}
          {sent === 0 ? (
            <EmptyState
              icon={SendHorizontal}
              title={t('statistics.noOutcomeTitle')}
              description={t('statistics.noOutcomeDescription')}
            />
          ) : (
            <>
              {/* Part-to-whole, so a single stacked bar with a 2px surface gap
              between segments. The track is painted even when every band is
              switched off — an unfilled `flex` row is an invisible 10px strip,
              which reads as the panel having broken rather than as a filter. */}
              <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-well">
                {visibleOutcomes.map((o) => (
                  <div
                    key={o.label}
                    className="h-full first:rounded-s-full last:rounded-e-full"
                    style={{
                      width: `${share(o.count, outcomeTotal)}%`,
                      background: OUTCOME_RAMP[outcomes.indexOf(o) % OUTCOME_RAMP.length],
                    }}
                  />
                ))}
              </div>

              {/* Every band can be switched off, and then the bar above says
              nothing at all — so the state is named and the reset is one press
              rather than four. */}
              {outcomeToggle.allHidden ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-3">
                  {t('statistics.allOff')}
                  <button
                    type="button"
                    onClick={outcomeToggle.showAll}
                    className="cursor-pointer rounded-sm border border-hairline bg-well px-2 py-0.5 text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1"
                  >
                    {t('statistics.showAll')}
                  </button>
                </div>
              ) : null}

              {/* Legend toggles each band; the bar and the percentages both rebase
              on what remains visible. A swatch and a plain label, not a
              coloured pill — colour on a pill is reserved for the user's own
              keywords, and this one is a chart key. */}
              <ul className="mt-4 space-y-0.5">
                {outcomes.map((o, i) => {
                  const off = outcomeToggle.isHidden(o.label)
                  const color = OUTCOME_RAMP[i % OUTCOME_RAMP.length]
                  return (
                    <li key={o.label}>
                      <button
                        type="button"
                        onClick={() => outcomeToggle.toggle(o.label)}
                        aria-pressed={!off}
                        title={
                          off
                            ? t('statistics.showBand', { label: domain.band(o.label) })
                            : t('statistics.hideBand', { label: domain.band(o.label) })
                        }
                        className="flex w-full items-center gap-2.5 rounded-sm px-1 py-1 text-sm transition-colors hover:bg-row-hover"
                      >
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-[2px] border"
                          style={{ background: off ? 'transparent' : color, borderColor: color }}
                        />
                        <span
                          className={cn(
                            'min-w-0 truncate text-start',
                            off ? 'text-text-3 line-through decoration-1' : 'text-text-2',
                          )}
                        >
                          {domain.band(o.label)}
                        </span>
                        <span
                          className={cn(
                            'tabular ms-auto shrink-0 font-mono',
                            off ? 'text-text-3' : 'text-text-1',
                          )}
                        >
                          {o.count}
                          <span className="ms-1.5 text-xs text-text-3 [unicode-bidi:isolate]">
                            {off ? 0 : share(o.count, outcomeTotal)}%
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </Panel>
      </div>

      <SearchHealth />

      {/* Only roles something has actually been sent for. The table used to
          split "Academic vs industry", a pair the records stopped carrying when
          `roleTag` replaced it, and its rows were the sample funnel apportioned
          two ways — so it reported interviews for a track with none. Every cell
          is now the same per-record test the funnel uses, which is what makes
          the columns cross-foot against it rather than merely resemble it. */}
      {roles.length > 0 ? (
        <Panel className="min-w-0" focusId="stats-roles">
          <PanelTitle hint={t('statistics.asFarAsShown')}>{t('statistics.rolesTitle')}</PanelTitle>
          <PanelScroll axis="x" className="flex-none">
            <table className="w-full min-w-[440px] text-sm">
              <caption className="sr-only">{t('statistics.rolesCaption')}</caption>
              <thead>
                <tr className="text-start text-xs text-text-3">
                  <th scope="col" className="py-2 pe-3 font-medium">
                    {t('statistics.colRoles')}
                  </th>
                  <th scope="col" className="py-2 pe-3 text-end font-medium">
                    {t('statistics.colApplied')}
                  </th>
                  <th scope="col" className="py-2 pe-3 text-end font-medium">
                    {t('statistics.colReplied')}
                  </th>
                  <th scope="col" className="py-2 pe-3 text-end font-medium">
                    {t('statistics.colInterviews')}
                  </th>
                  <th scope="col" className="py-2 text-end font-medium">
                    {t('statistics.colOffers')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {roles.map((r) => (
                  <tr key={r.role}>
                    {/* Plain text, not a chip: a role is a category, and a
                        coloured pill on one would claim a status it has not got. */}
                    <th scope="row" className="py-2.5 pe-3 text-start font-normal text-text-2">
                      {r.role}
                    </th>
                    <td className="tabular py-2.5 pe-3 text-end font-mono">{r.applied}</td>
                    <td className="tabular py-2.5 pe-3 text-end font-mono">
                      {r.responded}
                      <span className="ms-1.5 text-xs text-text-3 [unicode-bidi:isolate]">
                        {share(r.responded, r.applied)}%
                      </span>
                    </td>
                    <td className="tabular py-2.5 pe-3 text-end font-mono">{r.interviews}</td>
                    <td className="tabular py-2.5 text-end font-mono">{r.offers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PanelScroll>
        </Panel>
      ) : null}
    </>
  )
}
