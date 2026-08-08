import { useState } from 'react'
import { AlarmClock, CalendarClock, Check, FileText, Plus, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { LabelChips, LabelPicker } from '@/components/common/LabelFilter'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { Button } from '@/components/ui/button'
import {
  REMINDER_GROUPS,
  reminders as seedReminders,
  type Reminder,
  type ReminderKind,
  type ReminderStatus,
} from '@/data/reminders'
import { useLabels } from '@/lib/labels-context'
import { cn } from '@/lib/utils'

const kindIcon: Record<ReminderKind, LucideIcon> = {
  'follow-up': Users,
  deadline: CalendarClock,
  prep: FileText,
  admin: AlarmClock,
}

const statusText: Record<ReminderStatus, string> = {
  overdue: 'text-danger',
  today: 'text-warning',
  upcoming: 'text-text-3',
  done: 'text-text-3',
}

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'all', label: 'All' },
  { value: 'done', label: 'Completed' },
] as const

type Filter = (typeof FILTERS)[number]['value']

function ReminderRow({
  reminder,
  done,
  onToggle,
}: {
  reminder: Reminder
  done: boolean
  onToggle: () => void
}) {
  const Icon = kindIcon[reminder.kind]

  return (
    <li className="flex items-start gap-3 py-3">
      {/* A real checkbox role, so screen readers get the state and Space works. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        onClick={onToggle}
        aria-label={done ? `Mark "${reminder.title}" as not done` : `Mark "${reminder.title}" done`}
        className={cn(
          'mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-sm border transition-colors',
          done
            ? 'border-accent-border bg-accent-soft text-accent'
            : 'border-hairline-strong hover:border-accent-border',
        )}
      >
        {done ? <Check className="size-3" strokeWidth={2.5} /> : null}
      </button>

      <div className="min-w-0 flex-1">
        <div className={cn('text-sm', done && 'text-text-3 line-through')}>{reminder.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-3">
          <Icon className="size-3.5 shrink-0" strokeWidth={1.7} aria-hidden />
          <span className="truncate">{reminder.related}</span>
          {reminder.note ? <span className="text-text-3">· {reminder.note}</span> : null}
        </div>
        <LabelChips recordId={reminder.id} className="mt-1.5" />
      </div>

      <div className="shrink-0 text-right">
        <div
          className={cn(
            'text-xs font-medium whitespace-nowrap',
            done ? 'text-text-3' : statusText[reminder.status],
          )}
        >
          {reminder.when}
        </div>
        <div className="mt-0.5 font-mono text-xs text-text-3">{reminder.due}</div>
      </div>

      <LabelPicker recordId={reminder.id} className="mt-0.5" />

      {reminder.kind === 'follow-up' && !done ? (
        <Button variant="ghost" size="sm" className="shrink-0">
          Draft
        </Button>
      ) : null}
    </li>
  )
}

export function RemindersTool() {
  const [filter, setFilter] = useState<Filter>('open')
  const { matches: labelMatches, selected: selectedLabels, clearSelected } = useLabels()
  // Local overrides on top of the seed, so ticking something is visible.
  const [doneIds, setDoneIds] = useState<Set<string>>(
    () => new Set(seedReminders.filter((r) => r.status === 'done').map((r) => r.id)),
  )

  const toggle = (id: string) =>
    setDoneIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const visible = seedReminders.filter((r) => {
    if (!labelMatches(r.id)) return false
    const done = doneIds.has(r.id)
    if (filter === 'open') return !done
    if (filter === 'done') return done
    return true
  })

  /**
   * Rows that belong to a group, given what the Open/All/Completed control has
   * already allowed through. A ticked reminder counts as Completed whatever its
   * seed status says, so the grouping always matches what is on screen.
   */
  const rowsIn = (status: string) =>
    visible.filter((r) => {
      const done = doneIds.has(r.id)
      return done ? status === 'done' : r.status === status && !done
    })

  const shownGroups = REMINDER_GROUPS
  const shownRows = shownGroups.reduce((n, g) => n + rowsIn(g.status).length, 0)

  const openCount = seedReminders.filter((r) => !doneIds.has(r.id)).length
  const overdueCount = seedReminders.filter(
    (r) => !doneIds.has(r.id) && r.status === 'overdue',
  ).length

  return (
    <>
      {/* The page header belongs to the Vault, which hosts several tools, so
          this one carries its own toolbar instead. */}
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <p className="text-xs text-text-3">
            <span className={overdueCount > 0 ? 'text-danger' : undefined}>
              {overdueCount} overdue
            </span>{' '}
            · {openCount} open
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <Segment
              label="Filter reminders"
              options={FILTERS}
              value={filter}
              onChange={setFilter}
            />
            <Button size="sm">
              <Plus className="size-3.5" strokeWidth={2} aria-hidden />
              Add reminder
            </Button>
          </div>
        </div>
      </div>

      {shownGroups.map((group) => {
        const rows = rowsIn(group.status)
        if (rows.length === 0) return null

        return (
          <Panel key={group.status} className="min-w-0">
            <PanelTitle
              hint={`${rows.length}`}
              className={group.status === 'overdue' ? 'text-danger' : undefined}
            >
              {group.label}
            </PanelTitle>
            <ul className="divide-y divide-hairline">
              {rows.map((r) => (
                <ReminderRow
                  key={r.id}
                  reminder={r}
                  done={doneIds.has(r.id)}
                  onToggle={() => toggle(r.id)}
                />
              ))}
            </ul>
          </Panel>
        )
      })}

      {/* Keyed off what is actually rendered, not just the status filter — with
          a group selected the list can be empty while other groups still hold
          rows, and the old check left the page blank with no explanation. */}
      {shownRows === 0 ? (
        <Panel className="grid min-h-[180px] place-items-center text-center">
          <div>
            <p className="text-sm text-text-2">Nothing here.</p>
            <p className="mt-1 text-xs text-text-3">
              {selectedLabels.size > 0
                ? 'No reminders carry the selected keywords.'
                : filter === 'done'
                  ? 'No completed reminders yet.'
                  : 'You are all caught up.'}
            </p>
            {selectedLabels.size > 0 ? (
              <Button variant="outline" size="sm" className="mt-3" onClick={clearSelected}>
                Clear keywords
              </Button>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </>
  )
}
