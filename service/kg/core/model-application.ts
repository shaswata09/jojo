/**
 * L1 — an application: its stages, outcome, offer, checklist and stored props,
 * and the organisation it is at. Re-exported by `core/model.ts`.
 */

import type { Instant, ISODate } from './model-graph'
import type { NoteSpan } from './model-format'

export const STAGE_VALUES = [
  'draft',
  'submitted',
  'screen',
  'interview',
  'offer',
  'closed',
] as const
export type Stage = (typeof STAGE_VALUES)[number]

/**
 * When the application entered each stage — the journey, not the schedule.
 *
 * One date per stage rather than a log of every move, because that is the
 * question being answered: "when did I submit this, when did they interview
 * me". A log would answer it too, and would then have to say which of three
 * entries for `interview` the panel means, and which one a person is editing
 * when they correct it.
 *
 * `submitted` IS NOT STORED HERE. The submitted date has lived in
 * `submittedOn` since before stages carried dates, and five things read it —
 * the funnel's reach, the response-time chart, `core/sent-on.ts`,
 * `recommend.ts` and the seed. Writing it in two places would be two copies of
 * one fact, and the copy nothing reads is the one that goes stale. Everything
 * that reads or writes a stage date goes through `core/stage-dates.ts`, which
 * is where that hole is filled in — and the only place that has to know.
 */
export type StageDates = { readonly [S in Stage]?: ISODate }

/**
 * 'Rice — ML engineer', or just 'Rice'.
 *
 * Only the employer is required on an application, and a posting promoted from
 * a URL that names no job ('jobs.rice.edu/postings/29411') arrives with the
 * role blank. Interpolating it regardless left a dangling separator on the end
 * of the name — punctuation promising a second half that is not there.
 *
 * IN CORE rather than in `data/seed.ts` where it started: `core/stage-policy.ts`
 * builds record labels with it and core may not read `data/`. `data/seed.ts`
 * re-exports it, so every existing importer is unaffected.
 */
export function displayName(a: Pick<Application, 'org' | 'role'>) {
  return a.role.trim() ? `${a.org} — ${a.role}` : a.org
}

/**
 * What each stage is called. Prose, and free to change; the ID is the wire
 * format — written into '?stage=' links, read back by `useApplicationsParams`,
 * and keying the `--stage-*` tokens. "Screen" became "Screening call" because on
 * its own the word is a verb as often as a noun; the id stayed 'screen' so no
 * saved link broke. Nothing may lay out on a label's length: this one went from
 * 6 to 14 characters.
 *
 * Beside the union rather than in `src/data/seed.ts`, where it used to sit, for
 * two reasons. The `Record<Stage, string>` annotation on an object literal is
 * the only spelling in which adding a stage is a compile error, and that check
 * belongs where the stage is added. And `kg/tools/support.ts` had to re-export
 * it so `kg/react/use-applications.ts` could read a six-word lookup without
 * importing a 348-line demo fixture — a hop that only existed because the model's
 * own prose was filed under demo data. `src/data/seed.ts` re-exports it, so the
 * 52 modules that import it from there did not move.
 *
 * A colour per stage is NOT here. `STAGE_DOT` stays in `src/data/seed.ts`
 * because its values are Tailwind class names, and a CSS class is the one thing
 * this layer must never hand a React Native renderer.
 */

export const STAGE_LABEL: Record<Stage, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  screen: 'Screening call',
  interview: 'Interview',
  offer: 'Offer',
  closed: 'Closed',
}

/** The same four the sources donut splits by, so the two can't drift apart. */
export const SOURCES = ['Job scout', 'Job board', 'Referral', 'Careers page'] as const
export type Source = (typeof SOURCES)[number]

/**
 * The window "applications over time" buckets into.
 *
 * Here rather than in `data/seed.ts`, where it was declared, because
 * `core/frequency.ts` is keyed by it and `core` may not read the fixtures — the
 * same reason every other value union in `core/model.ts` moved down. `data/seed.ts`
 * re-exports it beside `PERIODS`, which is the labelled list a segmented control
 * renders and stays app-facing.
 */
export const PERIOD_VALUES = ['week', 'month', 'quarter'] as const
export type Period = (typeof PERIOD_VALUES)[number]

/** How a closed application ended. Absent while it is still live. */
export const OUTCOME_VALUES = ['rejected', 'withdrawn', 'accepted', 'declined', 'ghosted'] as const
export type Outcome = (typeof OUTCOME_VALUES)[number]

export type Offer = {
  /**
   * 'YYYY-MM-DD'. Was a display string sitting beside a hand-counted
   * `daysLeft`, which meant the countdown was stale the moment the mock's
   * today moved — `offerDaysLeft` derives it now.
   */
  respondBy: string
  comp?: string
  note: string
}

