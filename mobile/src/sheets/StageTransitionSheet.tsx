import { useEffect, useRef, useState } from 'react'
import { TODAY } from '@/lib/today'
import { ScrollView, View } from 'react-native'
import { DateField } from '@/components/common/DateField'
import { Button } from '@/components/ui/Button'
import { FormField, SettingRow, TextField, Toggle } from '@/components/ui/Field'
import { MenuSheet } from '@/components/ui/Menu'
import { Segment } from '@/components/ui/Segment'
import { Sheet } from '@/components/ui/Sheet'
import { STAGE_LABEL, displayName } from '@jojo/service/data/seed'
import type { Application, Outcome, Stage } from '@jojo/service/data/seed'
import { addDays, shortDate } from '@jojo/service/data/timeline'
import { FORMATS, OUTCOMES, OUTCOME_LABEL } from '@jojo/service/core/transition-options'
import type { Format } from '@jojo/service/core/transition-options'
import {
  buildStageItem,
  buildStagePatch,
  stageBlocker,
  stageConsequences,
} from '@jojo/service/core/stage-policy'
import type { StageTransitionDraft } from '@jojo/service/core/stage-policy'
import { stageNeedsDetails } from '@/lib/stage-transition'
import type { TimelineDraft } from '@/lib/store-context'
import { space } from '@/theme/tokens'

/*
 * FORMATS, FORMAT_LABEL, OUTCOME_LABEL, OUTCOMES and OUTCOME_ACTION were all
 * declared here, identically to the web dialog, down to the paragraph
 * explaining why OUTCOMES is derived from OUTCOME_VALUES rather than written
 * out. They live in `core/transition-options` now — the same move that took
 * the stage policy itself — so a label the user reads is written once.
 */

