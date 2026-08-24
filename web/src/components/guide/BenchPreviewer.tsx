import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import {
  CONVERSATIONS,
  GROUPS,
  GROUP_BLURB,
  TURN_COUNT,
  type Group,
} from '@jojo/service/agent/bench-conversations'
import { DOCUMENTS, WORLD_SHAPE } from '@jojo/service/agent/bench-world'
import { cn } from '@/lib/utils'

/**
 * The benchmark, openable — what was asked, of what data, and what counted.
 *
 * A published score is worth nothing without this. "Twelve of fourteen" is a
 * number somebody chose the denominator for, and the only way to judge it is to
 * read the cases. So every conversation is here, verbatim, with the sentences
 * the model was actually sent and the reason each case exists.
 *
 * ## Read from the suite, not copied from it
 *
 * `CONVERSATIONS` is the same array `test/bench.test.ts` runs. There is no
 * second description of the benchmark to fall out of step with the first — add
 * a conversation and it appears here, with its prompts, on the next build.
 *
 * ## Why it is collapsed by default
 *
 * Twenty-eight conversations of prose would bury the results above them. The
 * category summary is the part most readers want; the transcripts are for the
 * one reader who wants to argue with a case, and that reader will open it.
 */

const CONVERSATIONS_BY_GROUP = GROUPS.map((group) => ({
  group,
  items: CONVERSATIONS.filter((c) => c.group === group),
})).filter((g) => g.items.length > 0)

/*
 * `TURN_COUNT` rather than a second reduce over the same array. It was written
 * out again here, which is a small copy of a small fact — and small copies of
 * small facts are how a page ends up quoting a number the suite stopped
 * agreeing with.
 */
const CHECKS = CONVERSATIONS.reduce((n, c) => n + c.finalState.length, 0)

export function BenchPreviewer() {
  const [open, setOpen] = useState<Group | null>(null)

  return (
    <div>
      {/* The world first. A reader cannot judge a case without knowing what was
          in the store when it ran — "find my Rice application" is a different
          question against six records than against sixty. */}
      <h3 className="text-sm font-medium">The store it was run against</h3>
      <p className="mt-1 text-sm text-text-2">
        Built by running jojo&rsquo;s own tools, so every id is real and every edge is one the app
        could have made. Two ambiguities are deliberate: two Rice applications, and two UT campuses.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {Object.entries(WORLD_SHAPE).map(([type, count]) => (
          <span
            key={type}
            className="rounded-full border border-hairline bg-well px-2.5 py-1 text-xs text-text-2"
          >
            <span className="tabular text-text-1">{count}</span> {type}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-text-3">
        Plus the text inside {String(Object.keys(DOCUMENTS).length)} documents, which is the only
        place the document questions can be answered from.
      </p>

      <h3 className="mt-5 text-sm font-medium">
        What it was asked
        <span className="ml-2 font-normal text-text-3">
          {CONVERSATIONS.length} conversations · {TURN_COUNT} turns · {CHECKS} checks on the store
        </span>
      </h3>

      <ul className="mt-2 space-y-1.5">
        {CONVERSATIONS_BY_GROUP.map(({ group, items }) => {
          const isOpen = open === group
          return (
            <li key={group} className="rounded-lg border border-hairline bg-well">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => {
                  setOpen(isOpen ? null : group)
                }}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
              >
                <ChevronRight
                  className={cn(
                    'mt-0.5 size-3.5 shrink-0 text-text-3 transition-transform',
                    isOpen && 'rotate-90',
                  )}
                  strokeWidth={2}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="text-sm text-text-1">{group}</span>
                  <span className="tabular ml-2 text-xs text-text-3">
                    {items.length} conversation{items.length === 1 ? '' : 's'}
                  </span>
                  <span className="mt-0.5 block text-xs text-text-3">{GROUP_BLURB[group]}</span>
                </span>
              </button>

              {isOpen ? (
                <div className="border-t border-hairline px-3 py-2.5">
                  {items.map((conversation) => (
                    <div key={conversation.id} className="mb-4 last:mb-0">
                      <p className="font-mono text-xs text-text-3">{conversation.id}</p>
                      <p className="mt-0.5 text-xs text-text-2">{conversation.why}</p>

                      {/* The sentences, verbatim. This is the part that lets
                          somebody disagree with a case rather than only with a
                          number. */}
                      <ol className="mt-2 space-y-1.5">
                        {conversation.turns.map((turn, i) => (
                          <li key={turn.say} className="flex gap-2 text-sm">
                            <span className="tabular mt-0.5 text-xs text-text-3">{i + 1}</span>
                            <span>
                              <span className="text-text-1">&ldquo;{turn.say}&rdquo;</span>
                              {turn.shouldAsk ? (
                                <span className="ml-1.5 text-xs text-warn">
                                  must ask, not act
                                </span>
                              ) : null}
                              {turn.readOnly && !turn.shouldAsk ? (
                                <span className="ml-1.5 text-xs text-text-3">
                                  must not write
                                </span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ol>

                      <p className="mt-1.5 text-xs text-text-3">
                        Then {conversation.finalState.length} check
                        {conversation.finalState.length === 1 ? '' : 's'} on the store:{' '}
                        {conversation.finalState.map((c) => c.why).join(' ')}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
