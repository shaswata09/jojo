import { useEffect, useRef, useState } from 'react'
import { STAGE_LABEL } from '@/components/applications/StageMenu'
import {
  ClosedFields,
  InterviewFields,
  KeepOfferRow,
  OfferFields,
  SubmittedFields,
} from '@/components/applications/dialog/TransitionFields'
import {
  FORMAT_LABEL,
  OUTCOME_ACTION,
  OUTCOME_LABEL,
} from '@/components/applications/dialog/transition-options'
import type { Format } from '@/components/applications/dialog/transition-options'
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
import { displayName } from '@/data/seed'
import type { Application, Outcome, Stage } from '@/data/seed'
import { addDays, shortDate } from '@/data/timeline'
import type { TimelineDraft } from '@/kg/react/use-timeline'
import { TODAY } from '@/lib/today'

/** The four stages that carry a field block. Draft and Screen collect nothing. */
const BLOCKED_STAGES: readonly Stage[] = ['submitted', 'interview', 'offer', 'closed']

/**
 * Whether moving this application to `target` has anything to ask about.
 *
 * Call it before opening: a move to Draft or Screen should just happen, and a
 * dialog whose only content is a Confirm button is a speed bump, not a step.
 * Leaving an offer is the exception — the details have to be kept or dropped
 * deliberately, whatever the destination is.
 */
