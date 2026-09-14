import { STAGE_VALUES } from './model'
import type { ISODate, Stage, StageDates } from './model'
import { s } from './schema'

/**
 * When an application entered each stage, and the one place that knows where
 * each of those dates is kept.
 *
 * ## Why a module rather than a field
 *
 * Five of the six stages are read and written in `stageDates`. The sixth is
 * not: `submitted` lives in `submittedOn`, which predates stages having dates
 * at all and which the funnel, the response-time chart, `frequency.sentOn`,
 * `recommend.ts` and the seed all read. Moving it would be a migration of five
 * readers and every stored record to gain nothing; copying it into `stageDates`
 * as well would be one fact in two places, and the copy nothing reads is the
 * one that goes stale.
 *
 * So the asymmetry stays, and it stays HERE. Every caller — the four tools that
 * can move a stage, the panel that draws the dates, the form that edits them —
 * asks these functions and never touches either field directly. A caller that
 * reaches for `stageDates.submitted` gets `undefined` and is wrong in a way
 * nothing would report, which is exactly why none of them do.
 *
 * ## Stamped on entry, and never overwritten
 *
 * A move that carries no date of its own fills the stage's date with the day it
 * happened, and only when that stage has no date yet. Dragging a card two
 * columns and back must not rewrite the day it was really submitted — a board
 * is direct manipulation, mis-drops are the commonest slip on that page, and
 * the whole point of these dates is that they are the record of what happened
 * rather than of what was last touched. `appliedOn` has worked this way since
 * before this module existed, for the same reason and in the same words.
 *
 * A date the PERSON gives is different, and `setStageDate` overwrites: typing a
 * date into the panel, or a tool call that names one, is a correction, and a
 * correction that silently did nothing would be the worse failure.
 */

/**
 * The record's date fields, as much of them as any of this needs.
 *
 * Both spelled `| undefined`, because a caller hands in the record AS ITS WRITE
 * LEAVES IT — and "present and undefined" is how this codebase spells a field
 * being cleared (`ApplicationPatch`, `react/patch.ts`). A shape that refused
 * that would send `application.update` back to reading what is on disk, which
 * is the bug the tool's own comment now records.
 */
export type DatedApplication = {
  readonly submittedOn?: ISODate | undefined
  readonly stageDates?: StageDates | undefined
}

/** What a write here changes. Absent keys mean "leave it alone". */
export type StageDatePatch = {
  submittedOn?: ISODate | undefined
  stageDates?: StageDates | undefined
}

/** The date this application entered `stage`, wherever that date is kept. */
export function stageDateOf(a: DatedApplication, stage: Stage): ISODate | undefined {
  return stage === 'submitted' ? a.submittedOn : a.stageDates?.[stage]
}

/**
 * The patch that dates `stage`, overwriting whatever was there.
 *
 * `on: undefined` clears it — which is how the panel spells "I do not know when
 * this happened", and is not the same as never having reached the stage. The
 * whole map is rewritten rather than merged by the caller, because props are
 * stored whole: a patch carrying `{ interview: … }` alone would drop the other
 * four dates, and that is a data loss no type would catch.
 */
export function setStageDate(
  a: DatedApplication,
  stage: Stage,
  on: ISODate | undefined,
): StageDatePatch {
  if (stage === 'submitted') return { submittedOn: on }

  const next: { -readonly [S in Stage]?: ISODate } = { ...a.stageDates }
  if (on === undefined) delete next[stage]
  else next[stage] = on

  /*
   * An empty map is stored as nothing at all. The same argument `checklist`
   * makes: a record that never dated a stage and one whose last date was
   * cleared are the same record, and they have to be the same bytes on disk or
   * a backup taken either side of that would differ.
   */
  return { stageDates: Object.keys(next).length === 0 ? undefined : next }
}

/**
 * The patch for ARRIVING at a stage: fills the date, never replaces one.
 *
 * Returns an empty patch when the stage is already dated, so a caller can spread
 * it into a props patch unconditionally and write nothing when there is nothing
 * to write.
 */
export function enteredStage(a: DatedApplication, stage: Stage, on: ISODate): StageDatePatch {
  return stageDateOf(a, stage) === undefined ? setStageDate(a, stage, on) : {}
}

/**
 * The stages to show for this record, in the order they are lived through.
 *
 * Every stage up to and including the one it is in, plus any stage that carries
 * a date — which is what makes a record that went straight from Draft to Closed
 * show the Closed row it earned, and what lets somebody who moved an
 * application through three stages before this feature existed fill in the two
 * they missed. Never the stages ahead of it: a Draft offering to date its Offer
 * is a form asking about something that has not happened.
 */
export function stagesToDate(a: DatedApplication & { readonly stage: Stage }): Stage[] {
  const reached = STAGE_VALUES.indexOf(a.stage)
  return STAGE_VALUES.filter(
    (s, i) => i <= reached || stageDateOf(a, s) !== undefined,
  )
}

/**
 * The stored shape, spelled once for both the props validator and the tool.
 *
 * `application-fields.ts` says it in its own header: a second copy of a schema
 * is a schema that accepts a value the other one rejects, which reaches a
 * person as a form that saves in one dialog and refuses in the next. The offer
 * shape is written twice and this one will not be.
 *
 * Stage by stage rather than a map of any key to a date, because the keys are a
 * closed set: an open one would accept 'interveiw', store it, read it back with
 * nothing, and lose the date the person typed with no error anywhere.
 *
 * `submitted` is missing on purpose — see the header. It is `submittedOn`.
 */
export const stageDatesShape = s.object({
  draft: s.optional(s.isoDate({ label: 'Drafted on' })),
  screen: s.optional(s.isoDate({ label: 'Screening call on' })),
  interview: s.optional(s.isoDate({ label: 'Interview on' })),
  offer: s.optional(s.isoDate({ label: 'Offer on' })),
  closed: s.optional(s.isoDate({ label: 'Closed on' })),
})
