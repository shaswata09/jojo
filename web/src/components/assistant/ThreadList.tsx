import { useMemo, useState } from 'react'
import { Briefcase, Loader2, MessageSquarePlus, Search } from 'lucide-react'
import type { Thread } from '@jojo/service/react/use-threads'
import type { NodeId } from '@jojo/service/core/model'
import { agoLabel } from '@jojo/service/core/dates'
import { useBusyThreads } from '@jojo/service/react/agent-runs-context'
import { displayName } from '@jojo/service/data/seed'
import type { Application } from '@jojo/service/data/seed'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TODAY } from '@/lib/today'

/**
 * Every conversation, to move between.
 *
 * This replaced a row of chips, and the reason is what a chip could not carry.
 * A person keeps one conversation per job — that is the whole point of filing
 * them — so by the third one the question stops being "which of these is
 * open" and becomes "which of these was about Rice". A chip shows a truncated
 * title and nothing else; a row shows the job, when it was last touched, and
 * how much is in it, which is what the reader is actually sorting on.
 *
 * GROUPED BY JOB, not sorted by date, once anything is filed. Sorting by date
 * is right for one continuous conversation and wrong for several parallel ones:
 * the two threads about Rice belong beside each other even when a thread about
 * Stripe was touched between them. Inside a group it is newest first, which is
 * `useThreads`' own order.
 *
 * The filter appears at six. Below that the list is shorter than the control
 * would be.
 */
const FILTER_FROM = 6

export function ThreadList({
  threads,
  activeId,
  byId,
  onOpen,
  onNew,
}: {
  threads: readonly Thread[]
  activeId: NodeId | null
  byId: ReadonlyMap<string, Application>
  onOpen: (id: NodeId) => void
  onNew: () => void
}) {
  const [filter, setFilter] = useState('')

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const nameOf = (t: Thread) => {
      const app = t.applicationId ? byId.get(t.applicationId) : undefined
      return app ? displayName(app) : ''
    }
    const matching = needle
      ? threads.filter(
          (t) =>
            t.title.toLowerCase().includes(needle) || nameOf(t).toLowerCase().includes(needle),
        )
      : threads

    const by = new Map<string, { label: string; threads: Thread[] }>()
    for (const t of matching) {
      const label = nameOf(t)
      // Unfiled last, under a heading that says what they have in common rather
      // than what they lack — "Not about a job yet" is a state, "Other" is a
      // shrug.
      const key = label || '￿'
      const group = by.get(key) ?? { label: label || 'Not about a job yet', threads: [] }
      group.threads.push(t)
      by.set(key, group)
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => g)
  }, [byId, filter, threads])

  const busyThreads = useBusyThreads()

  return (
    <Panel className="min-w-0">
      <PanelTitle hint={threads.length > 0 ? `${threads.length} kept here` : undefined}>
        Conversations
      </PanelTitle>

      {/* Not disabled while something is running. Starting a second
          conversation while the first works is the thing this panel exists for;
          each run is keyed by its own conversation now, so they do not collide. */}
      <Button variant="outline" size="sm" className="w-full" onClick={onNew}>
        <MessageSquarePlus className="size-3.5" strokeWidth={1.8} aria-hidden />
        New conversation
      </Button>

      {threads.length >= FILTER_FROM ? (
        <div className="relative mt-2">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-3"
            aria-hidden
          />
          <Input
            value={filter}
            aria-label="Filter conversations"
            placeholder="Filter by name or job"
            className="h-8 pl-8"
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      ) : null}

      {threads.length === 0 ? (
        <p className="mt-3 text-xs text-text-3">
          Nothing yet. Ask something and it is kept here, on this device.
        </p>
      ) : groups.length === 0 ? (
        <p className="mt-3 text-xs text-text-3">No conversation matches “{filter}”.</p>
      ) : (
        // Capped in height rather than growing without limit: the conversation
        // beside it is the thing being read, and a list of thirty must not push
        // it off the screen.
        <ul className="mt-3 max-h-[26rem] space-y-3 overflow-y-auto">
          {groups.map((group) => (
            <li key={group.label}>
              <h3 className="mb-1 flex items-center gap-1.5 px-0.5 text-xs font-medium text-text-3">
                <Briefcase className="size-3" strokeWidth={1.8} aria-hidden />
                <span className="truncate">{group.label}</span>
              </h3>
              <ul className="space-y-1">
                {group.threads.map((t) => {
                  const asked = t.entries.filter((e) => e.kind === 'you').length
                  const on = t.id === activeId
                  const working = busyThreads.includes(t.id)
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        aria-current={on ? 'true' : undefined}
                        onClick={() => {
                          onOpen(t.id)
                        }}
                        className={`pressable w-full cursor-pointer rounded-md border px-2.5 py-1.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                          on
                            ? 'border-accent bg-accent-soft'
                            : 'border-transparent hover:border-hairline hover:bg-well'
                        }`}
                      >
                        {/* Two lines, then an ellipsis. A title is the first
                            thing the person typed, and one line of it is
                            frequently the word "Which". */}
                        <span className="line-clamp-2 text-sm text-text-1">{t.title}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-text-3">
                          {/* Said here because it can no longer be inferred:
                              while every other row was disabled, "something is
                              running" was obvious from the whole panel being
                              dead. Now that conversations run side by side, the
                              only place that fact can live is on the row it is
                              true of. */}
                          {working ? (
                            <>
                              <Loader2
                                className="size-3 shrink-0 animate-spin text-accent"
                                strokeWidth={2}
                                aria-hidden
                              />
                              <span className="text-accent">Working…</span>
                            </>
                          ) : (
                            <span>
                              {asked} {asked === 1 ? 'question' : 'questions'} ·{' '}
                              {agoLabel(t.updatedAt.slice(0, 10), TODAY)}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
