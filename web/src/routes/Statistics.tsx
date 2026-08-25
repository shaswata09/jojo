import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ChartColumn, Plus, SendHorizontal } from 'lucide-react'
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
import { useApplications } from '@jojo/service/react/use-applications'
import { useDialogs } from '@/lib/dialogs-context'
import { applicationsPath, useTitle } from '@/lib/links'
import { useSeriesToggle } from '@/lib/use-series-toggle'
import { cn } from '@/lib/utils'

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
  useTitle('Statistics')
  // The benchmark is useful, and noisy when you are reading your own numbers.
  const [showTypical, setShowTypical] = useState(true)
  const { all } = useApplications()
  const { open } = useDialogs()

  const { sent, funnel, outcomes, roles } = useMemo(() => statsFor(all), [all])

  const outcomeToggle = useSeriesToggle(outcomes.map((o) => o.label))
  const visibleOutcomes = outcomes.filter((o) => !outcomeToggle.isHidden(o.label))
  const outcomeTotal = visibleOutcomes.reduce((n, o) => n + o.count, 0)
  const share = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)

  // Nothing on this page survives a zero: a rate has no denominator, a funnel
  // has no first step, and every panel would be an invented search sitting
  // beside a store the user has just emptied.
  if (all.length === 0) {
    return (
      <>
        <PageHeader
          title="Statistics"
          subtitle="Nothing to measure yet — this page fills in as you add applications."
        />
        <Panel>
          <EmptyState
            icon={ChartColumn}
            title="No applications to measure"
            description="Response rates, a funnel and a week-by-week chart all need records to count. Add the first one and this page starts filling in."
            action={
              <Button size="sm" onClick={() => open('application')}>
                <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                New application
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
        title="Statistics"
        // Both halves are conditional on the same thing: with nothing sent,
        // there are no headline rates for the switch to change and no figure
        // on the page wearing the word "typical" for the subtitle to explain.
        subtitle={
          sent > 0
            ? 'Counted from your own records. Figures labelled typical are a sample search, there to compare against.'
            : 'Counted from your own records. It fills in as applications go out.'
        }
        settings={
          sent > 0 ? (
            <PageOption
              label="Compare with a typical search"
              hint="A sample figure beside each headline number"
              control={
                <Switch
                  checked={showTypical}
                  onCheckedChange={setShowTypical}
                  aria-label="Compare with a typical search"
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
        <section>
          <h2 className="mb-3.5 text-base font-medium">Headline rates</h2>
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
        <Panel className="min-w-0">
          {/* The hint is load-bearing, not decoration. Only the current stage
              is stored, so a record that was rejected after an interview counts
              as far as the dates it carries and no further — the panel says so
              rather than quietly reporting a number it cannot stand behind. */}
          <PanelTitle hint={sent > 0 ? 'as far as each record shows' : undefined}>
            How far applications got
          </PanelTitle>
          {sent === 0 ? (
            <EmptyState
              icon={SendHorizontal}
              title="Nothing has been sent yet"
              description="Reply, interview and offer rates all count applications that have actually gone out. Move one out of Draft and this fills in."
              action={
                <Button variant="outline" size="sm" asChild>
                  <Link to={applicationsPath()}>Open the board</Link>
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
                    <dt className="text-sm text-text-2">{step.stage}</dt>
                    <dd className="font-mono text-sm text-text-1">
                      {step.count}
                      <span className="ml-1.5 text-xs text-text-3">{Math.round(pct)}%</span>
                    </dd>
                    <div className="col-span-2 mt-1.5 h-2 overflow-hidden rounded-sm bg-well">
                      <div
                        className="h-full rounded-sm"
                        style={{ width: `${pct}%`, background: 'var(--info)' }}
                      />
                    </div>
                    {prev ? (
                      <div className="col-span-2 mt-1 text-xs text-text-3">
                        {share(step.count, prev.count)}% carried through
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </dl>
          )}
        </Panel>

        <Panel className="min-w-0">
          {/* Every sent record lands in exactly one band, so these sum to the
              funnel's first step beside it and the offer band is the same 1 of
              9 the headline tile reports. The drafts are named rather than
              dropped silently — they are on the board, and a heading reading a
              smaller number than the board's with no explanation is the kind of
              gap a reader has to go and check. */}
          <PanelTitle
            hint={
              outcomeTotal !== sent
                ? `${outcomeTotal} of ${sent} shown`
                : sent === all.length
                  ? `${sent} sent`
                  : `${sent} of ${all.length} sent`
            }
          >
            Outcomes
          </PanelTitle>

          {/* Nothing sent means five bands of zero under a bar with no fill —
              a panel that looks broken rather than empty. The funnel beside it
              already offers the way out of this state, so this says what it is
              and leaves the one button where it was. */}
          {sent === 0 ? (
            <EmptyState
              icon={SendHorizontal}
              title="Nothing has an outcome yet"
              description="An outcome is what came back, so only applications that have gone out can have one. Every record here is still a draft."
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
                    className="h-full first:rounded-l-full last:rounded-r-full"
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
                  Every outcome is switched off.
                  <button
                    type="button"
                    onClick={outcomeToggle.showAll}
                    className="cursor-pointer rounded-sm border border-hairline bg-well px-2 py-0.5 text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1"
                  >
                    Show all
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
                        title={off ? `Show ${o.label}` : `Hide ${o.label}`}
                        className="flex w-full items-center gap-2.5 rounded-sm px-1 py-1 text-sm transition-colors hover:bg-row-hover"
                      >
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-[2px] border"
                          style={{ background: off ? 'transparent' : color, borderColor: color }}
                        />
                        <span
                          className={cn(
                            'min-w-0 truncate text-left',
                            off ? 'text-text-3 line-through decoration-1' : 'text-text-2',
                          )}
                        >
                          {o.label}
                        </span>
                        <span
                          className={cn(
                            'tabular ml-auto shrink-0 font-mono',
                            off ? 'text-text-3' : 'text-text-1',
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
        <Panel className="min-w-0">
          <PanelTitle hint="as far as each record shows">How each kind of role is going</PanelTitle>
          <PanelScroll axis="x" className="flex-none">
            <table className="w-full min-w-[440px] text-sm">
              <caption className="sr-only">
                Applications, replies, interviews and offers by kind of role
              </caption>
              <thead>
                <tr className="text-left text-xs text-text-3">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Roles
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Applied
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Replied
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
                {roles.map((r) => (
                  <tr key={r.role}>
                    {/* Plain text, not a chip: a role is a category, and a
                        coloured pill on one would claim a status it has not got. */}
                    <th scope="row" className="py-2.5 pr-3 text-left font-normal text-text-2">
                      {r.role}
                    </th>
                    <td className="tabular py-2.5 pr-3 text-right font-mono">{r.applied}</td>
                    <td className="tabular py-2.5 pr-3 text-right font-mono">
                      {r.responded}
                      <span className="ml-1.5 text-xs text-text-3">
                        {share(r.responded, r.applied)}%
                      </span>
                    </td>
                    <td className="tabular py-2.5 pr-3 text-right font-mono">{r.interviews}</td>
                    <td className="tabular py-2.5 text-right font-mono">{r.offers}</td>
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
