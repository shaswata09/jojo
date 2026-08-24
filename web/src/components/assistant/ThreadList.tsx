import { useMemo } from 'react'
import { Briefcase, Loader2, MessageSquarePlus, Search, X } from 'lucide-react'
import type { Thread } from '@jojo/service/react/use-threads'
import type { NodeId } from '@jojo/service/core/model'
import { agoLabel } from '@jojo/service/core/dates'
import { useBusyThreads } from '@jojo/service/react/agent-runs-context'
import { displayName } from '@jojo/service/data/seed'
import type { Application } from '@jojo/service/data/seed'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Mark } from '@/components/assistant/Mark'
import { searchThreads } from '@/components/assistant/thread-search'
import type { Snippet } from '@/components/assistant/thread-search'
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
 * SEARCH IS ALWAYS THERE once there is anything to search, and it used to be
 * gated — first at six conversations, briefly at three.
 *
 * The gate made sense for what this box used to do. It matched a title and a
 * job name, and with five conversations on screen reading five titles is faster
 * than reaching for a control, so the control was hidden until the list got
 * long enough to need one.
 *
 * Searching what was SAID is a different feature with a different threshold,
 * and the threshold is one. Two conversations are twenty turns of text that are
 * not on screen; the reader who wants "where did it tell me the salary was
 * nine-month" cannot answer it by looking at two titles, and a search box that
 * appears only once they have accumulated a third conversation is missing on
 * precisely the day they first go looking. A control that hides until you have
 * enough data to deserve it teaches people it does not exist.
 *
 * Below one there is genuinely nothing to find, and the panel's own empty state
 * already says so — so the box appears with the first conversation, not before.
 */

export function ThreadList({
  threads,
  activeId,
  byId,
  onOpen,
  onNew,
  query,
  onQuery,
}: {
  threads: readonly Thread[]
  activeId: NodeId | null
  byId: ReadonlyMap<string, Application>
  onOpen: (id: NodeId) => void
  onNew: () => void
  /** Lifted, so the open conversation can mark the same words this list did. */
  query: string
  onQuery: (next: string) => void
}) {
  const filter = query
  const setFilter = onQuery

  const { groups, evidence, hitCount } = useMemo(() => {
    const nameOf = (t: Thread) => {
      const app = t.applicationId ? byId.get(t.applicationId) : undefined
      return app ? displayName(app) : ''
    }

    /*
     * The evidence per thread, not just a yes/no.
     *
     * This used to be `title.includes(needle) || name.includes(needle)`, which
     * could only answer "which conversation is called this". The question a
     * person actually arrives with is "where did it tell me the salary was
     * nine-month", and the title — the first sentence they happened to type —
     * almost never has that word in it. `searchThreads` reads the turns, and
     * hands back a snippet so the row can show WHY it matched rather than
     * leaving the reader to open three conversations to find out.
     */
    const found = filter.trim() ? searchThreads(threads, filter, nameOf) : null
    const evidence = new Map<string, { count: number; snippet: Snippet | null }>()
    for (const hit of found ?? []) {
      evidence.set(hit.thread.id, { count: hit.matchCount, snippet: hit.snippet })
    }
    const matching = found ? found.map((h) => h.thread) : threads

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
    return {
      groups: [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => g),
      // Kept beside the groups rather than recomputed in the row, so the number
      // in the summary line and the marks inside the rows come from one pass.
      evidence,
      hitCount: (found ?? []).reduce((n, h) => n + h.matchCount, 0),
    }
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

      {threads.length > 0 ? (
        <div className="mt-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-3"
              aria-hidden
            />
            <Input
              value={filter}
              aria-label="Search conversations"
              placeholder="Search what was said"
              className="h-8 pl-8 pr-8"
              onChange={(e) => {
                setFilter(e.target.value)
              }}
              onKeyDown={(e) => {
                // Escape clears rather than blurring. Leaving the box focused
                // with the query gone is what a reader wants after finding the
                // thing: the highlight goes and the caret stays put.
                if (e.key === 'Escape' && filter) {
                  e.preventDefault()
                  setFilter('')
                }
              }}
            />
            {filter ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setFilter('')
                }}
                className="absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer rounded-sm p-1 text-text-3 transition-colors hover:text-text-1"
              >
                <X className="size-3.5" strokeWidth={1.8} aria-hidden />
              </button>
            ) : null}
          </div>
          {/* Counted out loud, and announced. A filtered list that has quietly
              gone from thirty rows to two looks the same as a list of two. */}
          {filter.trim() ? (
            <p aria-live="polite" className="mt-1.5 px-0.5 text-xs text-text-3">
              {hitCount === 0
                ? 'No mention of that'
                : `${String(hitCount)} ${hitCount === 1 ? 'mention' : 'mentions'} in ${String(groups.reduce((n, g) => n + g.threads.length, 0))} ${groups.reduce((n, g) => n + g.threads.length, 0) === 1 ? 'conversation' : 'conversations'}`}
            </p>
          ) : null}
        </div>
      ) : null}

      {threads.length === 0 ? (
        <p className="mt-3 text-xs text-text-3">
          Nothing yet. Ask something and it is kept here, on this device.
        </p>
      ) : groups.length === 0 ? (
        <p className="mt-3 text-xs wrap-anywhere text-text-3">
          Nothing mentions “{filter}”. This searches every conversation, not just their names.
        </p>
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
                  const hit = evidence.get(t.id)
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
                        <span className="line-clamp-2 text-sm wrap-anywhere text-text-1">
                          <Mark text={t.title} query={filter} />
                        </span>
                        {/* Only when the title does not already show it. A
                            snippet repeating the line above it is noise on
                            every row at once. */}
                        {hit?.snippet ? (
                          <span className="mt-1 line-clamp-2 text-xs wrap-anywhere text-text-3">
                            {hit.snippet.clippedStart ? '…' : ''}
                            <Mark text={hit.snippet.text} matches={hit.snippet.matches} />
                            {hit.snippet.clippedEnd ? '…' : ''}
                          </span>
                        ) : null}
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
                              {hit && hit.count > 0 ? (
                                <span className="text-accent">
                                  {hit.count} {hit.count === 1 ? 'match' : 'matches'} ·{' '}
                                </span>
                              ) : null}
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
