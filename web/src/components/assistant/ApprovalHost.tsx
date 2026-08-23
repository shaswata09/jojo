import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAgentRuns, useWaitingRuns } from '@jojo/service/react/agent-runs-context'
import { useThreads } from '@jojo/service/react/use-threads'
import { proposalDetail } from '@jojo/service/core/proposal'

/**
 * Answers a destructive step from wherever the person happens to be.
 *
 * Mounted at the root, outside the router, beside `DialogHost` — and for a
 * sharper version of the reason that one is. An approval used to resolve from a
 * button inside the conversation's own transcript, which meant the question
 * existed only while that page was open. Walk away mid-run and `runAgent` parked
 * on `await approve(...)` with nothing able to resolve it: the run hung forever,
 * un-abortable, and the exchange was never saved. It was not a rare path either
 * — it is every delete the agent ever proposes.
 *
 * So the question follows the person. The registry keeps it on the run; this
 * draws whatever is waiting, on whatever page they are on.
 *
 * DELIBERATELY NOT A MODAL. A modal would seize a person who is in the middle of
 * something else, which is exactly the situation this exists to support — they
 * left the Assistant on purpose. It sits where a toast sits, says which
 * conversation is asking, and offers a way back to it.
 */
export function ApprovalHost() {
  const waiting = useWaitingRuns()
  const runs = useAgentRuns()
  const { threads } = useThreads()

  if (waiting.length === 0) return null

  return (
    /*
     * Bottom-RIGHT, not bottom-centre. The Assistant's composer is pinned to the
     * bottom of its card now, and a centred card landed straight on top of it —
     * which matters even though the composer is disabled mid-run, because the
     * openers sit there too and the overlap read as a rendering fault.
     */
    <div className="pointer-events-none fixed right-0 bottom-0 z-50 flex flex-col items-end gap-2 p-4">
      {waiting.map((run) => {
        const step = run.pending?.step
        if (!step) return null
        const named = threads.find((t) => t.id === run.threadId)
        const detail = proposalDetail(JSON.stringify(step.args ?? {}))

        return (
          <div
            key={run.threadId}
            role="alertdialog"
            aria-label={`${step.title} — waiting for you`}
            className="pointer-events-auto w-full max-w-md rounded-lg border border-warning-border bg-panel p-3.5 shadow-lg"
          >
            <div className="flex items-start gap-2.5">
              <TriangleAlert
                aria-hidden
                strokeWidth={1.8}
                className="mt-0.5 size-4 shrink-0 text-warning"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-1">{step.title}</p>
                {/* What it would actually WRITE, not just which operation.
                    The pipelines' approval cards shipped without this and it
                    was the first thing that had to be fixed there: a person
                    being asked to approve a note without being shown the note
                    is not being asked anything. `proposalDetail` is that fix,
                    reused — it strips the ids, which mean nothing here. */}
                {detail ? (
                  <p className="mt-1 rounded border border-hairline bg-well px-2 py-1 text-xs leading-relaxed text-text-1">
                    {detail}
                  </p>
                ) : null}
                <p className="mt-1 truncate font-mono text-xs text-text-3">{step.name}</p>
                {/* Named, not linked. This is mounted OUTSIDE the router — that
                    is what lets it draw on every page — so it has no router
                    context and a `<Link>` here crashed the whole view with
                    "Cannot destructure property 'basename'". A plain anchor
                    would work and would full-reload, which is the one thing
                    that genuinely does kill a run. There is nowhere to go
                    anyway: the question is answerable right here. */}
                <p className="mt-1 text-xs text-text-2">
                  Asked by {named?.title ?? 'a conversation'}. Nothing has changed yet.
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  runs.decide(run.threadId, false)
                }}
              >
                Don’t
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  runs.decide(run.threadId, true)
                }}
              >
                Allow
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
