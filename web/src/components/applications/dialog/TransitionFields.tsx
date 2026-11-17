import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { FORMATS, OUTCOMES } from '@jojo/service/core/transition-options'
import type { Format } from '@jojo/service/core/transition-options'
import { Field, FormField, SettingRow } from '@/components/common/Field'
import { RichNoteField } from '@/components/common/RichTextEditorField'
import { Segment } from '@/components/common/Segment'
import { Switch } from '@/components/ui/switch'
import type { Application, Outcome } from '@/data/seed'
import { TODAY } from '@/lib/today'
import { useDomain } from '@/i18n/domain'

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
  const { t } = useTranslation('applications')
  return (
    <>
      <Field
        label={t('transition.submittedOn')}
        type="date"
        value={date}
        required
        onChange={(e) => onDateChange(e.target.value)}
      />
      <Field
        label={t('transition.portalUrl')}
        type="url"
        mono
        placeholder="https://"
        value={portalUrl}
        hint={t('transition.portalHint')}
        onChange={(e) => onPortalUrlChange(e.target.value)}
      />
      <Field
        label={t('transition.confirmationRef')}
        mono
        placeholder={t('transition.confirmationPlaceholder')}
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
  const { t } = useTranslation('applications')
  const domain = useDomain()
  return (
    <>
      <Field
        label={t('transition.interviewDate')}
        type="date"
        value={date}
        required
        onChange={(e) => onDateChange(e.target.value)}
      />
      <FormField label={t('transition.format')}>
        <Segment
          label={t('transition.interviewFormat')}
          options={FORMATS.map((o) => ({ value: o.value, label: domain.format(o.value) }))}
          value={format}
          onChange={onFormatChange}
          className="w-fit"
        />
      </FormField>
      <SettingRow
        label={t('transition.addToTimeline')}
        description={t('transition.addToTimelineHint')}
        control={
          <Switch
            checked={mintInterview}
            onCheckedChange={onMintInterviewChange}
            aria-label={t('transition.addToTimeline')}
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
  offerNoteFormat,
  onOfferNoteChange,
  mintRespondBy,
  onMintRespondByChange,
}: {
  respondBy: string
  onRespondByChange: (next: string) => void
  offerComp: string
  onOfferCompChange: (next: string) => void
  offerNote: string
  /** The note's formatting, encoded (`encodeFormat`). Absent opens it plain. */
  offerNoteFormat?: string | undefined
  /** The text, and the formatting encoded — `''` when there is none. */
  onOfferNoteChange: (next: string, format: string) => void
  mintRespondBy: boolean
  onMintRespondByChange: (next: boolean) => void
}) {
  const { t } = useTranslation('applications')
  return (
    <>
      <Field
        label={t('transition.respondBy')}
        type="date"
        value={respondBy}
        required
        onChange={(e) => onRespondByChange(e.target.value)}
      />
      <Field
        label={t('transition.package')}
        placeholder={t('transition.packagePlaceholder')}
        value={offerComp}
        onChange={(e) => onOfferCompChange(e.target.value)}
      />
      {/* The rich text editor, so the offer's note keeps its formatting the
          way the application's own note does (Q268). */}
      <RichNoteField
        label={t('transition.note')}
        placeholder={t('transition.notePlaceholder')}
        text={offerNote}
        format={offerNoteFormat}
        onChange={onOfferNoteChange}
      />
      <SettingRow
        label={t('transition.addDeadline')}
        description={t('transition.addDeadlineHint')}
        control={
          <Switch
            checked={mintRespondBy}
            onCheckedChange={onMintRespondByChange}
            aria-label={t('transition.addDeadline')}
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
  const { t } = useTranslation('applications')
  const domain = useDomain()

  return (
    <FormField label={t('transition.outcome')} htmlFor={outcomeId} required>
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
            {domain.outcome(o.value)}
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
  const { t } = useTranslation('applications')
  const domain = useDomain()
  const date = domain.shortDate(offer?.respondBy ?? TODAY)
  return (
    <SettingRow
      label={t('transition.keepOffer')}
      description={
        offer?.comp
          ? t('transition.keepOfferHintComp', { date, comp: offer.comp })
          : t('transition.keepOfferHint', { date })
      }
      control={
        <Switch
          checked={keepOffer}
          onCheckedChange={onKeepOfferChange}
          aria-label={t('transition.keepOffer')}
        />
      }
    />
  )
}
