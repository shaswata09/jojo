/**
 * Prop schemas for the search itself: applications, the organisations and
 * dates around them, postings, matches, pipelines and their proposals, and the
 * board's sticky notes. Assembled into `NODE_PROP_SCHEMAS` in `validate-props.ts`.
 */

import {
  LABEL_TONE_VALUES,
  MAX_CHECKLIST_ITEMS,
  MAX_CHECKLIST_TEXT,
  MAX_NOTE_SPANS,
  MAX_POSTING_SUMMARY,
  MAX_PROPOSAL_READING,
  MAX_STICKY_TEXT,
  OUTCOME_VALUES,
  PIPELINE_KINDS,
  PROPOSAL_STATUSES,
  SOURCES,
  STAGE_VALUES,
  TIMELINE_KIND_VALUES,
  URGENCY_VALUES,
} from './model'
import { noteSpanShape } from './note-format'
import { stageDatesShape } from './stage-dates'
import { s } from './schema'
import { slug } from './validate-props-slug'

const offerSchema = s.object({
  respondBy: s.isoDate({ label: 'Respond by' }),
  comp: s.optional(s.string({ label: 'Compensation' })),
  note: s.string({ label: 'Note', multiline: true }),
})

export const applicationProps = s.object({
  slug,
  role: s.string({ label: 'Role' }),
  note: s.string({ label: 'Note', multiline: true }),
  // Free text, not an enum. The vocabulary is the profile's `roles`
  // now, so a schema that pinned it to five would refuse the sixth the
  // moment a user added one. `roleVocabulary` is what offers the list.
  roleTag: s.string({ min: 1, label: 'Role type' }),
  stage: s.enum(STAGE_VALUES, { label: 'Stage' }),
  flagged: s.optional(s.boolean({ label: 'Flagged' })),
  lastAction: s.string({ label: 'Last action' }),
  lastActionAt: s.instant({ label: 'Last action at' }),
  source: s.optional(s.enum(SOURCES, { label: 'Source' })),
  postingId: s.optional(s.string({ label: 'Posting ID' })),
  confirmationRef: s.optional(s.string({ label: 'Confirmation reference' })),
  location: s.optional(s.string({ label: 'Location' })),
  comp: s.optional(s.string({ label: 'Compensation' })),
  url: s.optional(s.string({ label: 'Posting link' })),
  appliedOn: s.optional(s.isoDate({ label: 'Applied on' })),
  submittedOn: s.optional(s.isoDate({ label: 'Submitted on' })),
  firstReplyOn: s.optional(s.isoDate({ label: 'First reply on' })),
  /*
   * When each stage was entered. See `core/stage-dates.ts`.
   *
   * The shape is `stageDatesShape`, shared with the tool that writes it, and
   * it has no `submitted` key on purpose: that date is `submittedOn`, two
   * lines up. The module named above is the only thing that has to know.
   *
   * IN `SALVAGEABLE_PROPS`, for the reason `checklist` gives below: a node
   * that fails validation is dropped WHOLE, and a malformed date map in a
   * restored backup must not take the application with it.
   */
  stageDates: s.optional(stageDatesShape),
  /*
   * The formatting over `note`. See `NoteSpan`.
   *
   * Every value here is an integer, `true`, or a member of a closed enum —
   * there is deliberately no hex, no CSS and no URL anywhere in it, so a
   * restored span carrying `colour: 'red;background:url(x)'` fails this
   * schema and never reaches a renderer. That is the whole reason the store
   * holds a tone NAME rather than what the toolbar emits.
   *
   * What this cannot check, and it is a fact about the DSL rather than a
   * choice: `s.object` sees no siblings, so "end is inside the note" and
   * "these do not overlap" are unsayable here. They are canonicalisation
   * rather than validity — `normaliseFormat` establishes them at every write
   * and `runsOf` applies them again at render, so an inconsistent restore
   * reads correctly with less formatting rather than wrongly.
   */
  noteFormat: s.optional(
    s.array(noteSpanShape, { max: MAX_NOTE_SPANS, label: 'Note formatting' }),
  ),
  outcome: s.optional(s.enum(OUTCOME_VALUES, { label: 'Outcome' })),
  offer: s.optional(offerSchema),
  /*
   * What is still to be done. See `ChecklistItem`.
   *
   * Declared exactly rather than passed through, and bounded on both axes for
   * the reason the file's `reading` note gives in `validate-props-vault.ts`: a list longer than
   * `MAX_CHECKLIST_ITEMS` or a line longer than a phrase did not come from
   * this app, and the bound is what stops a prop that arrived from a backup
   * file becoming the 40k of prose D27 exists to keep out of `getAll`.
   *
   * IN `SALVAGEABLE_PROPS`, and that matters more here than it does for a
   * file: a node that fails validation is dropped WHOLE, so a malformed
   * checklist in a restored backup would take the application with it — its
   * stage, its dates, its offer, and every edge to it — to protect the person
   * from a bad to-do list. The trade is not close.
   */
  checklist: s.optional(
    s.array(
      s.object({
        id: s.string({ min: 1, label: 'Item' }),
        text: s.string({ min: 1, max: MAX_CHECKLIST_TEXT, label: 'Step' }),
        doneOn: s.optional(s.isoDate({ label: 'Done on' })),
        by: s.optional(
          s.object({
            model: s.string({ min: 1, label: 'Model' }),
            at: s.instant({ label: 'Drafted at' }),
          }),
        ),
      }),
      { max: MAX_CHECKLIST_ITEMS, label: 'Checklist' },
    ),
  ),
})

