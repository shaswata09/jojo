import { useEffect, useId, useRef, useState } from 'react'
import { STAGE_LABEL } from '@/components/applications/StageMenu'
import { Field, FormField, SettingRow, TextareaField } from '@/components/common/Field'
import { Segment } from '@/components/common/Segment'
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
import { Switch } from '@/components/ui/switch'
import { displayName } from '@/data/seed'
import type { Application, Outcome, Stage } from '@/data/seed'
import { TODAY, addDays, shortDate } from '@/data/timeline'
import type { TimelineDraft } from '@/lib/store-context'

const FORMATS = [
  { value: 'phone', label: 'Phone' },
  { value: 'video', label: 'Video' },
  { value: 'onsite', label: 'Onsite' },
] as const

type Format = (typeof FORMATS)[number]['value']

const FORMAT_LABEL = Object.fromEntries(FORMATS.map((f) => [f.value, f.label])) as Record<
  Format,
  string
>

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
  { value: 'ghosted', label: 'Ghosted — no reply' },
]

const OUTCOME_LABEL = Object.fromEntries(OUTCOMES.map((o) => [o.value, o.label])) as Record<
  Outcome,
  string
>

/** What the activity feed should say afterwards. */
const OUTCOME_ACTION: Record<Outcome, string> = {
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  accepted: 'Offer accepted',
  declined: 'Offer declined',
  ghosted: 'Closed with no reply',
}

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
  const outcomeId = useId()

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

  const buildItem = (): TimelineDraft | undefined => {
    if (target === 'interview' && mintInterview) {
      return {
        title: `${displayName(application)} — ${format} interview`,
        detail: application.roleTag,
        date,
        kind: 'interview',
        urgency: 'amber',
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
        urgency: 'red',
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
          <>
            <Field
              label="Submitted on"
              type="date"
              value={date}
              required
              onChange={(e) => setDate(e.target.value)}
            />
            <Field
              label="Portal URL"
              type="url"
              mono
              placeholder="https://"
              value={portalUrl}
              hint="Where the application lives, for when you need to chase it."
              onChange={(e) => setPortalUrl(e.target.value)}
            />
            <Field
              label="Confirmation reference"
              mono
              placeholder="e.g. 4471-QZ"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </>
        ) : null}

        {target === 'interview' ? (
          <>
            <Field
              label="Interview date"
              type="date"
              value={date}
              required
              onChange={(e) => setDate(e.target.value)}
            />
            <FormField label="Format">
              <Segment
                label="Interview format"
                options={FORMATS}
                value={format}
                onChange={setFormat}
                className="w-fit"
              />
            </FormField>
            <SettingRow
              label="Add it to the timeline"
              description="Creates an interview entry on that date, with a reminder."
              control={
                <Switch
                  checked={mintInterview}
                  onCheckedChange={setMintInterview}
                  aria-label="Add it to the timeline"
                />
              }
            />
          </>
        ) : null}

        {target === 'offer' ? (
          <>
            <Field
              label="Respond by"
              type="date"
              value={respondBy}
              required
              onChange={(e) => setRespondBy(e.target.value)}
            />
            <Field
              label="Package"
              placeholder="e.g. $112k + $15k startup"
              value={offerComp}
              onChange={(e) => setOfferComp(e.target.value)}
            />
            <TextareaField
              label="Note"
              rows={3}
              placeholder="What is still being negotiated"
              value={offerNote}
              onChange={(e) => setOfferNote(e.target.value)}
            />
            <SettingRow
              label="Add the deadline to the timeline"
              description="A respond-by date with nothing watching it is the one deadline you cannot afford to miss."
              control={
                <Switch
                  checked={mintRespondBy}
                  onCheckedChange={setMintRespondBy}
                  aria-label="Add the deadline to the timeline"
                />
              }
            />
          </>
        ) : null}

        {target === 'closed' ? (
          <FormField label="Outcome" htmlFor={outcomeId} required>
            {/* A native select: five options is past what a segmented control
                can hold without wrapping, and this one is keyboard-complete
                and screen-reader-complete for free. */}
            <select
              id={outcomeId}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as Outcome)}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-text-1 outline-none focus-visible:border-ring"
            >
              {OUTCOMES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
        ) : null}

        {leavingOffer ? (
          <SettingRow
            label="Keep the offer details"
            description={`Respond by ${shortDate(application.offer?.respondBy ?? TODAY)}${
              application.offer?.comp ? ` · ${application.offer.comp}` : ''
            }. Turn this off to clear them.`}
            control={
              <Switch
                checked={keepOffer}
                onCheckedChange={setKeepOffer}
                aria-label="Keep the offer details"
              />
            }
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
