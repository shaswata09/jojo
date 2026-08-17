import { useEffect, useRef, useState } from 'react'
import {
  ClosedFields,
  InterviewFields,
  KeepOfferRow,
  OfferFields,
  SubmittedFields,
} from '@/components/applications/dialog/TransitionFields'
import {
  buildStageItem,
  buildStagePatch,
  initialStageDraft,
  leavingOffer,
  plainStageMove,
  stageBlocker,
  stageConsequences,
  stageNeedsDetails,
} from '@/components/applications/dialog/stage-policy'
import type { StageTransitionDraft } from '@/components/applications/dialog/stage-policy'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { STAGE_LABEL, displayName } from '@/data/seed'
import type { Application, Stage } from '@/data/seed'
import type { TimelineDraft } from '@/kg/react/use-timeline'
import { TODAY } from '@/lib/today'

export type StageTransitionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  application: Application
  target: Stage
  /**
   * The store write, owned by the caller. `extraItem` is the timeline row the
   * user opted into — handed over rather than written here, so this component
   * stays a form and the app keeps exactly one writer per collection.
   *
   * `consequences` are the sentences the confirmation should say, built here
   * because this is the only place that knows which switch was on. The caller
   * could re-derive most of them from `patch`, but not all: "offer details
   * cleared" and "nothing else changed" are both an *absence* in the patch, and
   * a toast that guesses at an absence is how you end up promising the user
   * something the store did not do.
   */
  onApply: (
    patch: Partial<Application>,
    extraItem: TimelineDraft | undefined,
    consequences: string[],
  ) => void
}

/**
 * One dialog for every stage change in the app, switched on the target.
 *
 * Four separate dialogs was the obvious shape and the wrong one: each stage
 * needs two or three fields, and four components would be four places for the
 * "moved to X" copy, the move-without-details path and the offer-retention
 * question to drift apart. It also makes the rule enforceable that `offer` can only ever be
 * populated here — there is one form that writes it, so an offer cannot appear
 * on a record without a respond-by date beside it.
 */
export function StageTransitionDialog({
  open,
  onOpenChange,
  application,
  target,
  onApply,
}: StageTransitionDialogProps) {
  const needs = stageNeedsDetails(application, target)
  const applied = useRef(false)

  /**
   * Backstop for a caller that opened this without checking
   * `stageNeedsDetails`. Without it the user would be looking at an empty
   * dialog and the stage change would be silently swallowed. The ref stops the
   * write repeating if the effect re-runs before the close lands.
   */
  useEffect(() => {
    if (!open) {
      applied.current = false
      return
    }
    if (needs || applied.current) return
    applied.current = true
    onApply(plainStageMove(target), undefined, [])
    onOpenChange(false)
  }, [open, needs, target, onApply, onOpenChange])

  if (!needs) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move to {STAGE_LABEL[target]}</DialogTitle>
          <DialogDescription>
            {displayName(application)} · currently {STAGE_LABEL[application.stage]}
          </DialogDescription>
        </DialogHeader>

        {/* Keyed on the target so switching destination while open starts a
            clean form rather than carrying the last one's half-typed values. */}
        <TransitionForm
          key={target}
          application={application}
          target={target}
          onApply={onApply}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

/**
 * The stage-change form: what each destination collects, and what it writes.
 *
 * The field blocks themselves live in `dialog/TransitionFields.tsx`; everything
 * here is the state behind them and the three answers the footer's three
 * buttons give.
 */
function TransitionForm({
  application,
  target,
  onApply,
  onClose,
}: {
  application: Application
  target: Stage
  onApply: StageTransitionDialogProps['onApply']
  onClose: () => void
}) {
  // One bag rather than eleven `useState`s. The eleven were fine while the
  // rules that read them lived in this file; now that they are a value handed
  // to `dialog/stage-policy.ts`, keeping them apart meant assembling the bag by
  // hand at three call sites and forgetting a field at one of them.
  const [draft, setDraft] = useState<StageTransitionDraft>(() =>
    initialStageDraft(application, TODAY),
  )
  const set = <K extends keyof StageTransitionDraft>(key: K, value: StageTransitionDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const showKeepOffer = leavingOffer(application, target)
  const blocker = stageBlocker(target, draft)

  const apply = () => {
    const item = buildStageItem(application, target, draft)
    onApply(
      buildStagePatch(application, target, draft),
      item,
      stageConsequences(application, target, draft, item),
    )
    onClose()
  }

  /** The stage change with nothing attached — including the offer, kept as-is. */
  const moveWithoutDetails = () => {
    onApply(plainStageMove(target), undefined, ['Nothing else on the record changed.'])
    onClose()
  }

  return (
    // A real <form>, so Enter commits.
    //
    // This is the one dialog in the app built almost entirely out of one-field
    // forms — a date, a date and a format, an outcome — and pressing Enter in a
    // date box did nothing at all. Native validation is left on deliberately:
    // there are no custom messages to pre-empt here, and an emptied required
    // date then explains itself at the field instead of only as a `title` on a
    // dead button.
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (blocker) return
        apply()
      }}
    >
      <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto">
        {target === 'submitted' ? (
          <SubmittedFields
            date={draft.date}
            onDateChange={(v) => set('date', v)}
            portalUrl={draft.portalUrl}
            onPortalUrlChange={(v) => set('portalUrl', v)}
            reference={draft.reference}
            onReferenceChange={(v) => set('reference', v)}
          />
        ) : null}

        {target === 'interview' ? (
          <InterviewFields
            date={draft.date}
            onDateChange={(v) => set('date', v)}
            format={draft.format}
            onFormatChange={(v) => set('format', v)}
            mintInterview={draft.mintInterview}
            onMintInterviewChange={(v) => set('mintInterview', v)}
          />
        ) : null}

        {target === 'offer' ? (
          <OfferFields
            respondBy={draft.respondBy}
            onRespondByChange={(v) => set('respondBy', v)}
            offerComp={draft.offerComp}
            onOfferCompChange={(v) => set('offerComp', v)}
            offerNote={draft.offerNote}
            onOfferNoteChange={(v) => set('offerNote', v)}
            mintRespondBy={draft.mintRespondBy}
            onMintRespondByChange={(v) => set('mintRespondBy', v)}
          />
        ) : null}

        {target === 'closed' ? (
          <ClosedFields outcome={draft.outcome} onOutcomeChange={(v) => set('outcome', v)} />
        ) : null}

        {showKeepOffer ? (
          <KeepOfferRow
            offer={application.offer}
            keepOffer={draft.keepOffer}
            onKeepOfferChange={(v) => set('keepOffer', v)}
          />
        ) : null}
      </div>

      {/* Three exits, and none of them lies about what it does.
          "Skip for now" used to sit here and commit the stage change — the word
          skip in front of a write, with the unlabelled corner X as the only way
          out that left the record alone. Cancel is now a real DialogClose that
          writes nothing; the middle button says what it actually does; and the
          ghost / outline / solid ladder is what tells the three apart at a
          glance, which a footer of two identical outlines would not. */}
      <DialogFooter className="mt-4">
        {blocker ? (
          <p className="text-xs text-text-3 sm:mr-auto sm:self-center">{blocker}</p>
        ) : null}
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <Button type="button" variant="outline" onClick={moveWithoutDetails}>
          Move without details
        </Button>
        <Button type="submit" disabled={Boolean(blocker)}>
          Move to {STAGE_LABEL[target]}
        </Button>
      </DialogFooter>
    </form>
  )
}
