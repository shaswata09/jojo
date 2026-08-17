import { useMemo } from 'react'
import { Link } from 'react-router'
import { Compass } from 'lucide-react'
import { AllHidden, ChartLegend } from '@/components/charts/ChartLegend'
import { Radar } from '@/components/charts/Radar'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { searchHealthFor } from '@/data/statistics'
import { useApplications } from '@jojo/service/react/use-applications'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { applicationsPath } from '@/lib/links'
import { TODAY } from '@/lib/today'
import { useSeriesToggle } from '@/lib/use-series-toggle'

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
  { key: 'you', label: 'Yours', color: 'var(--series-1)' },
  { key: 'target', label: 'Typical', color: 'var(--text-3)' },
] as const

/**
 * Below three plotted axes a radar is a line or a triangle with nothing to
 * compare, so the panel says what is missing instead of drawing a shape.
 */
const MIN_AXES = 3

export function SearchHealth() {
  const { toggle, showAll, isHidden, allHidden } = useSeriesToggle(RADAR_SERIES.map((s) => s.key))
  const { all } = useApplications()
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
    <Panel className="min-w-0">
      <PanelTitle
        hint={
          measured.length >= MIN_AXES ? (
            <>
              your figures against a typical search{' '}
              <Chip size="sm" className="font-normal" title="Only the typical ring is illustrative">
                Sample
              </Chip>
            </>
          ) : undefined
        }
      >
        What to work on next
      </PanelTitle>

      {measured.length < MIN_AXES ? (
        <EmptyState
          icon={Compass}
          title="Not enough to compare yet"
          description="This weighs your replies, interviews, referrals and follow-ups against a typical search. It needs applications that have actually gone out."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link to={applicationsPath()}>Open the board</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div>
            {allHidden ? (
              <AllHidden onShowAll={showAll} />
            ) : (
              <Radar
                axes={measured.map((a) => a.axis)}
                series={RADAR_SERIES.filter((s) => !isHidden(s.key)).map((s) => ({
                  label: s.label,
                  color: s.color,
                  values: measured.map((a) => (s.key === 'you' ? (a.score ?? 0) : a.target)),
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
              Suggestions, most useful first
            </h3>

            <ol className="divide-y divide-hairline">
              {ranked.map((a, i) => (
                <li key={a.axis} className="flex items-start gap-3 py-2.5">
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
                      {a.axis}
                      <span className="ml-2 text-xs text-text-3">{a.basis}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-text-3">{a.suggestion}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Panel>
  )
}
