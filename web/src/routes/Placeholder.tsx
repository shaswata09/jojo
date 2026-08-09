import { Link } from 'react-router'
import { Compass } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel } from '@/components/common/Panel'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { dashboardPath } from '@/lib/links'

/**
 * The catch-all route.
 *
 * It used to be the stand-in for several unbuilt views as well; those are all
 * real pages now, and the one that never became one — Chat — was removed along
 * with the topbar icon that led to it. So this is only ever reached by a URL
 * that matches nothing, which is exactly when a way out matters most: the
 * sidebar is a drawer below `lg`, so on a phone there was nothing on screen to
 * press.
 */
export function Placeholder({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Panel>
        <EmptyState
          icon={Compass}
          title="Nothing lives at this address"
          description="Check the link, or start again from the dashboard. Nothing was lost — the address simply does not match a page."
          action={
            <Button size="sm" asChild>
              <Link to={dashboardPath()}>Back to the dashboard</Link>
            </Button>
          }
        />
      </Panel>
    </>
  )
}
