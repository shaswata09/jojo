import { useState } from 'react'
import { Link } from 'react-router'
import { BellPlus, ClipboardList, Plus } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, Row, RowList } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { StickyBoard } from '@/components/dashboard/StickyBoard'
import { Button } from '@/components/ui/button'
import { STAGE_LABEL, displayName } from '@/data/seed'
import { useApplications } from '@jojo/service/react/use-applications'
import { useDialogs } from '@/lib/dialogs-context'
import { appPath, applicationsPath } from '@/lib/links'
import { readStored, writeStored } from '@/lib/storage'
import { TODAY } from '@/lib/today'

// Five, not six. The row this panel shares was running taller than it needed
// to, and the sixth entry is the least useful one on a panel that exists to
// show the *latest* activity and links to the full list anyway.
const HOW_MANY = 5

type View = 'notes' | 'recent'

const VIEWS = [
  { value: 'notes', label: 'Notes' },
  { value: 'recent', label: 'Recent applications' },
] as const

/** Which side of the card was showing, per browser. A convenience, so storage may refuse it. */
const VIEW_KEY = 'jojo.dashboard.notesCard'

const storedView = (): View => (readStored(VIEW_KEY) === 'recent' ? 'recent' : 'notes')

/**
 * The dashboard's right-hand card: the sticky-notes board, or the applications
 * touched most recently.
 *
 * Notes first, and by default. The recent list repeats what the board one
 * click away already shows; a place to jot "ask Maria about the visa letter"
 * is the thing the dashboard had nowhere for. The choice is remembered per
 * browser, so someone who prefers the list gets it back on their next visit.
 *
 * The heading is the switch: one `h2` naming whichever side is showing, for a
 * screen reader jumping by heading, with the segmented control beside it.
 */
export function RecentApplications() {
  const { open } = useDialogs()
  const [view, setView] = useState<View>(storedView)

  const choose = (next: View) => {
    setView(next)
    writeStored(VIEW_KEY, next)
  }

  return (
    <Panel>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="sr-only">{view === 'notes' ? 'Sticky notes' : 'Recent applications'}</h2>
        <Segment options={VIEWS} value={view} onChange={choose} label="Show on this card" />
        {view === 'notes' ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => open('timelineItem', { mode: 'reminder', initial: { date: TODAY } })}
          >
            <BellPlus className="size-3.5" strokeWidth={1.8} aria-hidden />
            Add reminder
          </Button>
        ) : (
          <Link
            to={applicationsPath()}
            className="shrink-0 text-xs text-text-2 underline-offset-4 hover:text-accent hover:underline"
          >
            View all
          </Link>
        )}
      </div>

      {view === 'notes' ? <StickyBoard /> : <RecentList />}
    </Panel>
  )
}

function RecentList() {
  const { recent: touched } = useApplications()
  const { open } = useDialogs()
  const recent = touched.slice(0, HOW_MANY)

  return (
    <>
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
                  to={appPath(a)}
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
    </>
  )
}
