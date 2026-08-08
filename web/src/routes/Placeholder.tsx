import { Panel } from '@/components/common/Panel'
import { PageHeader } from '@/components/common/PageHeader'

/**
 * Temporary stand-in for views whose markup was cut off in the shared
 * mockup. Replaced view-by-view as the full spec lands.
 */
export function Placeholder({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Panel className="grid min-h-[220px] place-items-center text-center text-sm text-text-3">
        <div>
          <p className="text-text-2">Not built yet.</p>
          <p className="mt-1">This view is next up once the full mockup is in the repo.</p>
        </div>
      </Panel>
    </>
  )
}