export type StageTransitionSheetProps = {
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
 * One sheet for every stage change in the app, switched on the target.
 *
 * Four separate forms was the obvious shape and the wrong one: each stage needs
 * two or three fields, and four components would be four places for the "moved
 * to X" copy, the move-without-details path and the offer-retention question to
 * drift apart. It also makes the rule enforceable that `offer` can only be
 * populated here — one form writes it, so an offer cannot appear on a record
 * without a respond-by date beside it.
 */
export function StageTransitionSheet({
  open,
  onOpenChange,
  application,
  target,
  onApply,
}: StageTransitionSheetProps) {
  const needs = stageNeedsDetails(application, target)
  const applied = useRef(false)

  /**
   * Backstop for a caller that opened this without checking
   * `stageNeedsDetails`. Without it the user would be looking at an empty sheet
   * and the stage change would be silently swallowed. The ref stops the write
   * repeating if the effect re-runs before the close lands.
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
    <Sheet
      open={open}
      onClose={() => onOpenChange(false)}
      title={`Move to ${STAGE_LABEL[target]}`}
      description={`${displayName(application)} · currently ${STAGE_LABEL[application.stage]}`}
    >
      {/* Keyed on the target so switching destination while open starts a clean
          form rather than carrying the last one's half-typed values. */}
      <TransitionForm
        key={target}
        application={application}
        target={target}
        onApply={onApply}
        onClose={() => onOpenChange(false)}
      />
    </Sheet>
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
  onApply: StageTransitionSheetProps['onApply']
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
  const [outcomeOpen, setOutcomeOpen] = useState(false)

  /** An offer belongs to the round that produced it, so keeping it is a choice. */
  const leavingOffer = Boolean(application.offer) && target !== 'offer'
  const [keepOffer, setKeepOffer] = useState(true)

  /*
   * Every field the form collects, in the shape the shared policy expects.
   *
   * This sheet used to carry its own `buildPatch`, `buildItem` and
   * `consequencesOf` — about 100 lines that were a copy of the web dialog's,
   * comments included, and untested on this side. They had already drifted:
   * the web copy named the two-week floor `RESPOND_BY_FLOOR_DAYS` while this
   * one hardcoded `addDays(TODAY, 14)`, so changing the policy would have
   * fixed one platform and silently left the other alone.
   *
   * The policy is `@jojo/service/core/stage-policy` now, with the web dialog's
   * 19 tests moved alongside it. What stays here is what genuinely belongs to a
   * phone: the state, the sheet, and the fields.
   */
  const draft: StageTransitionDraft = {
    date,
    portalUrl,
    reference,
    format,
    mintInterview,
    respondBy,
    offerComp,
    offerNote,
    mintRespondBy,
    outcome,
    keepOffer,
  }

  /** Empty when the form can be applied; otherwise what is missing. */
  const blocker = stageBlocker(target, draft)

  const apply = () => {
    if (blocker) return
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
    onApply({ stage: target, lastAction: `Moved to ${STAGE_LABEL[target]}` }, undefined, [
      'Nothing else on the record changed.',
    ])
    onClose()
  }

  return (
    <View style={{ gap: space[3.5] }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ maxHeight: 400 }}
        contentContainerStyle={{ gap: space[3.5] }}
      >
        {target === 'submitted' ? (
          <>
            <DateField label="Submitted on" required value={date} onChange={setDate} />
            <TextField
              label="Portal URL"
              mono
              autoCapitalize="none"
              keyboardType="url"
              placeholder="https://"
              value={portalUrl}
              hint="Where the application lives, for when you need to chase it."
              onChangeText={setPortalUrl}
            />
            <TextField
              label="Confirmation reference"
              mono
              autoCapitalize="characters"
              placeholder="e.g. 4471-QZ"
              value={reference}
              onChangeText={setReference}
            />
          </>
        ) : null}

        {target === 'interview' ? (
          <>
            <DateField label="Interview date" required value={date} onChange={setDate} />
            <FormField label="Format">
              <Segment
                label="Interview format"
                options={FORMATS}
                value={format}
                onChange={setFormat}
              />
            </FormField>
            <SettingRow
              label="Add it to the timeline"
              description="Creates an interview entry on that date, with a reminder."
              control={
                <Toggle
                  value={mintInterview}
                  onValueChange={setMintInterview}
                  label="Add it to the timeline"
                />
              }
            />
          </>
        ) : null}

        {target === 'offer' ? (
          <>
            <DateField label="Respond by" required value={respondBy} onChange={setRespondBy} />
            <TextField
              label="Package"
              placeholder="e.g. $112k + $15k startup"
              value={offerComp}
              onChangeText={setOfferComp}
            />
            <TextField
              label="Note"
              multiline
              placeholder="What is still being negotiated"
              value={offerNote}
              onChangeText={setOfferNote}
            />
            <SettingRow
              label="Add the deadline to the timeline"
              description="A respond-by date with nothing watching it is the one deadline you cannot afford to miss."
              control={
                <Toggle
                  value={mintRespondBy}
                  onValueChange={setMintRespondBy}
                  label="Add the deadline to the timeline"
                />
              }
            />
          </>
        ) : null}

        {target === 'closed' ? (
          <FormField label="Outcome" required>
            <Button
              label={OUTCOME_LABEL[outcome]}
              variant="outline"
              size="md"
              full
              onPress={() => setOutcomeOpen(true)}
            />
          </FormField>
        ) : null}

        {leavingOffer ? (
          <SettingRow
            label="Keep the offer details"
            description={`Respond by ${shortDate(application.offer?.respondBy ?? TODAY)}${
              application.offer?.comp ? ` · ${application.offer.comp}` : ''
            }. Turn this off to clear them.`}
            control={
              <Toggle
                value={keepOffer}
                onValueChange={setKeepOffer}
                label="Keep the offer details"
              />
            }
          />
        ) : null}
      </ScrollView>

      {/* Three exits, and none of them lies about what it does. "Skip for now"
          used to sit here and commit the stage change — the word skip in front
          of a write. Cancel now writes nothing, and the middle button says what
          it actually does. */}
      <View style={{ gap: space[2], paddingBottom: space[2] }}>
        <Button
          label={`Move to ${STAGE_LABEL[target]}`}
          size="md"
          full
          blocker={blocker}
          onPress={apply}
        />
        <Button
          label="Move without details"
          variant="outline"
          size="md"
          full
          onPress={moveWithoutDetails}
        />
        <Button label="Cancel" variant="ghost" size="md" full onPress={onClose} />
      </View>

      <MenuSheet
        open={outcomeOpen}
        onClose={() => setOutcomeOpen(false)}
        title="Outcome"
        actions={OUTCOMES.map((o) => ({
          id: o.value,
          label: o.label,
          checked: o.value === outcome,
          onPress: () => setOutcome(o.value),
        }))}
      />
    </View>
  )
}
