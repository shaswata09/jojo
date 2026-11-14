import { Plus, Radar, TriangleAlert } from 'lucide-react'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

/** Job scout's title, its one page option, and the New pipeline button. */
export function ScoutHeader({
  onlyActive,
  onOnlyActive,
  onNew,
}: {
  onlyActive: boolean
  onOnlyActive: (on: boolean) => void
  onNew: () => void
}) {
  return (
    <PageHeader
      title="Job scout"
      subtitle="Saved searches that will watch job boards for you — and somewhere to park postings today"
      settings={
        <PageOption
          label="Only active pipelines"
          hint="Hide the ones switched off"
          control={
            <Switch
              checked={onlyActive}
              onCheckedChange={onOnlyActive}
              aria-label="Only active pipelines"
            />
          }
        />
      }
      actions={
        <Button size="sm" onClick={onNew}>
          <Plus className="size-3.5" strokeWidth={2} aria-hidden />
          New pipeline
        </Button>
      }
    />
  )
}

/* System status, stated plainly rather than implied by a colour — and
   read off the model settings rather than hardcoded, which is what it
   was while nothing could run either way. */
export function PausedNotice() {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-lg border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} aria-hidden />
      <p>
        No local model is connected, so pipelines are paused. You can still write them and save
        postings below — they start running once a model is reachable.
      </p>
    </div>
  )
}

/** Where the pipelines run, said at the foot of the page. */
export function RunsLocallyNote() {
  return (
    <p className="flex items-center gap-2 text-xs text-text-3">
      <Radar className="size-3.5" strokeWidth={1.7} aria-hidden />
      Pipelines run on your machine, while this tab is open. Nothing is sent to a third party.
    </p>
  )
}
