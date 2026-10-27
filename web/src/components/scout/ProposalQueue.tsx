import {
  Check,
  ExternalLink,
  FilePlus2,
  Inbox,
  ListChecks,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Chip } from '@/components/common/Chip'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { approvedLabel, postingPreview, proposalDetail } from '@jojo/service/core/proposal'
import type { ApprovedJob } from '@jojo/service/core/proposal'
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
 *
 * An approved SCOUT card keeps one more button: Add to applications. Approving
 * files the job into Matches or Postings and deliberately stops there, and the
 * card used to say "applied" over that — so people approved a job, looked in
 * their applications table, and reasonably concluded the scout was broken.
 */
export function ProposalQueue({
  proposals,
  pipelines,
  onApprove,
  onDiscard,
  onApproveAll,
  onSweep,
  onClearAll,
  jobFor,
  onPromote,
}: {
  /** Every proposal, in creation order. This component splits them. */
  proposals: readonly Proposal[]
  pipelines: readonly Pipeline[]
  onApprove: (id: string) => void
  onDiscard: (id: string) => void
  onApproveAll: (pipelineId: string) => void
  onSweep: (pipelineId: string) => void
  onClearAll: () => void
  /** The match or posting an approved scout card saved, or null for anything else. */
  jobFor: (proposal: Proposal) => ApprovedJob | null
  /** The second step: turn that saved job into a draft application. */
  onPromote: (job: ApprovedJob) => void
}) {
  const [confirming, setConfirming] = useState(false)
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
          {/* Not restricted to one pipeline, unlike its two neighbours.
              Approve all is limited that way because approving writes to the
              person's records and a single press spanning two searches is a
              gesture they could not describe afterwards. Clearing writes to
              nothing but the queue, and the queue is exactly what someone
              wants gone when two pipelines have both been filling it — the
              restriction would withhold the button at the one moment it is
              worth having. */}
          {proposals.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              <Trash2 className="size-3.5" strokeWidth={1.8} aria-hidden />
              Clear all
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
        /*
         * `grid-cols-1`, not a bare `grid`. A bare grid's one column is `auto`,
         * which grows to the widest thing any card cannot wrap — and a card's
         * posting link is single-line by design (it ends in "…"), so one long
         * Workday or LinkedIn address made every card in the list wider than
         * the panel. Measured 2026-10-27: a 190-character link pushed all three
         * cards 450px past the panel's edge at 1200px, and the page scrolled
         * sideways. `grid-cols-1` is `minmax(0, 1fr)`: the column is the
         * panel's width, and the link is what gives way.
         */
        <ul className="grid grid-cols-1 gap-2.5">
          {[...pending, ...answered].map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              pipelineName={nameOf(p.pipelineId)}
              onApprove={() => onApprove(p.id)}
              onDiscard={() => onDiscard(p.id)}
              job={p.status === 'approved' ? jobFor(p) : null}
              onPromote={onPromote}
            />
          ))}
        </ul>
      )}

      {/* Asked for, because it declines things. The answered half is only a
          tidy-up, but anything still pending is a decision the person has not
          made yet and this makes it for them — silently turning down five
          suggestions on a mis-click is the failure worth a dialog. The count
          is in the sentence so they know the size of what they are agreeing
          to. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Clear all suggestions?"
        description={
          pending.length > 0
            ? `${String(pending.length)} ${pending.length === 1 ? 'suggestion is' : 'suggestions are'} still waiting for you and will be declined. Nothing in your records changes, and the pipelines keep running — but they will not offer these again.`
            : 'The answered cards come off the list. Nothing in your records changes.'
        }
        confirmLabel="Clear all"
        tone="danger"
        onConfirm={onClearAll}
      />
    </Panel>
  )
}

const STATUS: Record<
  Exclude<Proposal['status'], 'pending'>,
  { label: string; tone: 'green' | 'gray' | 'red' }
> = {
  // The approved label depends on the tool — see `approvedLabel`.
  approved: { label: 'applied', tone: 'green' },
  discarded: { label: 'discarded', tone: 'gray' },
  failed: { label: 'could not apply', tone: 'red' },
}

function ProposalCard({
  proposal: p,
  pipelineName,
  onApprove,
  onDiscard,
  job,
  onPromote,
}: {
  proposal: Proposal
  pipelineName: string
  onApprove: () => void
  onDiscard: () => void
  job: ApprovedJob | null
  onPromote: (job: ApprovedJob) => void
}) {
  const settled = p.status !== 'pending'
  const base = settled ? STATUS[p.status as Exclude<Proposal['status'], 'pending'>] : null
  const status = base && p.status === 'approved' ? { ...base, label: approvedLabel(p.tool) } : base
  const posting = postingPreview(p.tool, p.input)
  const detail = posting ? null : proposalDetail(p.input)

  return (
    <li
      className={
        settled
          ? 'min-w-0 rounded-lg border border-hairline bg-well/40 px-3.5 py-3'
          : 'min-w-0 rounded-lg border border-hairline bg-panel px-3.5 py-3'
      }
    >
      {/* Wraps, so on a narrow screen the buttons drop under the text rather
          than squeezing the summary — the thing being judged — to one word a line. */}
      <div className="flex flex-wrap items-start gap-3">
        <Sparkles
          aria-hidden
          strokeWidth={1.7}
          className={
            settled ? 'mt-0.5 size-4 shrink-0 text-text-3' : 'mt-0.5 size-4 shrink-0 text-accent'
          }
        />
        <div className="min-w-48 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                'min-w-0 text-sm wrap-anywhere',
                settled ? 'text-text-2' : 'text-text-1',
              )}
            >
              {p.title}
            </span>
            {status ? (
              <Chip tone={status.tone} size="sm">
                {status.label}
              </Chip>
            ) : null}
          </div>

          {/* A posting, shown as something to judge rather than as a payload:
              what the job is, in the scout's two sentences, and the link as a
              link. The bare URL in the detail line below could be neither read
              nor clicked, and "is this worth opening?" is the whole decision. */}
          {posting ? (
            <div className="mt-1 space-y-1">
              {posting.summary ? (
                <p className="line-clamp-2 text-xs leading-relaxed wrap-anywhere text-text-1">
                  {posting.summary}
                </p>
              ) : (
                <p className="text-xs text-text-3 italic">
                  No summary came with this one — open the posting to see what it is.
                </p>
              )}
              {posting.href ? (
                <a
                  href={posting.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={posting.href}
                  className="block truncate text-xs text-accent underline-offset-2 hover:underline"
                >
                  {posting.label}
                </a>
              ) : (
                <p
                  className="truncate text-xs text-text-3"
                  title="Not a web address, so it is not offered as a link"
                >
                  {posting.label}
                </p>
              )}
            </div>
          ) : null}

          {/* What it would actually write.
              The card used to show the operation and the reason and never the
              VALUE — so someone was being asked to approve a note without being
              shown the note. Found by running the page; see `proposalDetail`. */}
          {detail ? (
            <p className="mt-1 rounded border border-hairline bg-well px-2 py-1 text-xs leading-relaxed wrap-anywhere text-text-1">
              {detail}
            </p>
          ) : null}

          {/* The reason, in the model's own words. The thing actually being
              judged, so it is never behind a disclosure. */}
          {p.rationale ? (
            <p className="mt-1.5 text-xs leading-relaxed wrap-anywhere text-text-2">
              {p.rationale}
            </p>
          ) : null}

          {p.status === 'failed' && p.error ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs wrap-anywhere text-danger">
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

        {posting?.href || !settled || job ? (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {posting?.href ? (
              <Button size="sm" variant="outline" asChild>
                <a
                  href={posting.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open posting in a new tab: ${posting.title ?? posting.label}`}
                >
                  <ExternalLink className="size-3.5" strokeWidth={1.8} aria-hidden />
                  Open posting
                </a>
              </Button>
            ) : null}
            {/* The second step, where the first one left the reader. Once taken
                it says so instead, the same way the Matches row does. */}
            {job?.applicationId ? (
              <Chip tone="teal" size="sm">
                In applications
              </Chip>
            ) : job ? (
              <Button size="sm" onClick={() => onPromote(job)}>
                <FilePlus2 className="size-3.5" strokeWidth={1.8} aria-hidden />
                Add to applications
              </Button>
            ) : null}
            {settled ? null : (
              <>
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
              </>
            )}
          </div>
        ) : null}
      </div>
    </li>
  )
}
