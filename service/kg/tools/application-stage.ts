/**
 * L3 — moving an application through the pipeline, and how it ends.
 *
 * Two ways to move: `stage.set` writes the stage and nothing else, which is what
 * a drag across the board means, and `stage.advance` writes the stage plus
 * everything the dialog collected with it. The offer tools are here rather than
 * with the form because both of them are stage moves — deciding an offer closes
 * the application, and clearing one is the tidy-up after a move away from it.
 */

import { shortDate } from '../core/dates'
import { OUTCOME_VALUES, STAGE_VALUES, TIMELINE_KIND_VALUES, URGENCY_VALUES } from '../core/model'
import { s } from '../core/schema'
import { appId, cleared, offerShape } from './application-fields'
import { STAGE_LABEL, displayOf, touch } from './support'
import { defineTool } from './tool'

export const applicationStageSet = defineTool({
  name: 'application.stage.set',
  title: 'Move to stage',
  summary: 'Moves the application to another stage, with nothing attached.',
  effect: 'move',
  touches: ['application'],
  input: s.object({ id: appId, stage: s.enum(STAGE_VALUES, { label: 'Stage' }) }),

  run(ctx, input) {
    ctx.require('application', input.id)
    ctx.tx.patch<'application'>(input.id, { stage: input.stage })
    touch(ctx, input.id, `Moved to ${STAGE_LABEL[input.stage]}`)
  },

  describe: (input, _output, m) => ({
    title: `${displayOf(m, input.id)} — ${STAGE_LABEL[input.stage]}`,
    description: 'Nothing else on the record changed.',
  }),
})

/**
 * The stage change with everything the dialog collects attached.
 *
 * Up to five field writes and a minted timeline item, which used to land as two
 * separate store calls in one tick with nothing making them atomic
 * (`apply` in `components/applications/StageTransitionDialog.tsx`). A failure
 * between them left an
 * application at Interview with no interview on the calendar.
 */
export const applicationStageAdvance = defineTool({
  name: 'application.stage.advance',
  title: 'Record a stage change',
  summary: 'Moves the stage and records the dates, outcome or offer that came with it.',
  effect: 'move',
  touches: ['application'],
  input: s.object({
    id: appId,
    stage: s.enum(STAGE_VALUES, { label: 'Stage' }),
    lastAction: s.optional(s.string()),
    appliedOn: s.optional(s.isoDate({ label: 'Applied on' })),
    submittedOn: s.optional(s.isoDate({ label: 'Submitted on' })),
    firstReplyOn: s.optional(s.isoDate({ label: 'First reply' })),
    url: s.optional(s.string({ label: 'Portal link' })),
    outcome: s.optional(s.enum(OUTCOME_VALUES, { label: 'Outcome' })),
    offer: s.optional(offerShape),
    /** True when the user chose not to keep an offer they are moving away from. */
    clearOffer: s.optional(s.boolean()),
    mint: s.optional(
      s.object({
        title: s.string({ min: 1 }),
        detail: s.optional(s.string()),
        date: s.isoDate(),
        kind: s.enum(TIMELINE_KIND_VALUES),
        urgency: s.optional(s.enum(URGENCY_VALUES)),
        location: s.optional(s.string()),
        remind: s.optional(s.boolean()),
      }),
    ),
  }),

  run(ctx, input) {
    const current = ctx.require('application', input.id)

    ctx.tx.patch<'application'>(input.id, {
      stage: input.stage,
      // Only filled where it was empty: the day you first applied is not the day
      // you got round to recording the submission.
      ...(input.appliedOn === undefined || current.props.appliedOn !== undefined
        ? {}
        : { appliedOn: input.appliedOn }),
      ...(input.submittedOn === undefined ? {} : { submittedOn: input.submittedOn }),
      ...(input.firstReplyOn === undefined ? {} : { firstReplyOn: input.firstReplyOn }),
      ...(cleared(input.url) === undefined ? {} : { url: cleared(input.url) }),
      ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
      ...(input.offer === undefined ? {} : { offer: input.offer }),
      ...(input.clearOffer ? { offer: undefined } : {}),
    })

    touch(ctx, input.id, input.lastAction ?? `Moved to ${STAGE_LABEL[input.stage]}`)

    if (input.mint) {
      ctx.call('timeline.item.create', {
        ...input.mint,
        applicationIds: [input.id],
        remind: input.mint.remind ?? true,
      })
    }
  },

  describe: (input, _output, m) => ({
    title: `${displayOf(m, input.id)} — ${STAGE_LABEL[input.stage]}`,
    ...(input.mint
      ? { description: `${input.mint.title} — ${shortDate(input.mint.date)} is on your calendar.` }
      : {}),
  }),
})

