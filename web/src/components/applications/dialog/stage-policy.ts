/**
 * What a stage change writes — the whole policy, with no React in it.
 *
 * Every one of these rules used to be a closure inside `TransitionForm` in
 * `StageTransitionDialog.tsx`: which destinations even need a dialog, which
 * fields each one writes, the `appliedOn ?? date` rule, every `lastAction`
 * string, what timeline row the move mints, and the sentences the toast says
 * afterwards. Being closures over `useState` values, none of it could be
 * exercised without mounting a dialog, and none of it could be read without
 * scrolling past the JSX that renders the form.
 *
 * The concrete task this unblocks, in order:
 *
 * 1. `stage-policy.test.ts` — the rules now have a test file, which they could
 *    not have had before. `appliedOn ?? date` in particular is a rule stated in
 *    two places (here and in the `application.stage.advance` tool) and nothing
 *    asserted the two agreed.
 * 2. Calling `application.stage.advance`. The tool has been built, tested and
 *    documented since the graph layer landed and has zero callers outside
 *    `src/kg` — the UI still writes the patch and mints the item as two
 *    separate store calls with a hand-rolled undo, which is exactly the
 *    non-atomicity the tool's own header says it exists to fix. `buildStagePatch`
 *    returns the tool's input keys verbatim (`stage`, `appliedOn`,
 *    `submittedOn`, `url`, `outcome`, `offer`, `lastAction`) and `buildStageItem`
 *    returns its `mint`, so the wiring is now a call rather than a rewrite. The
 *    one difference to reconcile: the tool spells "drop the offer" as
 *    `clearOffer: true`, and a `Partial<Application>` can only spell it as
 *    `offer: undefined`.
 *
 * WHERE THIS SHOULD END UP: `kg/tools/application-stage.ts`, as the policy the
 * tool consumes. It is platform-free today — no DOM, no React, no clock read of
 * its own — apart from importing `TimelineDraft` from `kg/react`, which is a
 * type. Nothing here is web-specific; a phone asks the same questions.
 */

import {
  FORMAT_LABEL,
  OUTCOME_ACTION,
  OUTCOME_LABEL,
} from '@/components/applications/dialog/transition-options'
import type { Format } from '@/components/applications/dialog/transition-options'
import { STAGE_LABEL, displayName } from '@/data/seed'
import type { Application, Outcome, Stage } from '@/data/seed'
import { addDays, shortDate } from '@/data/timeline'
import type { TimelineDraft } from '@/kg/react/use-timeline'

/** The four stages that carry a field block. Draft and Screen collect nothing. */
const BLOCKED_STAGES: readonly Stage[] = ['submitted', 'interview', 'offer', 'closed']

/**
 * Two weeks is the shortest deadline anyone actually gets, so it is a floor the
 * user edits down rather than a date they have to invent.
 */
export const RESPOND_BY_FLOOR_DAYS = 14

/** Everything the transition form collects, in one bag. */
export type StageTransitionDraft = {
  /** The submitted-on / interview date. Both stages reuse the one field. */
  date: string
  portalUrl: string
  reference: string
  format: Format
  mintInterview: boolean
  respondBy: string
  offerComp: string
  offerNote: string
  mintRespondBy: boolean
  outcome: Outcome
  /** Only consulted when `leavingOffer` is true. */
  keepOffer: boolean
}

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

/** An offer belongs to the round that produced it, so keeping it is a choice. */
export const leavingOffer = (application: Application, target: Stage) =>
  Boolean(application.offer) && target !== 'offer'

/** Where the form's fields start, before the user touches anything. */
export function initialStageDraft(application: Application, today: string): StageTransitionDraft {
  return {
    date: today,
    portalUrl: application.url ?? '',
    reference: '',
    format: 'video',
    mintInterview: true,
    respondBy: application.offer?.respondBy ?? addDays(today, RESPOND_BY_FLOOR_DAYS),
    offerComp: application.offer?.comp ?? application.comp ?? '',
    offerNote: application.offer?.note ?? '',
    mintRespondBy: true,
    outcome: application.stage === 'offer' ? 'declined' : 'rejected',
    keepOffer: true,
  }
}

