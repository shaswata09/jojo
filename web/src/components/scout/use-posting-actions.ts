import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { draftFromUrl } from '@/components/applications/draft-from'
import type { useScout } from '@jojo/service/react/use-scout'
import { appPath, scoutPath } from '@/lib/links'
import { useToast } from '@/lib/toast-context'
import { useModelSettings } from '@/lib/model-settings-context'
import { isConfigured } from '@/lib/llm'
import { useUndoable } from '@/lib/undo'
import type { ApprovedJob } from '@jojo/service/core/proposal'
import { announceRefusal } from '@/components/common/write-result'
import { useAlreadyHave } from './use-already-have'
import type { FillDraft } from './use-fill-draft'
import type { PostingPages } from './use-posting-pages'
import { useMascot } from '@/lib/mascot-context'
import { CUES } from '@/lib/mascot-cues'

/** Saving, promoting and removing postings, and promoting matches. */
export function usePostingActions(
  scout: ReturnType<typeof useScout>,
  pages: PostingPages,
  fillDraft: FillDraft,
) {
  const {
    postings,
    addPosting,
    removePosting,
    updatePosting,
    promoteToApplication,
    promotePosting,
  } = scout
  const { settings } = useModelSettings()
  const { t } = useTranslation('scout')
  const { toast } = useToast()
  const mascot = useMascot()
  const navigate = useNavigate()
  const undoable = useUndoable()
  const { alreadyHave, sayAlreadyHave } = useAlreadyHave()
  const [url, setUrl] = useState('')

  /** The Undo on a promotion: reverts the write and brings the reader back here. */
  const undoBack = (restore: (() => void) | null, focus: Parameters<typeof scoutPath>[0]) =>
    restore
      ? {
          label: t('common.undo'),
          onClick: () => {
            restore()
            navigate(scoutPath(focus))
          },
        }
      : undefined

  /**
   * Turns a match into a real application and goes straight to it.
   *
   * The Undo carries the reader back to this page as well as reverting the
   * write. Without the navigation it would delete the record out from under the
   * detail route the promotion had just pushed them onto, and the page they were
   * looking at would empty itself while they were reading it.
   */
  const onPromote = (matchId: string) => {
    const { value: application, restore } = undoable(() => promoteToApplication(matchId))
    if (!application) return
    mascot.play(CUES.applicationAdded)
    toast({
      title: t('toasts.addedAsDraft', { org: application.org }),
      description: t('toasts.matchStays'),
      action: undoBack(restore, { focus: { kind: 'match', id: matchId } }),
    })
    navigate(appPath(application))
  }

  /**
   * Files the posting. No page is fetched — nothing here can — so the record
   * says what it is: a URL you kept, with the employer guessed off it.
   */
  const onSavePosting = () => {
    const text = url.trim()
    if (!text) return
    const guess = draftFromUrl(text)
    const title = [guess.org, guess.role].filter(Boolean).join(' — ') || text
    addPosting({ title, url: text, size: '—' })
    setUrl('')
    toast({ title: t('toasts.postingSaved'), description: title })
    pages.keepAndReport(text, title)
  }

  /** The second way in, and the one the panel copy promises. Same shape as the
   *  match promotion above: the posting stays filed, now linked, and the Undo
   *  reverts the write and brings the reader back off the detail route. */
  const onPromotePosting = (postingId: string) => {
    const posting = postings.find((p) => p.id === postingId)
    const existing = posting
      ? alreadyHave({
          org: posting.org,
          role: posting.title,
          location: posting.location,
          url: posting.url,
        })
      : null
    if (posting && existing) {
      if (announceRefusal(updatePosting(postingId, { applicationId: existing.id }), toast)) return
      if (!pages.pageFor(posting)) pages.keepAndReport(posting.url, posting.title)
      sayAlreadyHave(existing, existing)
      return
    }
    const { value: application, restore } = undoable(() => promotePosting(postingId))
    if (!application) return
    /*
     * With a model connected, the posting is read into the draft — the same
     * check approval makes (`fillDraft`): the page opened, the employer, role,
     * location, pay, deadline and posting ID read off it, and the draft filled
     * where the address alone had guessed. Without one, the page is only kept
     * — and filed under the application by the promote when it already was.
     */
    const reading = Boolean(posting) && isConfigured(settings)
    if (posting && reading) void fillDraft(application, posting.url, posting.title)
    else if (posting && !pages.pageFor(posting)) pages.keepAndReport(posting.url, posting.title)
    mascot.play(CUES.applicationAdded)
    toast({
      title: t('toasts.addedAsDraft', { org: application.org }),
      description: reading ? t('toasts.postingReading') : t('toasts.postingStays'),
      action: undoBack(restore, { focus: { kind: 'posting', id: postingId } }),
    })
    navigate(appPath(application))
  }

  const onPromoteJob = (job: ApprovedJob) =>
    job.kind === 'match' ? onPromote(job.id) : onPromotePosting(job.id)

  /** A URL and a title, retyped in seconds — undo toast, no confirmation. */
  const onRemovePosting = (id: string, title: string) => {
    const { restore } = removePosting(id)
    toast({
      title: t('toasts.postingRemoved'),
      description: title,
      tone: 'danger',
      action: { label: t('common.undo'), onClick: restore },
    })
  }

  return { url, setUrl, onPromote, onSavePosting, onPromotePosting, onPromoteJob, onRemovePosting }
}
