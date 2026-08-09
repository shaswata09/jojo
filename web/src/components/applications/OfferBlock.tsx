import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { displayName, offerDaysLeft, respondByLabel } from '@/data/seed'
import type { OfferApplication, Outcome } from '@/data/seed'
import { cn } from '@/lib/utils'

/** Which outcomes this block can produce. Both close the application. */
export type OfferDecision = 'accepted' | 'declined'

/**
 * How long is left, in words, plus how alarmed to look about it.
 *
 * Counted from the pinned TODAY rather than the wall clock — every other
 * relative label in the app is, and a countdown that disagreed with the
 * deadline on the timeline beside it would be the one nobody trusts.
 *
 * Two rules from the app's colour and date law meet here, and this block used
 * to break both. Red belongs to a date that has already gone; amber to one
 * inside 48 hours; a deadline five weeks out is neither, and it certainly is
 * not green — a countdown rendered in the success colour reads as "you are
 * fine" right up to the day it turns red. And the words are the app's one
 * relative vocabulary, so "Expired 3 days ago" and "24 days left" are out:
 * every surface in jojo says overdue / Today / Tomorrow / in N days.
 */
function countdown(daysLeft: number): { text: string; tone: string } {
  if (daysLeft < 0) {
    const late = -daysLeft
    return { text: `${late} day${late === 1 ? '' : 's'} overdue`, tone: 'text-danger' }
  }
  if (daysLeft === 0) return { text: 'Today', tone: 'text-warning' }
  if (daysLeft === 1) return { text: 'Tomorrow', tone: 'text-warning' }
  return { text: `in ${daysLeft} days`, tone: 'text-text-1' }
}

/**
 * How a settled offer names itself, once the countdown stops mattering.
 *
 * All five outcomes, not just the two this block can produce: a record can also
 * reach `closed` through the stage dialog, and the offer details survive that.
 * Rendering only the two would have left an offer that was later withdrawn
 * showing a live countdown and two decision buttons over a closed application.
 */
const SETTLED: Record<Outcome, { label: string; tone: string }> = {
  accepted: { label: 'Accepted', tone: 'text-success' },
  declined: { label: 'Declined', tone: 'text-text-2' },
  rejected: { label: 'Rejected', tone: 'text-text-2' },
  withdrawn: { label: 'Withdrawn', tone: 'text-text-2' },
  ghosted: { label: 'Closed with no reply', tone: 'text-text-2' },
}

/**
 * The offer, and the two ways out of it.
 *
 * Accept and Decline both write an outcome and close the application, which is
 * a one-click end to the record the user worked hardest on — so both go through
 * a ConfirmDialog naming what happens. The caller pairs that with an Undo in
 * the toast: the dialog catches the mis-click, the undo catches the change of
 * mind, and the file used to argue that shipping both trains people to dismiss
 * the dialog. It is the same pairing the delete on this page already ships, and
 * the alternative is the app's one unreversible write.
 *
 * `settled` keeps the block on screen after that decision. Both confirmations
 * promise "the offer details are kept", and this used to unmount the moment the
 * stage went to closed — so the package and the respond-by date the user typed
 * were still in the store and nowhere on the page, which made the promise
 * unverifiable. Settled drops the countdown (a deadline you have answered is
 * not perishable) and the two buttons, and states the outcome instead.
 */
export function OfferBlock({
  application,
  onDecide,
  settled,
}: {
  application: OfferApplication
  onDecide: (decision: OfferDecision) => void
  /** The recorded outcome, once there is one. Its presence retires the buttons. */
  settled?: Outcome
}) {
  const [pending, setPending] = useState<OfferDecision | null>(null)
  const { offer } = application
  const left = countdown(offerDaysLeft(offer))

  // Deliberately no accent border: `.surface` sets the border from the same
  // utilities layer, so a `border-*` class here would win or lose by source
  // order rather than by intent.
  return (
    <Panel className="min-w-0">
      {/* No date in the hint: the line underneath already carries it, and the
          panel used to print "Nov 15" twice within 40px. */}
      <PanelTitle>Offer</PanelTitle>

      {settled ? (
        <p className={cn('text-sm font-medium', SETTLED[settled].tone)}>
          {SETTLED[settled].label}
          <span className="ml-2 font-normal text-text-3">· respond by {respondByLabel(offer)}</span>
        </p>
      ) : (
        <p className={cn('text-sm font-medium', left.tone)}>
          {left.text}
          <span className="ml-2 font-normal text-text-3">· respond by {respondByLabel(offer)}</span>
        </p>
      )}

      {offer.comp ? (
        <p className="mt-2.5 text-sm text-text-1">{offer.comp}</p>
      ) : (
        <p className="mt-2.5 text-sm text-text-3">No package recorded</p>
      )}

      {offer.note ? <p className="mt-1.5 text-xs text-text-2">{offer.note}</p> : null}

      {/* Retired once a decision is recorded — the doc comment above has always
          said settled drops the buttons, and until now it did not, so a closed
          application still offered to close itself again. */}
      {settled ? null : (
        <div className="mt-3.5 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setPending('accepted')}>
            <Check className="size-3.5" strokeWidth={2} aria-hidden />
            Accept offer
          </Button>
          {/* Outline, not destructive: turning a job down is a decision about
              your own career, and the red-tinted button that used to sit here
              spelled it as the same kind of act as deleting the record. */}
          <Button variant="outline" size="sm" onClick={() => setPending('declined')}>
            <X className="size-3.5" strokeWidth={2} aria-hidden />
            Decline offer
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title={pending === 'accepted' ? 'Accept this offer?' : 'Decline this offer?'}
        description={
          pending === 'accepted'
            ? `${displayName(application)} moves to closed, with the outcome recorded as accepted. The offer details and every reminder on it are kept.`
            : `${displayName(application)} moves to closed, with the outcome recorded as declined. Nothing is deleted — the offer details and its reminders stay where they are.`
        }
        confirmLabel={pending === 'accepted' ? 'Accept offer' : 'Decline offer'}
        onConfirm={() => {
          if (pending) onDecide(pending)
        }}
      />
    </Panel>
  )
}
