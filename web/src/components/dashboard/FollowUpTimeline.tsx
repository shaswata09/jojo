import { Panel, PanelTitle } from '@/components/common/Panel'
import { Timeline, TimelineItem } from '@/components/common/Timeline'
import { Button } from '@/components/ui/button'
import { followUps } from '@/data/seed'

/** Urgency maps straight onto the rail's node colour. */
const tone = { red: 'red', amber: 'amber', gray: 'gray' } as const

export function FollowUpTimeline() {
  return (
    <Panel>
      <PanelTitle hint="auto-flagged">Follow-ups due</PanelTitle>

      <Timeline>
        {followUps.map((f) => (
          <TimelineItem
            key={f.id}
            tone={tone[f.urgency]}
            time={f.when}
            title={
              <>
                <span className="font-medium">{f.org}</span>
                <span className="text-text-3"> · {f.role}</span>
              </>
            }
            subtitle={f.reason}
            action={
              <Button variant="ghost" size="sm">
                Draft email
              </Button>
            }
          />
        ))}
      </Timeline>
    </Panel>
  )
}