export function stageNeedsDetails(application: Application, target: Stage) {
  if (application.stage === target) return false
  if (application.offer && target !== 'offer') return true
  return BLOCKED_STAGES.includes(target)
}

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
    onApply({ stage: target, lastAction: `Moved to ${STAGE_LABEL[target]}` }, undefined, [])
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
  const [date, setDate] = useState(TODAY)
  const [portalUrl, setPortalUrl] = useState(application.url ?? '')
  const [reference, setReference] = useState('')

  const [format, setFormat] = useState<Format>('video')
  const [mintInterview, setMintInterview] = useState(true)

  // Two weeks is the shortest deadline anyone actually gets, so it is a floor
  // the user edits down rather than a date they have to invent.
  const [respondBy, setRespondBy] = useState(application.offer?.respondBy ?? addDays(TODAY, 14))
  const [offerComp, setOfferComp] = useState(application.offer?.comp ?? application.comp ?? '')
  const [offerNote, setOfferNote] = useState(application.offer?.note ?? '')
  const [mintRespondBy, setMintRespondBy] = useState(true)

  const [outcome, setOutcome] = useState<Outcome>(
    application.stage === 'offer' ? 'declined' : 'rejected',
  )

  /** An offer belongs to the round that produced it, so keeping it is a choice. */
  const leavingOffer = Boolean(application.offer) && target !== 'offer'
  const [keepOffer, setKeepOffer] = useState(true)

  /** Empty when the form can be applied; otherwise what is missing. */
  const blocker =
    (target === 'submitted' || target === 'interview') && !date
      ? 'Add the date first'
      : target === 'offer' && !respondBy
        ? 'Add a respond-by date first'
        : undefined

  const buildPatch = (): Partial<Application> => {
    const patch: Partial<Application> = { stage: target }
    if (leavingOffer && !keepOffer) patch.offer = undefined

    switch (target) {
      case 'submitted':
        patch.submittedOn = date
        // Only filled where it was empty: the day you first applied is not the
        // day you got round to recording the submission.
        patch.appliedOn = application.appliedOn ?? date
        if (portalUrl.trim()) patch.url = portalUrl.trim()
        // Application has no field for a confirmation reference, so it rides in
        // `lastAction` where the activity feed shows it. Worth knowing: the next
        // stage change overwrites that line, so the reference is not permanent
        // until the record grows a home for it.
        patch.lastAction = reference.trim()
          ? `Submitted · ref ${reference.trim()}`
          : 'Application submitted'
        break

      case 'interview':
        patch.lastAction = `${FORMAT_LABEL[format]} interview scheduled`
        break

      case 'offer':
        patch.offer = {
          respondBy,
          comp: offerComp.trim() || undefined,
          note: offerNote.trim(),
        }
        patch.lastAction = 'Offer received'
        break

      case 'closed':
        patch.outcome = outcome
        patch.lastAction = OUTCOME_ACTION[outcome]
        break

      default:
        patch.lastAction = `Moved to ${STAGE_LABEL[target]}`
    }

    return patch
  }

  /**
   * Neither draft stamps an `urgency`.
   *
   * They used to: `'amber'` on the interview and `'red'` on the respond-by, and
   * both were invented at the keyboard — an interview six weeks out was born
   * amber and a respond-by three weeks out was born red, with nothing that ever
   * updated either as the date approached or passed. Nothing reads the field:
   * the calendar, the glance grid, "Owed this week" and the priority deck all
   * derive their colour from the date (`lib/timeline-visuals.ts`). Writing a
   * value nothing reads is how the next person infers a rule that does not
   * exist and starts colouring something by it.
   */
  const buildItem = (): TimelineDraft | undefined => {
    if (target === 'interview' && mintInterview) {
      return {
        title: `${displayName(application)} — ${format} interview`,
        detail: application.roleTag,
        date,
        kind: 'interview',
        applicationId: application.id,
        remind: true,
        location: format === 'onsite' ? application.location : undefined,
      }
    }
    if (target === 'offer' && mintRespondBy) {
      return {
        title: `${displayName(application)} — respond to offer`,
        detail: 'Decision deadline',
        date: respondBy,
        kind: 'deadline',
        applicationId: application.id,
        remind: true,
      }
    }
    return undefined
  }

  /**
   * What the toast should say happened, in the order it happened.
   *
   * Only ever states things the user cannot see for themselves once the dialog
   * has gone: a date that landed on the calendar, details that were dropped.
   * The stage change itself is the toast's title, so it is not repeated here.
   */
  const consequencesOf = (item: TimelineDraft | undefined): string[] => {
    const lines: string[] = []

    if (target === 'submitted' && reference.trim()) {
      lines.push(`Reference ${reference.trim()} saved to the activity line.`)
    }
    if (target === 'offer') lines.push(`Respond by ${shortDate(respondBy)} recorded.`)
    if (target === 'closed') {
      lines.push(`Recorded as ${OUTCOME_LABEL[outcome].toLowerCase()}.`)
    }
    if (item) {
      lines.push(
        item.kind === 'deadline'
          ? `Respond by ${shortDate(item.date)} added to your calendar.`
          : `${FORMAT_LABEL[format]} interview on ${shortDate(item.date)} added to your calendar.`,
      )
    }
    if (leavingOffer && !keepOffer) lines.push('Offer details cleared.')

    return lines
  }

  const apply = () => {
    const item = buildItem()
    onApply(buildPatch(), item, consequencesOf(item))
    onClose()
  }

  /** The stage change with nothing attached — including the offer, kept as-is. */
  const moveWithoutDetails = () => {
    onApply({ stage: target, lastAction: `Moved to ${STAGE_LABEL[target]}` }, undefined, [
      'Nothing else on the record changed.',
    ])
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
            date={date}
            onDateChange={setDate}
            portalUrl={portalUrl}
            onPortalUrlChange={setPortalUrl}
            reference={reference}
            onReferenceChange={setReference}
          />
        ) : null}

        {target === 'interview' ? (
          <InterviewFields
            date={date}
            onDateChange={setDate}
            format={format}
            onFormatChange={setFormat}
            mintInterview={mintInterview}
            onMintInterviewChange={setMintInterview}
          />
        ) : null}

        {target === 'offer' ? (
          <OfferFields
            respondBy={respondBy}
            onRespondByChange={setRespondBy}
            offerComp={offerComp}
            onOfferCompChange={setOfferComp}
            offerNote={offerNote}
            onOfferNoteChange={setOfferNote}
            mintRespondBy={mintRespondBy}
            onMintRespondByChange={setMintRespondBy}
          />
        ) : null}

        {target === 'closed' ? (
          <ClosedFields outcome={outcome} onOutcomeChange={setOutcome} />
        ) : null}

        {leavingOffer ? (
          <KeepOfferRow
            offer={application.offer}
            keepOffer={keepOffer}
            onKeepOfferChange={setKeepOffer}
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
