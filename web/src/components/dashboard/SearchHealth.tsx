import { useMemo } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Compass } from 'lucide-react'
import { AllHidden, ChartLegend } from '@/components/charts/ChartLegend'
import { Radar } from '@/components/charts/Radar'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { searchHealthFor } from '@/data/statistics'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { applicationsPath } from '@/lib/links'
import { TODAY } from '@/lib/today'
import { useSeriesToggle } from '@/lib/use-series-toggle'
import { useScopedApplications } from '@/lib/roles-scope'
import { useAdvice } from '@/i18n/advice'

/**
 * A radar of this search against a typical one, plus the suggestions that fall
 * out of it.
 *
 * Per Infogram, radar is for "comparing multiple variables for a single data
 * point" to reveal "strengths and weaknesses at a glance" — so the chart is the
 * diagnosis and the list beside it is the prescription, ordered by the size of
 * each gap.
 *
 * Only the `Typical` ring is invented, and it says so on the chip. `Yours` is
 * counted from the store: it used to be six hard-coded scores whose suggestions
 * named a campus visit, a teaching statement and three overdue follow-ups that
 * a freshly-cleared store did not contain.
 */
const RADAR_SERIES = [
  { key: 'you', color: 'var(--series-1)' },
  { key: 'target', color: 'var(--text-3)' },
] as const

/**
 * Below three plotted axes a radar is a line or a triangle with nothing to
 * compare, so the panel says what is missing instead of drawing a shape.
 */
const MIN_AXES = 3

export function SearchHealthBody() {
  const { t } = useTranslation('dashboard')
  const advice = useAdvice()
  const seriesLabel = (key: (typeof RADAR_SERIES)[number]['key']) => t(`searchHealth.series.${key}`)
  const { toggle, showAll, isHidden, allHidden } = useSeriesToggle(RADAR_SERIES.map((s) => s.key))
  const { all } = useScopedApplications()
  const { all: timeline } = useTimeline()

  // An axis with no denominator has no score — no applications sent means no
  // reply rate, and 0% would be a claim rather than an absence.
  const measured = useMemo(
    () =>
      searchHealthFor({ applications: all, timeline, today: TODAY }).filter(
        (a) => a.score !== null,
      ),
    [all, timeline],
  )

  const ranked = [...measured].sort(
    (a, b) => (a.score ?? 0) - a.target - ((b.score ?? 0) - b.target),
  )

  return (
    <>
      {/* The "Sample" chip rides with the body rather than the title, because
          the body is rendered in two places now and only one of them owns a
          title. It is the one part of that hint that is load-bearing: without
          it the typical ring reads as measured data about other people, which
          it is not. */}
      {measured.length >= MIN_AXES ? (
        <p className="mb-3 text-xs text-text-3">
          {t('searchHealth.intro')}{' '}
          <Chip size="sm" className="font-normal" title={t('searchHealth.sampleTitle')}>
            {t('searchHealth.sample')}
          </Chip>
        </p>
      ) : null}

      {measured.length < MIN_AXES ? (
        <EmptyState
          icon={Compass}
          title={t('searchHealth.emptyTitle')}
          description={t('searchHealth.emptyDescription')}
          action={
            <Button variant="outline" size="sm" asChild>
              <Link to={applicationsPath()}>{t('common.openBoard')}</Link>
            </Button>
          }
        />
      ) : (
        // A CONTAINER query, not `lg:`. The viewport breakpoint was right while
        // this only ever rendered full-width on Statistics, and wrong the moment
        // `StatsCard` put it in the dashboard's ~460px column: the viewport was
        // still `lg`, so the two-column rule applied and 320px of radar left the
        // list beside it about 140px — one word per line, and the panel three
        // times its intended height. `@container` asks the card how wide it is,
        // which is the question that was always being asked.
        <div className="@container/health grid grid-cols-1 gap-5 @[36rem]/health:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div>
            {allHidden ? (
              <AllHidden onShowAll={showAll} />
            ) : (
              <Radar
                axes={measured.map((a) => advice.axis(a.id))}
                series={RADAR_SERIES.filter((s) => !isHidden(s.key)).map((s) => ({
                  label: seriesLabel(s.key),
                  color: s.color,
                  values: measured.map((a) => (s.key === 'you' ? (a.score ?? 0) : a.target)),
                }))}
              />
            )}
            <ChartLegend
              className="mt-2 justify-center"
              items={RADAR_SERIES.map((s) => ({
                key: s.key,
                label: seriesLabel(s.key),
                color: s.color,
              }))}
              isHidden={isHidden}
              onToggle={toggle}
            />
          </div>

          <div className="min-w-0">
            <h3 className="mb-2 text-xs tracking-wide text-text-3 uppercase">
              {t('searchHealth.suggestions')}
            </h3>

            <ol className="divide-y divide-hairline">
              {ranked.map((a, i) => {
                // The axis's own figures, said in the language on screen.
                const said = advice.health(a)
                return (
                  <li key={a.id} className="flex items-start gap-3 py-2.5">
                    {/* The rank, plainly. `aria-hidden` because an <ol> already
                      announces the position and reading both is a stutter. */}
                    <span
                      aria-hidden
                      className="tabular mt-0.5 grid size-5 shrink-0 place-items-center rounded-sm border border-hairline bg-well text-xs text-text-3"
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      {/* The basis rides beside the axis name so the score on the
                        chart is never a number with no stated meaning. */}
                      <div className="text-sm">
                        {said.axis}
                        <span className="ms-2 text-xs text-text-3 [unicode-bidi:isolate]">
                          {said.basis}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-text-3">{said.suggestion}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * The card, for anywhere that wants only this one.
 *
 * Split from its contents so `StatsCard` can show them under a shared title
 * without nesting one Panel inside another.
 */
export function SearchHealth() {
  const { t } = useTranslation('dashboard')
  return (
    <Panel className="min-w-0" focusId="stats-search-health">
      <PanelTitle>{t('searchHealth.title')}</PanelTitle>
      <SearchHealthBody />
    </Panel>
  )
}