/* ---------------------------------- offer --------------------------------- */

const OUTCOME_ACTION: Record<'accepted' | 'declined', string> = {
  accepted: 'Offer accepted',
  declined: 'Offer declined',
}

export const applicationOfferDecide = defineTool({
  name: 'application.offer.decide',
  title: 'Decide on an offer',
  /*
   * The PRECONDITION is in the summary, because the refusal was not enough.
   *
   * This described what the tool does and never that it needs an offer already
   * recorded — so a model asked to accept an offer reached for it, was refused
   * with "This application has no offer recorded", and had learned that only
   * after spending a round trip. It happened in every published run including
   * Gemma's 36/36, and was 5 of the 26 refusals in the latest three-model pass.
   *
   * Naming the other tool matters more than naming the rule: an earlier version
   * of the REFUSAL named this tool's precondition and made things worse — Gemma
   * followed it into a dead end and did nothing, turning a pass into a failure.
   * A description that says what to use instead is the version that works.
   */
  summary:
    'Records an offer already on the application as accepted or declined, and closes it. The application must have an offer recorded first — if it does not, use application.update with an outcome instead.',
  effect: 'update',
  touches: ['application'],
  input: s.object({
    id: appId,
    outcome: s.enum(['accepted', 'declined'] as const, { label: 'Decision' }),
  }),

  available(m, input) {
    const id = input?.id
    if (id === undefined) return { ok: true }
    const app = m.node(id, 'application')
    if (!app?.props.offer) {
      /*
       * Names the move that ACHIEVES what was asked, not the prerequisite of
       * this tool.
       *
       * Two versions of this message have now been measured, and the more
       * helpful-sounding one was worse. It read "Record the offer first with
       * application.update, then decide it" — true about this tool, and it sent
       * Gemma looking for offer details it did not have. It answered "I couldn't
       * record the acceptance because there are no offer details saved" and did
       * nothing, where the terse original had left it to find its own way and it
       * had found the right one.
       *
       * Recording that an offer was ACCEPTED does not need the package or the
       * response date. `outcome` on the application is the whole answer, so
       * that is what this says.
       */
      return {
        ok: false,
        reason:
          'This application has no offer recorded, so there is nothing here to accept or decline. To note how it ended, set `outcome` with application.update — that needs nothing else. Use this tool only once an offer with its terms is on the record.',
      }
    }
    return { ok: true }
  },

  run(ctx, input) {
    ctx.require('application', input.id)
    // The offer details stay. Turning a job down does not un-happen the offer,
    // and the record is the only place the package was ever written down.
    ctx.tx.patch<'application'>(input.id, { stage: 'closed', outcome: input.outcome })
    touch(ctx, input.id, OUTCOME_ACTION[input.outcome])
  },

  describe: (input, _output, m) => ({
    title: OUTCOME_ACTION[input.outcome],
    description: displayOf(m, input.id),
    ...(input.outcome === 'declined' ? { tone: 'danger' as const } : {}),
  }),
})

export const applicationOfferClear = defineTool({
  name: 'application.offer.clear',
  title: 'Clear offer details',
  summary: 'Drops the offer package from an application that has moved on.',
  effect: 'update',
  touches: ['application'],
  input: s.object({ id: appId }),

  run(ctx, input) {
    ctx.require('application', input.id)
    ctx.tx.patch<'application'>(input.id, { offer: undefined })
    touch(ctx, input.id, 'Offer details cleared')
  },

  describe: (input, _output, m) => ({
    title: 'Offer details cleared',
    description: displayOf(m, input.id),
    tone: 'danger',
  }),
})
