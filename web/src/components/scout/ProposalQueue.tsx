import {
  Check,
  ExternalLink,
  FilePlus2,
  FileCheck2,
  Inbox,
  ListChecks,
  LoaderCircle,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Chip } from '@/components/common/Chip'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  approvedLabel,
  postingPreview,
  proposalDetail,
  scoutReading,
} from '@jojo/service/core/proposal'
import type { ScoutReading } from '@jojo/service/core/proposal'
import { KeywordChips } from '@/components/common/LabelPicker'
import { useReadingNow } from '@/lib/scout-reading-hooks'
import type { ApprovedJob } from '@jojo/service/core/proposal'
import type { Pipeline, Proposal } from '@jojo/service/core/model'
import { useDomain } from '@/i18n/domain'

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
  const { t } = useTranslation('scout')
  const [confirming, setConfirming] = useState(false)
  const pending = proposals.filter((p) => p.status === 'pending')
  const answered = proposals.filter((p) => p.status !== 'pending')
  const nameOf = (id: string | null) =>
    pipelines.find((p) => p.id === id)?.name ?? t('proposals.aPipeline')

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
    <Panel focusId="section:proposals">
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
        <PanelTitle className="mb-0" hint={t('proposals.hint')}>
          {t('proposals.title')}
        </PanelTitle>
        <div className="flex items-center gap-2">
          {answered.length > 0 && answeredFrom ? (
            <Button size="sm" variant="ghost" onClick={() => onSweep(answeredFrom)}>
              {t('proposals.clearAnswered')}
            </Button>
          ) : null}
          {pending.length > 1 && pendingFrom ? (
            <Button size="sm" variant="outline" onClick={() => onApproveAll(pendingFrom)}>
              <ListChecks className="size-3.5" strokeWidth={1.8} aria-hidden />
              {t('proposals.approveAll', { count: pending.length })}
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
              {t('proposals.clearAll')}
            </Button>
          ) : null}
        </div>
      </div>

      {proposals.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={t('proposals.emptyTitle')}
          description={t('proposals.emptyDescription')}
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
        title={t('proposals.clearTitle')}
        description={
          pending.length > 0
            ? t('proposals.clearPending', { count: pending.length })
            : t('proposals.clearAnsweredOnly')
        }
        confirmLabel={t('proposals.clearAll')}
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
  // Catalog keys. The approved label depends on the tool — see `approvedLabel`.
  approved: { label: 'proposals.status.applied', tone: 'green' },
  discarded: { label: 'proposals.status.discarded', tone: 'gray' },
  failed: { label: 'proposals.status.failed', tone: 'red' },
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
  const { t } = useTranslation('scout')
  const settled = p.status !== 'pending'
  const base = settled ? STATUS[p.status as Exclude<Proposal['status'], 'pending'>] : null
  const status = base
    ? { ...base, label: p.status === 'approved' ? approvedLabel(p.tool) : t(base.label) }
    : null
  const posting = postingPreview(p.tool, p.input)
  const detail = posting ? null : proposalDetail(p.input)
  const reading = posting ? scoutReading(p.reading) : null
  const readingNow = useReadingNow(p.id)

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
              ) : reading?.ok || readingNow ? null : (
                // Not said once the page itself has been read (or is being):
                // the reading below is the summary, and better.
                <p className="text-xs text-text-3 italic">{t('proposals.noSummary')}</p>
              )}
              {readingNow ? (
                <p className="flex items-center gap-1.5 text-xs text-text-3">
                  <LoaderCircle
                    className="size-3 shrink-0 animate-spin motion-reduce:animate-none"
                    strokeWidth={1.8}
                    aria-hidden
                  />
                  {t('proposals.reading')}
                </p>
              ) : reading ? (
                <ReadingLine reading={reading} />
              ) : null}
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
                <p className="truncate text-xs text-text-3" title={t('proposals.notALink')}>
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
            {p.tool} · {t('proposals.from', { name: pipelineName })}
          </p>
        </div>

        {posting?.href || !settled || job ? (
          <div className="ms-auto flex shrink-0 items-center gap-1.5">
            {posting?.href ? (
              <Button size="sm" variant="outline" asChild>
                <a
                  href={posting.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('proposals.openPostingAria', {
                    title: posting.title ?? posting.label,
                  })}
                >
                  <ExternalLink className="size-3.5" strokeWidth={1.8} aria-hidden />
                  {t('proposals.openPosting')}
                </a>
              </Button>
            ) : null}
            {/* The second step, where the first one left the reader. Once taken
                it says so instead, the same way the Matches row does. */}
            {job?.applicationId ? (
              <Chip tone="teal" size="sm">
                {t('proposals.inApplications')}
              </Chip>
            ) : job ? (
              <Button size="sm" onClick={() => onPromote(job)}>
                <FilePlus2 className="size-3.5" strokeWidth={1.8} aria-hidden />
                {t('common.addToApplications')}
              </Button>
            ) : null}
            {settled ? null : (
              <>
                <Button size="sm" onClick={onApprove}>
                  <Check className="size-3.5" strokeWidth={2} aria-hidden />
                  {t('proposals.approve')}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title={t('proposals.discard')}
                  aria-label={t('proposals.discardAria', { title: p.title })}
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

/**
 * What the posting's page said, read before the card was answered — see
 * `ScoutReader`. The employer, role and place first, because those decide
 * whether a job is worth a look; then the deadline, the person's own keywords
 * the page matched, and whether the page itself was kept.
 */
function ReadingLine({ reading }: { reading: ScoutReading }) {
  const { t } = useTranslation('scout')
  const domain = useDomain()
  if (!reading.ok) {
    return (
      <p className="flex items-start gap-1.5 text-xs leading-relaxed wrap-anywhere text-text-3">
        <TriangleAlert className="mt-0.5 size-3 shrink-0" strokeWidth={1.8} aria-hidden />
        <span>
          {reading.fileId
            ? t('proposals.unreadableKept', { reason: reading.reason })
            : t('proposals.unreadable', { reason: reading.reason })}
        </span>
      </p>
    )
  }
  const { fields } = reading
  const who = [fields.org, fields.role].filter(Boolean).join(' — ')
  const facts = [
    fields.location,
    fields.comp && fields.comp.length <= 60 ? fields.comp : undefined,
    fields.deadline
      ? t('proposals.applyBy', { date: domain.shortDate(fields.deadline) })
      : undefined,
  ].filter(Boolean)
  return (
    <div className="space-y-1 rounded border border-hairline bg-well px-2 py-1.5">
      {who ? <p className="text-xs font-medium wrap-anywhere text-text-1">{who}</p> : null}
      {facts.length > 0 ? (
        <p className="text-xs wrap-anywhere text-text-2">{facts.join(' · ')}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <KeywordChips ids={reading.keywords.map((k) => k.id)} />
        {reading.fileId ? (
          <span className="flex items-center gap-1 text-xs text-text-3">
            <FileCheck2 className="size-3 shrink-0" strokeWidth={1.8} aria-hidden />
            {t('proposals.pageSaved')}
          </span>
        ) : null}
      </div>
    </div>
  )
}
