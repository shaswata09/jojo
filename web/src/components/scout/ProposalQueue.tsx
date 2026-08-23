import { Check, Inbox, ListChecks, Sparkles, TriangleAlert, X } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { proposalDetail } from '@jojo/service/core/proposal'
import type { Pipeline, Proposal } from '@jojo/service/core/model'

/**
 * The queue, as cards a person answers one at a time.
 *
 * Cards rather than rows, and the difference is the rationale. A row is for
 * scanning a list where every entry has the same shape; each of these is a
 * different proposed change with a different argument behind it, and the
 * argument is the thing being judged. Hiding it behind a disclosure would make
 * Approve the cheap option and reading the reason the expensive one, which is
 * the wrong way round for a control that writes to someone's records.
 *
 * Answered cards stay until swept, so the Undo in the toast has something to
 * point at. See `pipeline.proposal.sweep`.
 */
export function ProposalQueue({
  proposals,
  pipelines,
  onApprove,
  onDiscard,
  onApproveAll,
  onSweep,
}: {
  /** Every proposal, in creation order. This component splits them. */
  proposals: readonly Proposal[]
  pipelines: readonly Pipeline[]
  onApprove: (id: string) => void
  onDiscard: (id: string) => void
  onApproveAll: (pipelineId: string) => void
  onSweep: (pipelineId: string) => void
}) {
  const pending = proposals.filter((p) => p.status === 'pending')
  const answered = proposals.filter((p) => p.status !== 'pending')
  const nameOf = (id: string | null) => pipelines.find((p) => p.id === id)?.name ?? 'a pipeline'

  /*
   * Approve all and Clear are per-pipeline, not global, so they are only
   * offered when the queue is all from one — a single button that approved
   * suggestions from two different searches would be one gesture the user
   * cannot describe afterwards.
   */
  const onePipeline = (rows: readonly Proposal[]) => {
    const ids = new Set(rows.map((p) => p.pipelineId))
    const only = [...ids][0]
    return ids.size === 1 && typeof only === 'string' ? only : null
  }
  const pendingFrom = onePipeline(pending)
  const answeredFrom = onePipeline(answered)

  return (
    <Panel>
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
        <PanelTitle className="mb-0" hint="nothing happens until you say so">
          Suggestions
        </PanelTitle>
        <div className="flex items-center gap-2">
          {answered.length > 0 && answeredFrom ? (
            <Button size="sm" variant="ghost" onClick={() => onSweep(answeredFrom)}>
              Clear answered
            </Button>
          ) : null}
          {pending.length > 1 && pendingFrom ? (
            <Button size="sm" variant="outline" onClick={() => onApproveAll(pendingFrom)}>
              <ListChecks className="size-3.5" strokeWidth={1.8} aria-hidden />
              Approve all {pending.length}
            </Button>
          ) : null}
        </div>
      </div>

      {proposals.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing to review"
          description="When a pipeline is running, anything it wants to change shows up here first. It will not touch your records until you approve it."
        />
      ) : (
        <ul className="grid gap-2.5">
          {[...pending, ...answered].map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              pipelineName={nameOf(p.pipelineId)}
              onApprove={() => onApprove(p.id)}
              onDiscard={() => onDiscard(p.id)}
            />
          ))}
        </ul>
      )}
    </Panel>
  )
}

const STATUS: Record<
  Exclude<Proposal['status'], 'pending'>,
  { label: string; tone: 'green' | 'gray' | 'red' }
> = {
  approved: { label: 'applied', tone: 'green' },
  discarded: { label: 'discarded', tone: 'gray' },
  failed: { label: 'could not apply', tone: 'red' },
}

function ProposalCard({
  proposal: p,
  pipelineName,
  onApprove,
  onDiscard,
}: {
  proposal: Proposal
  pipelineName: string
  onApprove: () => void
  onDiscard: () => void
}) {
  const settled = p.status !== 'pending'
  const status = settled ? STATUS[p.status as Exclude<Proposal['status'], 'pending'>] : null
  const detail = proposalDetail(p.input)

  return (
    <li
      className={
        settled
          ? 'rounded-lg border border-hairline bg-well/40 px-3.5 py-3'
          : 'rounded-lg border border-hairline bg-panel px-3.5 py-3'
      }
    >
      <div className="flex items-start gap-3">
        <Sparkles
          aria-hidden
          strokeWidth={1.7}
          className={settled ? 'mt-0.5 size-4 shrink-0 text-text-3' : 'mt-0.5 size-4 shrink-0 text-accent'}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={settled ? 'text-sm text-text-2' : 'text-sm text-text-1'}>{p.title}</span>
            {status ? (
              <Chip tone={status.tone} size="sm">
                {status.label}
              </Chip>
            ) : null}
          </div>

          {/* What it would actually write.
              The card used to show the operation and the reason and never the
              VALUE — so someone was being asked to approve a note without being
              shown the note. Found by running the page; see `proposalDetail`. */}
          {detail ? (
            <p className="mt-1 rounded border border-hairline bg-well px-2 py-1 text-xs leading-relaxed text-text-1">
              {detail}
            </p>
          ) : null}

          {/* The reason, in the model's own words. The thing actually being
              judged, so it is never behind a disclosure. */}
          {p.rationale ? (
            <p className="mt-1.5 text-xs leading-relaxed text-text-2">{p.rationale}</p>
          ) : null}

          {p.status === 'failed' && p.error ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-danger">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" strokeWidth={1.8} aria-hidden />
              {p.error}
            </p>
          ) : null}

          {/* What it would actually run. Small, monospaced and always present:
              a person approving a write to their own records is entitled to
              know which operation they are approving, and the title above is a
              paraphrase. */}
          <p className="mt-1.5 truncate font-mono text-xs text-text-3">
            {p.tool} · from {pipelineName}
          </p>
        </div>

        {settled ? null : (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" onClick={onApprove}>
              <Check className="size-3.5" strokeWidth={2} aria-hidden />
              Approve
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title="Discard this suggestion"
              aria-label={`Discard: ${p.title}`}
              onClick={onDiscard}
            >
              <X className="size-3.5" strokeWidth={1.8} aria-hidden />
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}