/** Empty when the form can be applied; otherwise what is missing. */
export function stageBlocker(target: Stage, draft: StageTransitionDraft): string | undefined {
  if ((target === 'submitted' || target === 'interview') && !draft.date) return 'Add the date first'
  if (target === 'offer' && !draft.respondBy) return 'Add a respond-by date first'
  return undefined
}

export function buildStagePatch(
  application: Application,
  target: Stage,
  draft: StageTransitionDraft,
): Partial<Application> {
  const patch: Partial<Application> = { stage: target }
  if (leavingOffer(application, target) && !draft.keepOffer) patch.offer = undefined

  switch (target) {
    case 'submitted':
      patch.submittedOn = draft.date
      // Only filled where it was empty: the day you first applied is not the
      // day you got round to recording the submission.
      patch.appliedOn = application.appliedOn ?? draft.date
      if (draft.portalUrl.trim()) patch.url = draft.portalUrl.trim()
      // Application has no field for a confirmation reference, so it rides in
      // `lastAction` where the activity feed shows it. Worth knowing: the next
      // stage change overwrites that line, so the reference is not permanent
      // until the record grows a home for it.
      patch.lastAction = draft.reference.trim()
        ? `Submitted · ref ${draft.reference.trim()}`
        : 'Application submitted'
      break

    case 'interview':
      patch.lastAction = `${FORMAT_LABEL[draft.format]} interview scheduled`
      break

    case 'offer':
      patch.offer = {
        respondBy: draft.respondBy,
        comp: draft.offerComp.trim() || undefined,
        note: draft.offerNote.trim(),
      }
      patch.lastAction = 'Offer received'
      break

    case 'closed':
      patch.outcome = draft.outcome
      patch.lastAction = OUTCOME_ACTION[draft.outcome]
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
export function buildStageItem(
  application: Application,
  target: Stage,
  draft: StageTransitionDraft,
): TimelineDraft | undefined {
  if (target === 'interview' && draft.mintInterview) {
    return {
      title: `${displayName(application)} — ${draft.format} interview`,
      detail: application.roleTag,
      date: draft.date,
      kind: 'interview',
      applicationId: application.id,
      remind: true,
      location: draft.format === 'onsite' ? application.location : undefined,
    }
  }
  if (target === 'offer' && draft.mintRespondBy) {
    return {
      title: `${displayName(application)} — respond to offer`,
      detail: 'Decision deadline',
      date: draft.respondBy,
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
export function stageConsequences(
  application: Application,
  target: Stage,
  draft: StageTransitionDraft,
  item: TimelineDraft | undefined,
): string[] {
  const lines: string[] = []

  if (target === 'submitted' && draft.reference.trim()) {
    lines.push(`Reference ${draft.reference.trim()} saved to the activity line.`)
  }
  if (target === 'offer') lines.push(`Respond by ${shortDate(draft.respondBy)} recorded.`)
  if (target === 'closed') {
    lines.push(`Recorded as ${OUTCOME_LABEL[draft.outcome].toLowerCase()}.`)
  }
  if (item) {
    lines.push(
      item.kind === 'deadline'
        ? `Respond by ${shortDate(item.date)} added to your calendar.`
        : `${FORMAT_LABEL[draft.format]} interview on ${shortDate(item.date)} added to your calendar.`,
    )
  }
  if (leavingOffer(application, target) && !draft.keepOffer) lines.push('Offer details cleared.')

  return lines
}

/**
 * The stage change with nothing attached — including the offer, kept as-is.
 *
 * Three callers: "Move without details" in the dialog footer, the backstop for
 * a caller that opened the dialog on a target that asks nothing, and the stage
 * menu on the detail page. All three wrote the same object literal.
 */
export const plainStageMove = (target: Stage): Partial<Application> => ({
  stage: target,
  lastAction: `Moved to ${STAGE_LABEL[target]}`,
})