export type Application = {
  id: string
  /**
   * The stable half of the record's identity — what a URL carries.
   *
   * Optional only because the `src/data` fixtures predate it: a fixture's `id`
   * field IS its slug, which is what `repo/seed.ts` compiles it into, so
   * `addressOf` reading `id` for one of those rows is correct rather than
   * degraded. Every record that has been through `projections.ts` carries a real
   * slug, minted once from the employer name by `application.create` and never
   * rewritten — so renaming Stripe to Stripe Payments cannot break a link
   * someone saved.
   */
  slug?: string
  /**
   * Employer and position, split. They were packed into one 'Stripe — ML
   * engineer' string, which reads fine and sorts, groups and searches badly:
   * every consumer that wanted just the employer had to split on an em dash.
   * `displayName` puts them back together for display.
   */
  org: string
  role: string
  note: string
  /** The job role this application is for — the axis the user filters on. */
  roleTag: RoleTag
  stage: Stage
  flagged?: boolean
  /** What last happened, for the activity feed. */
  lastAction: string
  /** Days since lastAction. Derived from `lastActionAt`, never stored. */
  daysAgo: number
  source?: Source
  location?: string
  comp?: string
  url?: string
  postingId?: string
  /** The reference the employer's portal gave on submission. See `ApplicationProps`. */
  confirmationRef?: string
  /** All 'YYYY-MM-DD'. Optional because the mock rows predate them. */
  appliedOn?: string
  submittedOn?: string
  firstReplyOn?: string
  /**
   * When each stage was entered. Passed through from props, unlike `checklist`
   * beside it: six short dates are not the twenty lines of prose that argument
   * is about, and the panel that draws them is opened from a board card whose
   * props these already are.
   */
  stageDates?: StageDates
  outcome?: Outcome
  /** Present only while stage === 'offer'. */
  offer?: Offer
}

/**
 * A patch over an application in which an explicit `undefined` means CLEAR.
 *
 * `Partial<Application>` cannot say that under `exactOptionalPropertyTypes`,
 * which this package compiles with — so `{ offer: undefined }`, the whole
 * mechanism by which leaving the offer stage drops the offer, was a type error
 * behind a looser setting, and `{ submittedOn: undefined }` is how a person
 * empties a date they typed wrongly. `react/patch.ts` is built on exactly this
 * distinction and tests it with `Object.hasOwn`; the signature can now say what
 * those helpers have always done.
 *
 * Every `Partial<Application>` is assignable to this, so widening a parameter
 * to it costs no caller anything.
 */
export type ApplicationPatch = { [K in keyof Application]?: Application[K] | undefined }

/** An application known to carry offer details, so consumers need no `!`. */
export type OfferApplication = Application & { offer: NonNullable<Application['offer']> }

/**
 * Job roles the user tracks. "Academia vs industry" was too blunt — a
 * postdoc and a lecturer are both academia but nothing like each other, and
 * the split told you nothing you could act on.
 */
export const DEFAULT_ROLES = [
  'Assistant Professor',
  'Postdoc',
  'Researcher',
  'ML Engineer',
  'Lecturer',
] as const

/**
 * A role tag is now any string, and the five above are only where a new store
 * starts.
 *
 * They were a closed union, and `roleTag` is REQUIRED on every application and
 * drives the role filter and every per-role figure in Statistics — so the five
 * were not a default, they were the only shapes a job search was allowed to
 * take. Anyone outside academic CS had to file their search under a label that
 * was not true, and because the charts read the field, a wrong tag quietly
 * corrupted the analysis the app is best at.
 *
 * The vocabulary lives on the profile now, beside `matchTerms`, for the reason
 * that list is there: it is a fact about this person's search rather than about
 * the code. `ROLES` stays exported as an alias so nothing that only wanted the
 * seed's five had to change.
 */
export type RoleTag = string
export const ROLES = DEFAULT_ROLES

