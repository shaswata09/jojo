import { Link } from 'react-router'
import { Chip } from '@/components/common/Chip'
import { Panel, PanelTitle, Row, RowList } from '@/components/common/Panel'
import { recentApplications, type Stage } from '@/data/seed'

const stageTone: Record<Stage, 'teal' | 'amber' | 'green' | 'gray'> = {
  draft: 'gray',
  submitted: 'teal',
  screen: 'teal',
  interview: 'amber',
  offer: 'green',
  closed: 'gray',
}

const stageLabel: Record<Stage, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  screen: 'Screen',
  interview: 'Interview',
  offer: 'Offer',
  closed: 'Closed',
}

// Five, not six. The row this panel shares was running taller than it needed
// to, and the sixth entry is the least useful one on a panel that exists to
// show the *latest* activity and links to the full list anyway.
const HOW_MANY = 5

export function RecentApplications() {
  const recent = recentApplications.slice(0, HOW_MANY)

  return (
    <Panel>
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <PanelTitle className="mb-0" hint="latest activity">
          Recent applications
        </PanelTitle>
        <Link
          to="/applications"
          className="shrink-0 text-xs text-text-2 underline-offset-4 hover:text-accent hover:underline"
        >
          View all
        </Link>
      </div>

      <RowList>
        {recent.map((a) => (
          <Row key={a.id} className="flex-wrap py-2">
            <div className="min-w-0 flex-1 basis-[220px]">
              <div className="truncate">{a.role}</div>
              <div className="mt-0.5 text-xs text-text-3">
                {a.lastAction} · {a.daysAgo === 1 ? 'yesterday' : `${a.daysAgo} days ago`}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Chip tone="teal">{a.roleTag}</Chip>
              <Chip tone={stageTone[a.stage]}>{stageLabel[a.stage]}</Chip>
            </div>
          </Row>
        ))}
      </RowList>
    </Panel>
  )
}