export const organisationProps = s.object({ slug, name: s.string({ min: 1, label: 'Name' }) })

export const timelineItemProps = s.object({
  slug,
  title: s.string({ min: 1, label: 'Title' }),
  detail: s.optional(s.string({ label: 'Detail' })),
  note: s.optional(s.string({ label: 'Note', multiline: true })),
  date: s.isoDate({ label: 'Date' }),
  startMins: s.optional(s.number({ min: 0, max: 1439, int: true, label: 'Starts at' })),
  durationMins: s.optional(s.number({ min: 0, int: true, label: 'Lasts' })),
  kind: s.enum(TIMELINE_KIND_VALUES, { label: 'Kind' }),
  urgency: s.enum(URGENCY_VALUES, { label: 'Urgency' }),
  remind: s.boolean({ label: 'Remind me' }),
  completedOn: s.optional(s.isoDate({ label: 'Completed on' })),
  location: s.optional(s.string({ label: 'Location' })),
  joinUrl: s.optional(s.string({ label: 'Join link' })),
})

export const postingProps = s.object({
  slug,
  title: s.string({ min: 1, label: 'Title' }),
  url: s.string({ label: 'Link' }),
  savedOn: s.isoDate({ label: 'Saved on' }),
  size: s.string({ label: 'Size' }),
  summary: s.optional(s.string({ max: MAX_POSTING_SUMMARY, label: 'Summary' })),
  org: s.optional(s.string({ label: 'Employer' })),
  location: s.optional(s.string({ label: 'Location' })),
})

export const stickyNoteProps = s.object({
  slug,
  text: s.string({ min: 1, max: MAX_STICKY_TEXT, label: 'Note', multiline: true }),
  tone: s.enum(LABEL_TONE_VALUES, { label: 'Colour' }),
})

export const matchProps = s.object({
  slug,
  role: s.string({ min: 1, label: 'Role' }),
  detail: s.string({ label: 'Detail' }),
  fit: s.number({ min: 0, max: 100, int: true, label: 'Fit' }),
})

export const pipelineProps = s.object({
  slug,
  name: s.string({ min: 1, label: 'Name' }),
  source: s.string({ label: 'Source' }),
  schedule: s.string({ label: 'Schedule' }),
  filter: s.string({ label: 'Filter' }),
  enabled: s.boolean({ label: 'Enabled' }),
  kind: s.optional(s.enum(PIPELINE_KINDS, { label: 'Pipeline kind' })),
  auto: s.optional(s.boolean({ label: 'Run without asking' })),
  lastRunAt: s.optional(s.instant({ label: 'Last run' })),
  idleRounds: s.optional(s.number({ min: 0, int: true, label: 'Idle rounds' })),
})

/**
 * `input` is `s.string()` and not a parsed shape, on purpose.
 *
 * The reasoning is in `ProposalProps` and it is the same reasoning as
 * `thread.entries` (in `validate-props-self.ts`), arrived at from the other
 * direction: a proposal's
 * payload is the input to SOME tool, so its shape is whatever that tool's
 * schema was. Validating it here would mean this file knowing all 67 of them,
 * and a tool whose schema tightened would silently delete queued proposals on
 * the next boot. It is text until `ctx.call` parses it at the moment of
 * approval, where a mismatch is a sentence on the card rather than a
 * disappearance.
 */
export const proposalProps = s.object({
  slug,
  kind: s.enum(PIPELINE_KINDS, { label: 'Pipeline kind' }),
  tool: s.string({ min: 1, label: 'Tool' }),
  input: s.string({ label: 'Input' }),
  title: s.string({ min: 1, label: 'Title' }),
  rationale: s.string({ label: 'Rationale' }),
  status: s.enum(PROPOSAL_STATUSES, { label: 'Status' }),
  proposedAt: s.instant({ label: 'Proposed at' }),
  decidedAt: s.optional(s.instant({ label: 'Decided at' })),
  error: s.optional(s.string({ label: 'Error' })),
  swept: s.optional(s.boolean({ label: 'Swept' })),
  reading: s.optional(s.string({ max: MAX_PROPOSAL_READING, label: 'Reading' })),
})