export type ApplicationProps = {
  slug: string
  role: string
  note: string
  roleTag: RoleTag
  stage: Stage
  flagged?: boolean
  lastAction: string
  /**
   * Replaces `daysAgo`, which was a stored count of days.
   *
   * It was reset to 0 on every edit and has only ever been right because a
   * reload wiped the store; on disk it starts lying on the second launch, and
   * says "1 day ago" about something you did last March.
   */
  lastActionAt: Instant
  source?: Source
  location?: string
  comp?: string
  url?: string
  /** The posting's own reference, when it states one. See `core/duplicates.ts`. */
  postingId?: string
  /**
   * The reference the employer's portal gave back when you submitted —
   * typed into the Submitted step of a stage move. It used to ride in
   * `lastAction`, which the next stage change overwrites, so a reference
   * recorded on Monday was gone by the first interview.
   */
  confirmationRef?: string
  appliedOn?: ISODate
  submittedOn?: ISODate
  firstReplyOn?: ISODate
  /**
   * When each stage was entered. See `StageDates`, and `core/stage-dates.ts`
   * for every rule about it.
   *
   * In props rather than as records of its own, for the reason `checklist`
   * gives below: a date the application reached Interview has no life outside
   * that application, and D15 says a delete unlinks rather than cascades — so
   * as nodes these would outlive the record they describe.
   */
  stageDates?: StageDates
  outcome?: Outcome
  offer?: Offer
  /**
   * What is still to be done before this application is finished.
   *
   * Absent until there is one, and absent again when the last item goes — never
   * `[]`. An application that never had a checklist and one whose items have
   * all been deleted are the same application, and they have to be the same
   * bytes on disk or a backup taken either side of that would differ.
   *
   * Here rather than as records of its own, and the reason is D15. Deleting a
   * record UNLINKS, it never cascades — which is right for a CV that is filed
   * under three jobs and wrong for a step that has no life outside this one.
   * As nodes, deleting the application would strand every item: still
   * validating, still counted in Settings, still in every export, and no longer
   * reachable by anything that could draw or delete them. In props they go with
   * the record they belong to, because they ARE part of it.
   *
   * The cost, stated rather than discovered later: the list is rewritten whole
   * on every tick, so two tabs ticking two items inside one debounce window
   * lose one — the same exposure `note` and `offer` already carry — and an
   * Undo offered on a delete can be refused as superseded once something else
   * on the card has been written since. `project.ts` keeps it out of the
   * projection so twenty items do not ride into sixty card props.
   */
  checklist?: ChecklistItem[]
  /**
   * Formatting over `note`. Absent when the note is plain — never `[]`.
   *
   * The text lives in `note` and ONLY in `note`; this says which stretches of
   * it are bold, coloured or larger. Neither can be computed from the other —
   * spans carry no characters, and nothing in the text says "bold" — so this is
   * not the derived-value-in-props D25 forbids, where a stored copy goes stale
   * against the thing it was copied from. Every character exists exactly once,
   * and the two can never disagree about what the note SAYS.
   *
   * What they CAN disagree about is where the formatting sits, and that is this
   * design's whole liability. It is paid down by there being exactly one place
   * that moves spans when the text changes — `retextFormat`, called inside the
   * two tools that can write `note`, never by a caller — and by `runsOf`
   * clamping at render, so the worst inconsistent restore reads correctly with
   * less formatting rather than wrongly or not at all.
   *
   * The residual, named rather than papered over: `core/schema.ts` passes
   * unknown keys through on purpose, so a BUILD OLDER THAN THIS ONE can rewrite
   * `note` and leave these spans behind, pointing at text that has moved. The
   * only defences are a stored fingerprint of the text — which is the derived
   * value D25 refuses — or a schema version bump, which is heavier than the
   * failure deserves. Clamping means it degrades to formatting in the wrong
   * place, never to a wrong note.
   */
  noteFormat?: NoteSpan[]
}

export type OrganisationProps = {
  slug: string
  name: string
}

/**
 * An employer, with the applications you have made to it.
 *
 * The node has existed since the graph did — every application points `AT` one —
 * and nothing ever showed it. Apply for three roles at one university, which the
 * seeded data itself does, and there was no way to see them together or to
 * notice that two of them share a deadline week and a search chair.
 *
 * DERIVED FROM THE EDGES rather than stored: `applicationIds` is the `AT`
 * relation read backwards, which is the rule `core/model.ts` states at the top —
 * the edge is the storage and a field would be a copy of it.
 */
export type Organisation = {
  id: string
  name: string
  slug: string
  /** Every application at this employer, newest edge last. */
  applicationIds: string[]
}

/* ------------------------------- checklist -------------------------------- */

/**
 * One thing still to do before an application is finished.
 *
 * Drafted by a model off the posting, or typed by the person; the two are the
 * same shape and only `by` tells them apart, because once it is on the list it
 * is theirs either way.
 */
export type ChecklistItem = {
  /**
   * Unique within one application's list, and a BARE uuidv7 — deliberately not
   * a `NodeId`.
   *
   * `parseNodeId` rejects it and `isNodeId` answers false, which is the point:
   * this addresses a row inside one record's props, and an id wearing a type
   * prefix would claim to be a record somebody could `memory.get`.
   */
  readonly id: string
  readonly text: string
  /**
   * The day it was ticked. Absent while it is open.
   *
   * Absent, never `null` and never `undefined` as a present key: a stored
   * `undefined` survives the round trip through IndexedDB as a key that is
   * there (D21), and every read path asks `'doneOn' in item`.
   *
   * A DAY and not an instant, matching `TimelineItemProps.completedOn`: "done"
   * is something a person did on a day, and the extra precision would only
   * ever be shown as that day anyway.
   */
  readonly doneOn?: ISODate
  /** Set when a model drafted this line; absent when the person typed it. */
  readonly by?: { readonly model: string; readonly at: Instant }
}

/**
 * How long one list may get, and how long one line may be.
 *
 * Judgement rather than measurement, unlike `MAX_REQUIREMENTS`. Twenty steps is
 * already more than anybody works through for one job, and the cap is here to
 * stop a model padding rather than to ration the person. The text bound is the
 * same 200 as `MAX_REQUIREMENT_TEXT` on purpose: it is the same kind of thing,
 * an imperative phrase rather than a sentence, and a third number for it would
 * need a third argument.
 */
export const MAX_CHECKLIST_ITEMS = 20
export const MAX_CHECKLIST_TEXT = 200

/** What one drafting run may add. Below the cap, so the person keeps room. */
export const DRAFT_CHECKLIST_ITEMS = 10
