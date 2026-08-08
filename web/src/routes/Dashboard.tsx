import { ApplicationFrequency } from '@/components/dashboard/ApplicationFrequency'
import { ApplicationSources } from '@/components/dashboard/ApplicationSources'
import { FollowUpTimeline } from '@/components/dashboard/FollowUpTimeline'
import { PipelineBreakdown } from '@/components/dashboard/PipelineBreakdown'
import { PriorityActions } from '@/components/dashboard/PriorityActions'
import { QuickAdd } from '@/components/dashboard/QuickAdd'
import { RecentApplications } from '@/components/dashboard/RecentApplications'
import { GlancePanel } from '@/components/dashboard/GlancePanel'
import { ThisWeek } from '@/components/dashboard/ThisWeek'

export function Dashboard() {
  return (
    <>
      {/* Fluid again now the tiles aren't square — the fixed 236px track only
          existed to stop the square block dragging the carousel's height. */}
      <div className="grid grid-cols-1 items-stretch gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        {/* Stacked inside the left column rather than added as its own row, so
            the quick-add sits directly over the carousel it feeds and the
            glance panel keeps the full height of the row. */}
        <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
          <QuickAdd />
          <PriorityActions />
        </div>
        <GlancePanel />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[1.5fr_1fr]">
        <ApplicationFrequency />
        <ApplicationSources />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[1.2fr_1fr]">
        <ThisWeek />
        <FollowUpTimeline />
      </div>

      {/* Neither of these needs a row to itself: the pipeline is one band of
          figures and the recent list is a narrow two-column layout, so both
          were spending most of a full-width row on empty space. */}
      <div className="grid grid-cols-1 items-stretch gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <PipelineBreakdown />
        <RecentApplications />
      </div>
    </>
  )
}
