import { Link } from 'react-router'
import { ClipboardList, Plus } from 'lucide-react'
import { STAGE_LABEL } from '@/components/applications/StageMenu'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle, Row, RowList } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { displayName } from '@/data/seed'
import { useDialogs } from '@/lib/dialogs-context'
import { appPath, applicationsPath } from '@/lib/links'
import { useApplications } from '@/lib/store-context'

// Five, not six. The row this panel shares was running taller than it needed
// to, and the sixth entry is the least useful one on a panel that exists to
// show the *latest* activity and links to the full list anyway.
const HOW_MANY = 5

export function RecentApplications() {
  const { recent: touched } = useApplications()
  const { open } = useDialogs()
  const recent = touched.slice(0, HOW_MANY)

  return (
    <Panel>
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <PanelTitle className="mb-0" hint="latest activity">
          Recent applications
        </PanelTitle>
        <Link
          to={applicationsPath()}
          className="shrink-0 text-xs text-text-2 underline-offset-4 hover:text-accent hover:underline"
        >
          View all
        </Link>
      </div>

      {recent.length === 0 ? (
        // A titled panel wrapped around nothing was the exact shape this app's
        // empty-state pass exists to remove, and deleting the last application
        // now reaches it.
        <EmptyState
          icon={ClipboardList}
          title="No applications yet"
          description="Every position you track shows up here as you touch it, newest first."
          action={
            <Button size="sm" onClick={() => open('application')}>
              <Plus className="size-3.5" strokeWidth={2} aria-hidden />
              New application
            </Button>
          }
        />
      ) : (
        <RowList>
          {recent.map((a) => (
            <Row key={a.id} className="flex-wrap py-2">
              <div className="min-w-0 flex-1 basis-[220px]">
                {/* The panel's whole job is to point at the record that just
                  moved; before this it named it and left you to find it. */}
                <Link
                  to={appPath(a.id)}
                  className="block truncate transition-colors hover:text-accent hover:underline"
                >
                  {displayName(a)}
                </Link>
                <div className="mt-0.5 text-xs text-text-3">
                  {/* Relative, because the gap is the point on a panel whose
                      whole job is "latest". One vocabulary though — "yesterday"
                      was the app's only word for it, and nothing else here
                      speaks it. */}
                  {a.lastAction} ·{' '}
                  {a.daysAgo === 0 ? 'Today' : `${a.daysAgo} day${a.daysAgo === 1 ? '' : 's'} ago`}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {/* Neutral. The role is not a status, and a teal pill beside a
                    stage chip read as though it were one. */}
                <Chip tone="gray">{a.roleTag}</Chip>
                <Chip stage={a.stage}>{STAGE_LABEL[a.stage]}</Chip>
              </div>
            </Row>
          ))}
        </RowList>
      )}
    </Panel>
  )
}
