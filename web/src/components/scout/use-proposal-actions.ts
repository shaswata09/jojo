import { useNavigate } from 'react-router'
import type { useScout } from '@jojo/service/react/use-scout'
import type { PipelinesState } from '@jojo/service/react/use-pipelines'
import { appPath } from '@/lib/links'
import { useToast } from '@/lib/toast-context'
import { useModelSettings } from '@/lib/model-settings-context'
import { isConfigured } from '@/lib/llm'
import { useDropDiscardedPage } from '@/lib/scout-reading'
import { report } from '@/lib/analytics'
import { postingPreview, scoutReading } from '@jojo/service/core/proposal'
import type { ApprovedJob } from '@jojo/service/core/proposal'
import { announceRefusal } from '@/components/common/write-result'
import { approveAllToast, approvedDescription, identityOf } from './scout-approval'
import { useAlreadyHave } from './use-already-have'
import type { FillDraft } from './use-fill-draft'
import type { PostingPages } from './use-posting-pages'

/**
 * Answering the scout's suggestions: approve, approve all, discard, clear all,
 * with the scout-reading hand-off each one makes.
 */
export function useProposalActions(
  scout: ReturnType<typeof useScout>,
  engine: PipelinesState,
  pages: PostingPages,
  fillDraft: FillDraft,
) {
  const { updatePosting, promoteToApplication, promotePosting } = scout
  const { settings } = useModelSettings()
  const { toast } = useToast()
  const navigate = useNavigate()
  const dropDiscardedPage = useDropDiscardedPage()
  const { alreadyHave, sayAlreadyHave } = useAlreadyHave()

  /** The draft an approved job becomes — see `useFillDraft` for the page read into it. */
  const draftFrom = (kind: ApprovedJob['kind'], id: string) =>
    kind === 'match' ? promoteToApplication(id) : promotePosting(id)

  /** One approval: the job filed, its draft made, and the page read into it. Returns the draft. */
  const approveOne = (id: string) => {
    const proposal = engine.proposals.find((p) => p.id === id)
    const made = engine.approve(id)
    if (
      !made ||
      !proposal ||
      (proposal.tool !== 'scout.match.save' && proposal.tool !== 'scout.posting.save')
    ) {
      return null
    }
    const kind = proposal.tool === 'scout.match.save' ? 'match' : 'posting'
    const seen = kind === 'posting' ? postingPreview(proposal.tool, proposal.input) : null
    const page = seen?.href ? { url: seen.href, title: seen.title ?? seen.label } : null
    // Already an application under another board's address: the posting is
    // filed against that one instead of becoming a second.
    const existing =
      kind === 'posting' ? alreadyHave(identityOf(proposal.input, proposal.reading)) : null
    if (existing) {
      // Refused, the posting is still saved — only the link to the existing
      // application is missing — so the reader is told and the flow goes on.
      announceRefusal(updatePosting(made, { applicationId: existing.id }), toast)
      return { repeat: true as const, existing, page }
    }
    const application = draftFrom(kind, made)
    if (!application) return null
    return { repeat: false as const, application, page, proposal }
  }

  const onApprove = (id: string) => {
    const done = approveOne(id)
    report('scout_proposal_decided', { decision: 'approved' })
    if (!done) return
    if (done.repeat) {
      if (done.page) pages.keepAndReport(done.page.url, done.page.title)
      sayAlreadyHave(done.existing, done.existing)
      return
    }
    const { application, page, proposal } = done
    // Already read while it waited: the fill's own toast follows at once and
    // says everything, so a "reading…" one in front of it would only flicker.
    const readAlready = page !== null && scoutReading(proposal.reading)?.ok === true
    if (!readAlready)
      toast({
        title: `${application.org} added to your applications as a draft`,
        description: approvedDescription(page !== null, isConfigured(settings)),
        action: { label: 'Open', onClick: () => navigate(appPath(application)) },
      })
    if (page) void fillDraft(application, page.url, page.title, proposal)
  }

  /**
   * Approve all: each job its own approval and its own draft, then the pages
   * read one at a time — each opens a tab and asks the model, and a dozen at
   * once would be a dozen tabs.
   */
  const onApproveAll = (pipelineId: string) => {
    const ids = engine.proposals
      .filter((p) => p.pipelineId === pipelineId && p.status === 'pending')
      .map((p) => p.id)
    const results = ids.flatMap((id) => {
      const one = approveOne(id)
      return one ? [one] : []
    })
    const done = results.flatMap((r) => (r.repeat ? [] : [r]))
    const repeats = results.flatMap((r) => (r.repeat ? [r] : []))
    for (const r of repeats) if (r.page) pages.keepAndReport(r.page.url, r.page.title)
    report('scout_proposal_decided', { decision: 'approved' })
    const said = approveAllToast(done.length, repeats.length, isConfigured(settings))
    if (said) toast(said)
    if (done.length === 0) return
    void (async () => {
      for (const { application, page, proposal } of done) {
        if (page) await fillDraft(application, page.url, page.title, proposal)
      }
    })()
  }

  const onDiscard = (id: string) => {
    engine.discard(id)
    dropDiscardedPage(id)
    report('scout_proposal_decided', { decision: 'declined' })
  }

  const onClearAll = () => {
    // Every card the clear declines gives back the page its read kept,
    // as a Discard does; the rest of the queue was answered already.
    const pending = engine.proposals.filter((p) => p.status === 'pending').map((p) => p.id)
    if (announceRefusal(engine.clearAll(), toast)) return
    for (const id of pending) dropDiscardedPage(id)
  }

  return { onApprove, onApproveAll, onDiscard, onClearAll }
}
