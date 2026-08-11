import { useId } from 'react'
import { FORMATS, OUTCOMES } from '@/components/applications/dialog/transition-options'
import type { Format } from '@/components/applications/dialog/transition-options'
import { Field, FormField, SettingRow, TextareaField } from '@/components/common/Field'
import { Segment } from '@/components/common/Segment'
import { Switch } from '@/components/ui/switch'
import type { Application, Outcome } from '@/data/seed'
import { shortDate } from '@/data/timeline'
import { TODAY } from '@/lib/today'

/**
 * The field block each destination carries, one component per stage.
 *
 * Draft and Screen have none — see `stageNeedsDetails`, which is what keeps the
 * dialog from opening on a move with nothing to ask about.
 */
export function SubmittedFields({
  date,
  onDateChange,
  portalUrl,
  onPortalUrlChange,
  reference,
  onReferenceChange,
}: {
  date: string
  onDateChange: (next: string) => void
  portalUrl: string
  onPortalUrlChange: (next: string) => void
  reference: string
  onReferenceChange: (next: string) => void
}) {
  return (
    <>
      <Field
        label="Submitted on"
        type="date"
        value={date}
        required
        onChange={(e) => onDateChange(e.target.value)}
      />
      <Field
        label="Portal URL"
        type="url"
        mono
        placeholder="https://"
        value={portalUrl}
        hint="Where the application lives, for when you need to chase it."
        onChange={(e) => onPortalUrlChange(e.target.value)}
      />
      <Field
        label="Confirmation reference"
        mono
        placeholder="e.g. 4471-QZ"
        value={reference}
        onChange={(e) => onReferenceChange(e.target.value)}
      />
    </>
  )
}

export function InterviewFields({
  date,
  onDateChange,
  format,
  onFormatChange,
  mintInterview,
  onMintInterviewChange,
}: {
  date: string
  onDateChange: (next: string) => void
  format: Format
  onFormatChange: (next: Format) => void
  mintInterview: boolean
  onMintInterviewChange: (next: boolean) => void
}) {
  return (
    <>
      <Field
        label="Interview date"
        type="date"
        value={date}
        required
        onChange={(e) => onDateChange(e.target.value)}
      />
      <FormField label="Format">
        <Segment
          label="Interview format"
          options={FORMATS}
          value={format}
          onChange={onFormatChange}
          className="w-fit"
        />
      </FormField>
      <SettingRow
        label="Add it to the timeline"
        description="Creates an interview entry on that date, with a reminder."
        control={
          <Switch
            checked={mintInterview}
            onCheckedChange={onMintInterviewChange}
            aria-label="Add it to the timeline"
          />
        }
      />
    </>
  )
}

export function OfferFields({
  respondBy,
  onRespondByChange,
  offerComp,
  onOfferCompChange,
  offerNote,
  onOfferNoteChange,
  mintRespondBy,
  onMintRespondByChange,
}: {
  respondBy: string
  onRespondByChange: (next: string) => void
  offerComp: string
  onOfferCompChange: (next: string) => void
  offerNote: string
  onOfferNoteChange: (next: string) => void
  mintRespondBy: boolean
  onMintRespondByChange: (next: boolean) => void
}) {
  return (
    <>
      <Field
        label="Respond by"
        type="date"
        value={respondBy}
        required
        onChange={(e) => onRespondByChange(e.target.value)}
      />
      <Field
        label="Package"
        placeholder="e.g. $112k + $15k startup"
        value={offerComp}
        onChange={(e) => onOfferCompChange(e.target.value)}
      />
      <TextareaField
        label="Note"
        rows={3}
        placeholder="What is still being negotiated"
        value={offerNote}
        onChange={(e) => onOfferNoteChange(e.target.value)}
      />
      <SettingRow
        label="Add the deadline to the timeline"
        description="A respond-by date with nothing watching it is the one deadline you cannot afford to miss."
        control={
          <Switch
            checked={mintRespondBy}
            onCheckedChange={onMintRespondByChange}
            aria-label="Add the deadline to the timeline"
          />
        }
      />
    </>
  )
}

export function ClosedFields({
  outcome,
  onOutcomeChange,
}: {
  outcome: Outcome
  onOutcomeChange: (next: Outcome) => void
}) {
  const outcomeId = useId()

  return (
    <FormField label="Outcome" htmlFor={outcomeId} required>
      {/* A native select: five options is past what a segmented control
          can hold without wrapping, and this one is keyboard-complete
          and screen-reader-complete for free. */}
      <select
        id={outcomeId}
        value={outcome}
        onChange={(e) => onOutcomeChange(e.target.value as Outcome)}
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-text-1 outline-none focus-visible:border-ring"
      >
        {OUTCOMES.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FormField>
  )
}

/** Shown on every move off an offer, whatever the destination is. */
export function KeepOfferRow({
  offer,
  keepOffer,
  onKeepOfferChange,
}: {
  offer: Application['offer']
  keepOffer: boolean
  onKeepOfferChange: (next: boolean) => void
}) {
  return (
    <SettingRow
      label="Keep the offer details"
      description={`Respond by ${shortDate(offer?.respondBy ?? TODAY)}${
        offer?.comp ? ` · ${offer.comp}` : ''
      }. Turn this off to clear them.`}
      control={
        <Switch
          checked={keepOffer}
          onCheckedChange={onKeepOfferChange}
          aria-label="Keep the offer details"
        />
      }
    />
  )
}
