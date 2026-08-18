import { PageHeader } from '@/components/common/PageHeader'
import { GlancePanel } from '@/components/dashboard/GlancePanel'
import { OwedThisWeek } from '@/components/dashboard/OwedThisWeek'
import { PipelineBreakdown } from '@/components/dashboard/PipelineBreakdown'
import { PriorityActions } from '@/components/dashboard/PriorityActions'
import { RecentApplications } from '@/components/dashboard/RecentApplications'
import { MONTH_LABELS } from '@/data/calendar'
import { useApplications } from '@jojo/service/react/use-applications'
import { useTitle } from '@/lib/links'
import { TODAY_PARTS } from '@/lib/today'

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * "Monday 12 October" — today, spelled out.
 *
 * Built here rather than imported because nothing else in the app spells a date
 * out in full — every other surface uses `shortDate`. Naming the weekday is the
 * point of the header: this is the only screen whose subject is the day itself.
 *
 * Computed once at module load because `TODAY_PARTS` is: the clock is sampled
 * once so that nothing on screen can disagree with anything else about what day
 * it is. This comment used to say "the mock's pinned today" and give the worked
 * example as a literal — both were true of the fixture constant and neither has
 * been true since the wall clock replaced it.
 */
const TODAY_LABEL = `${
  WEEKDAY_NAMES[new Date(TODAY_PARTS.year, TODAY_PARTS.month - 1, TODAY_PARTS.day).getDay()]
} ${TODAY_PARTS.day} ${MONTH_LABELS[TODAY_PARTS.month - 1]}`

/**
 * The landing screen, and until now the only route with no `PageHeader` — no
 * title, no day, and nowhere that said the thing the whole product is built
 * around: that none of this leaves the machine. That promise was stated on the
 * guide, the settings page and the profile, which is three pages a new user has
 * no reason to open before deciding whether to trust the app with a job search.
 *
 * The two charts that used to sit in the second row are gone. Both render
 * identically on /statistics, and both were pushing the week's actual work —
 * what is overdue, what is due — below the fold on a 900px screen.
 */
export function Dashboard() {
  useTitle('Today')
  const { all } = useApplications()

  const subtitle =
    all.length === 0
      ? `${TODAY_LABEL} · nothing tracked yet — everything you add stays on this machine.`
      : `${TODAY_LABEL} · ${all.length} application${all.length === 1 ? '' : 's'}, all on this machine.`

  return (
    <>
      <PageHeader title="Today" subtitle={subtitle} />

      <div className="grid grid-cols-1 items-stretch gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <PriorityActions />
        <GlancePanel />
      </div>

      {/* The week gets the wider column and the two reference panels stack
          beside it: "Owed this week" is the only thing on this row you act on,
          and it is the one that grows as the search does.

          `items-stretch` rather than `items-start`, so the left panel is exactly
          as tall as Recent applications and Pipeline together. Left to itself
          the row ended level at some record counts and ragged at others, which
          reads as a layout that slipped rather than one that adapts. The list
          inside takes the height it is given and scrolls — see OwedThisWeek. */}
      <div className="grid grid-cols-1 items-stretch gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <OwedThisWeek />
        <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
          <RecentApplications />
          <PipelineBreakdown />
        </div>
      </div>
    </>
  )
}
