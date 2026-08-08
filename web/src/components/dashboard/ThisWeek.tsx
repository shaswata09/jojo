import { CalendarClock, FileText, Plane, Users, Video } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Chip } from '@/components/common/Chip'
import { laterEvents, thisWeek, weekDays, type EventKind, type Urgency } from '@/data/seed'
import { cn } from '@/lib/utils'

const kindIcon: Record<EventKind, LucideIcon> = {
  deadline: CalendarClock,
  interview: Video,
  visit: Plane,
  call: Users,
  prep: FileText,
}

const urgencyText: Record<Urgency, string> = {
  red: 'text-danger',
  amber: 'text-warning',
  gray: 'text-text-3',
}

const urgencyBar: Record<Urgency, string> = {
  red: 'bg-danger',
  amber: 'bg-warning',
  gray: 'bg-text-3',
}

function whenLabel(inDays: number) {
  if (inDays === 0) return 'Today'
  if (inDays === 1) return 'Tomorrow'
  return weekDays[inDays]?.label ?? `in ${inDays} days`
}

/**
 * Replaces the old "Upcoming deadlines" panel. Deadlines alone don't plan a
 * week — prep work and calls compete for the same evenings. Anything beyond
 * seven days drops to the "Later" strip so nothing is lost.
 */
export function ThisWeek() {
  return (
    <Panel>
      <PanelTitle hint={`${thisWeek.length} items`}>This week</PanelTitle>

      {/* Day strip: shape of the week at a glance, before reading any detail. */}
      <ol className="mb-4 grid grid-cols-7 gap-1" aria-label="Next seven days">
        {weekDays.map((day, i) => {
          const events = thisWeek.filter((e) => e.inDays === i)
          const isToday = i === 0
          return (
            <li
              key={day.label}
              className={cn(
                'rounded-md border px-1 py-1.5 text-center',
                isToday ? 'border-accent-border bg-accent-soft' : 'border-hairline bg-well',
              )}
            >
              <div className={cn('text-xs uppercase', isToday ? 'text-accent' : 'text-text-3')}>
                {day.label}
              </div>
              <div
                className={cn('text-base font-semibold', isToday ? 'text-accent' : 'text-text-2')}
              >
                {day.date}
              </div>
              {/* Fixed-height rail so day cells stay aligned whether or not
                  they have events. */}
              <div className="mt-1 flex h-1 items-center justify-center gap-0.5">
                {events.map((e) => (
                  <span
                    key={e.id}
                    className={cn('size-1 rounded-full', urgencyBar[e.urgency])}
                    aria-hidden
                  />
                ))}
              </div>
              <span className="sr-only">
                {events.length === 0 ? 'nothing scheduled' : `${events.length} items`}
              </span>
            </li>
          )
        })}
      </ol>

      <ul className="divide-y divide-hairline">
        {thisWeek.map((e) => {
          const Icon = kindIcon[e.kind]
          return (
            <li key={e.id} className="flex items-start gap-3 py-2.5">
              <Icon
                className={cn('mt-0.5 size-4 shrink-0', urgencyText[e.urgency])}
                strokeWidth={1.7}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm">{e.title}</div>
                <div className="mt-0.5 text-xs text-text-3">{e.detail}</div>
              </div>
              <span
                className={cn(
                  'shrink-0 text-xs font-medium whitespace-nowrap',
                  urgencyText[e.urgency],
                )}
              >
                {whenLabel(e.inDays)}
              </span>
            </li>
          )
        })}
      </ul>

      {laterEvents.length > 0 ? (
        <div className="mt-4 border-t border-hairline pt-3.5">
          <div className="mb-2 text-xs tracking-wide text-text-3 uppercase">Later</div>
          <ul className="flex flex-wrap gap-2">
            {laterEvents.map((e) => (
              <li key={e.id}>
                <Chip tone="gray" className="gap-1.5">
                  {e.title}
                  <span className="text-text-3">· {e.detail.split(' · ')[0]}</span>
                </Chip>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  )
}
