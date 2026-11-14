import { useNavigate } from 'react-router'
import { appPath } from '@/lib/links'
import { useToast } from '@/lib/toast-context'
import { useModelSettings } from '@/lib/model-settings-context'
import { useFillFromPosting } from '@/lib/fill-from-posting'
import { isConfigured } from '@/lib/llm'
import { takeReading } from '@/lib/scout-reading'
import { scoutReading } from '@jojo/service/core/proposal'
import { fillDoneToast, fillFailedToast, withScheme } from './scout-approval'
import type { PostingPages } from './use-posting-pages'

/**
 * The draft an approved job becomes, and — for a posting — the page read into it.
 *
 * Reported 2026-10-27: approving a scouted job filed it and stopped, so the
 * person had to press "Add to applications" for every job they had already
 * said yes to, and the draft that made was named off the address alone —
 * "CRA — Assistant professor manhattan kansas" for a Kansas State posting on
 * CRA's board. Approval now makes the draft itself, and the posting is read
 * the way "From link" reads one: the page is opened, the model is asked for
 * the employer, role, location, pay, deadline and posting ID, the page is
 * kept in the Vault and filed under the draft, and the draft is filled from
 * what the page said.
 *
 * The draft exists before the read finishes, from the address — so a read
 * that fails (no extension, no model, a sign-in wall) still leaves the job in
 * the applications, and says why the details are thin. Without a model there
 * is nothing to ask, and the page is only kept, as approval did before.
 */
export function useFillDraft(pages: PostingPages) {
  const { reader, settings } = useModelSettings()
  const fillFromPosting = useFillFromPosting()
  const { toast } = useToast()
  const navigate = useNavigate()

  return async (
    application: { id: string; org: string },
    typed: string,
    title: string,
    /** The suggestion it was approved from, whose page may already have been read. */
    proposal?: { id: string; reading?: string | undefined },
  ) => {
    const postingUrl = withScheme(typed)
    if (!isConfigured(settings)) {
      pages.keepAndReport(postingUrl, title)
      return
    }
    await pages.whileKeeping(postingUrl, async () => {
      // Read while it waited for an answer, or being read right now — see
      // `ScoutReader`. Either way the page is not opened a second time.
      // Taken from the reader when it has one, running or finished: under
      // Approve all a read can finish before this card's turn, after the card
      // stopped being able to store it.
      const pending = proposal ? takeReading(proposal.id) : undefined
      const known =
        (pending ? await pending : null) ?? (proposal ? scoutReading(proposal.reading) : null)
      const out = await fillFromPosting({
        applicationId: application.id,
        url: postingUrl,
        settings,
        reader,
        ...(known?.ok ? { known } : {}),
      })
      if (!out.ok) {
        toast({ ...fillFailedToast(application.org, out), tone: 'danger' })
        return
      }
      if (out.duplicate) {
        const { duplicate } = out
        // The draft is gone; a reader sitting on its page is moved to the one kept.
        if (window.location.pathname === appPath(application as Parameters<typeof appPath>[0])) {
          navigate(appPath({ id: duplicate.id }))
        }
        toast({
          title: `Already in your applications — not added again`,
          description: `The posting is ${duplicate.name}, which you already have. ${duplicate.why} Its page is filed under that one.`,
          action: { label: 'Keep both', onClick: duplicate.restore },
        })
        return
      }
      toast({
        ...fillDoneToast(out),
        action: { label: 'Open', onClick: () => navigate(appPath({ id: out.application })) },
      })
    })
  }
}

export type FillDraft = ReturnType<typeof useFillDraft>
