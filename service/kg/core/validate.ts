/**
 * L1 — unknown -> StoredNode | Diagnostic[]. THE single trust boundary cast.
 *
 * Everything read off disk passes through here exactly once. A rejection is never
 * dropped silently: it is logged with the offending record id, counted in
 * Settings' Diagnostics, and the corrupt path offers to export what could be read
 * before anything else. Local-first means a silently skipped node is lost work
 * with no server backup and no undo.
 *
 * THE TWO CASTS, AND WHAT IS ACTUALLY UNIQUE ABOUT THEM
 *
 * `as StoredNode` reads as if it should appear nowhere else, and it does appear
 * elsewhere — this comment used to say otherwise and a grep refutes it in one
 * line, which is worse than saying nothing. `snapshot.ts` and
 * `tools/runtime-overlay.ts` re-assert a type PARAMETER the compiler cannot
 * carry through a container it fetched by key; `repo/seed.ts` and
 * `tools/runtime-tx.ts` assemble a record out of values that are already typed.
 * None of those turns an unchecked value into a record.
 *
 * The two in this file are the only casts that turn an unchecked value into a
 * DOMAIN RECORD. Every field above them has been read and checked one at a
 * time. A third of that kind anywhere else means some other module has decided
 * it knows what is on disk, and the guarantee that a malformed record can only
 * enter through a counted diagnostic is gone.
 *
 * Stated that way rather than as "the only casts whose input is `unknown`",
 * which is what this said a revision ago and is false: `journal.ts`,
 * `channel.ts`, `meta.ts`, `idb-events.ts`, `react/undo.ts` and `tools/memory.ts`
 * all widen an `unknown` to `Record<string, unknown>` in order to LOOK at it.
 * Widening a value to inspect it and asserting it is a `StoredNode` are opposite
 * acts, and the paragraph above already had to be rewritten once for making an
 * absolute claim a single grep refuted. Twice is a pattern worth naming.
 */

import type { NodePropsByType, NodeType, Rel, StoredEdge, StoredNode, ThreadEntry } from './model'
import {
  APPROVAL_MODES,
  BACKGROUND_KINDS,
  EDGE_SCHEMA,
  edgeIsWellTyped,
  FILE_BUCKET_VALUES,
  FILE_KIND_VALUES,
  LABEL_TONE_VALUES,
  LINK_CATEGORY_VALUES,
  MAX_CHECKLIST_ITEMS,
  MAX_CHECKLIST_TEXT,
  MAX_NOTE_SPANS,
  MAX_REQUIREMENT_TEXT,
  MAX_REQUIREMENTS,
  NODE_TYPES,
  OUTCOME_VALUES,
  PIPELINE_KINDS,
  PROFILE_DOCUMENTS,
  PROPOSAL_STATUSES,
  RELS,
  SNIPPET_TAG_VALUES,
  SOURCES,
  STAGE_VALUES,
  TIMELINE_KIND_VALUES,
  URGENCY_VALUES,
} from './model'
import { edgeId, parseNodeId, typeOfId } from './ref'
import { noteSpanShape } from './note-format'
import { stageDatesShape } from './stage-dates'
import type { Schema } from './schema'
import { formatIssues, s } from './schema'

/* ------------------------------- diagnostics ------------------------------ */

/**
 * What was skipped and why, in the user's words where possible.
 *
 * `id` is the record's own id when it could be read and null when the row was
 * too broken to have one — a row with no id is the case that most needs saying
 * out loud, because it is invisible everywhere else.
 */
export type Diagnostic = {
  store: 'nodes' | 'edges'
  id: string | null
  message: string
}

const diagnostic = (
  store: Diagnostic['store'],
  id: string | null,
  message: string,
): Diagnostic => ({
  store,
  id,
  message,
})

export type Validated<T> = { ok: true; value: T } | { ok: false; diagnostics: Diagnostic[] }

/* ------------------------------ props schemas ----------------------------- */

/**
 * An array of turns, checked as an array and not as turns.
 *
 * The cast is the honest expression of the loose check above it: what comes back
 * is `unknown[]`, and calling it `ThreadEntry[]` here is the same trust boundary
 * this file already crosses for `props` itself a hundred lines down. It is
 * declared once, next to its reason, rather than inlined where it would read as
 * an oversight.
 */
const threadEntries = s.array(s.unknown(), { label: 'Messages' }) as unknown as Schema<
  ThreadEntry[]
>

const offerSchema = s.object({
  respondBy: s.isoDate({ label: 'Respond by' }),
  comp: s.optional(s.string({ label: 'Compensation' })),
  note: s.string({ label: 'Note', multiline: true }),
})

const profileTextSchema = s.object({
  fullName: s.string({ label: 'Full name' }),
  position: s.string({ label: 'Position' }),
  location: s.string({ label: 'Location' }),
  email: s.string({ label: 'Email' }),
  website: s.string({ label: 'Website' }),
  scholar: s.string({ label: 'Scholar' }),
  github: s.string({ label: 'GitHub' }),
  linkedin: s.string({ label: 'LinkedIn' }),
  targetRoles: s.string({ label: 'Target roles' }),
  regions: s.string({ label: 'Regions' }),
})

/**
 * One schema per node type, and the palette generates its form from these.
 *
 * `slug` is `min: 1` everywhere it appears: a blank slug passes a `typeof`
 * check, then collides with every other blank one in the `[type, slug]` index,
 * so the second record to arrive silently replaces the first.
 */
const slug = s.string({ min: 1, label: 'Slug' })

export const NODE_PROP_SCHEMAS = {
  application: s.object({
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
     * the reason the `reading` note gives one type up: a list longer than
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
  }),
  organisation: s.object({ slug, name: s.string({ min: 1, label: 'Name' }) }),
  timelineItem: s.object({
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
  }),
  keyword: s.object({
    slug,
    name: s.string({ min: 1, label: 'Name' }),
    tone: s.enum(LABEL_TONE_VALUES, { label: 'Colour' }),
  }),
  link: s.object({
    slug,
    title: s.string({ min: 1, label: 'Title' }),
    url: s.string({ min: 1, label: 'Link' }),
    category: s.enum(LINK_CATEGORY_VALUES, { label: 'Category' }),
    note: s.optional(s.string({ label: 'Note', multiline: true })),
    savedOn: s.isoDate({ label: 'Saved on' }),
  }),
  file: s.object({
    slug,
    name: s.string({ min: 1, label: 'Name' }),
    kind: s.enum(FILE_KIND_VALUES, { label: 'Kind' }),
    bucket: s.enum(FILE_BUCKET_VALUES, { label: 'Bucket' }),
    size: s.string({ label: 'Size' }),
    savedOn: s.isoDate({ label: 'Saved on' }),
    note: s.optional(s.string({ label: 'Note', multiline: true })),
    // Declared rather than left to unknown-key passthrough, so a wrong value is
    // caught at the trust boundary instead of reaching `sizeLabel`. The cost is
    // that a bad value fails the whole node — which is why the restore path,
    // and only the restore path, passes `salvage` to strip these five and keep
    // the record. See `SALVAGEABLE_FILE_PROPS`.
    path: s.optional(s.string({ label: 'File path' })),
    bytes: s.optional(s.number({ min: 0, label: 'Bytes' })),
    mtime: s.optional(s.number({ min: 0, label: 'Modified' })),
    hash: s.optional(s.string({ label: 'Hash' })),
    // `uri` is the fifth, and it is the only one of them either app has ever
    // written. It came across from the phone's fork undeclared, so `s.object`'s
    // unknown-key passthrough carried it — which is the same door a `uri: 99`
    // came through, straight into `openDocument()`. Declaring it closes that
    // without changing what a well-formed record does.
    uri: s.optional(s.string({ label: 'Location' })),
    // A capture's two fields. `sourceUrl` is declared rather than left to
    // passthrough for the same reason `uri` was: it reaches an `href` in both
    // apps, and a stored `javascript:` that arrived as an unknown key would get
    // there intact. The scheme itself is checked by `isCaptureSource` at the
    // point of rendering — a string is all the trust boundary can promise, and
    // failing the whole node over a bad scheme would lose the capture's bytes
    // along with its address.
    sourceUrl: s.optional(s.string({ label: 'Captured from' })),
    capturedAt: s.optional(s.instant({ label: 'Captured' })),
    /*
     * What a model read off this posting. See `PostingReading`.
     *
     * Declared exactly, not passed through, and bounded on both axes: a list
     * longer than `MAX_REQUIREMENTS` or a phrase longer than a sentence did not
     * come from the reader, and the bound is what keeps a prop that arrived
     * from a backup file from becoming the 40k of prose D27 exists to keep out
     * of `getAll('nodes')`.
     *
     * IN `SALVAGEABLE_FILE_PROPS`, for the reason the list itself gives: a node
     * that fails validation is dropped WHOLE, taking its name, its note and
     * every edge incident to it — so a malformed reading in a restored backup
     * would cost the person the document record and its filing under a job, to
     * protect them from a stale requirement list. Stripping it costs one model
     * call. The first draft of this comment argued the opposite and was wrong
     * about which side of the trade the user is on.
     */
    reading: s.optional(
      s.object({
        requirements: s.array(
          s.object({
            text: s.string({ min: 1, max: MAX_REQUIREMENT_TEXT, label: 'Requirement' }),
            essential: s.boolean({ label: 'Required' }),
          }),
          { max: MAX_REQUIREMENTS, label: 'What it asks for' },
        ),
        model: s.string({ label: 'Read by' }),
        readAt: s.instant({ label: 'Read' }),
        skipped: s.optional(s.number({ min: 0, int: true, label: 'Lines skipped' })),
        clearedAt: s.optional(s.instant({ label: 'Cleared' })),
      }),
    ),
  }),
  snippet: s.object({
    slug,
    title: s.string({ min: 1, label: 'Title' }),
    tag: s.enum(SNIPPET_TAG_VALUES, { label: 'Tag' }),
    body: s.string({ label: 'Body', multiline: true }),
    /*
     * Where a model-tailored snippet came from. See `TailoredFrom`. Declared
     * exactly, as `reading` is above; `source` is a string and not `s.id`, for
     * the reason `background.source` gives — the file may have been deleted
     * before a backup was taken, and the snippet is still the person's.
     */
    tailored: s.optional(
      s.object({
        source: s.string({ min: 1, label: 'Tailored from' }),
        kind: s.enum(PROFILE_DOCUMENTS, { label: 'Document kind' }),
        model: s.string({ min: 1, label: 'Written by' }),
        at: s.instant({ label: 'Written' }),
      }),
    ),
  }),
  /**
   * Someone in the search. Only the name is required.
   *
   * Every other field is optional because the first thing recorded about a
   * referee is usually that they exist and have not sent the letter — and a
   * schema that demanded an email before it would keep a name is a schema
   * people work around by typing the name into a note, which is the state this
   * replaces. `email` is not validated as an address: half of what lands here
   * is pasted out of a signature block, and rejecting `a.chen (at) rice.edu`
   * would lose the only contact detail the user has.
   */
  /**
   * One fact about the user, read out of something they wrote.
   *
   * `period` is a STRING and deliberately not a date. A CV says "2021–2024",
   * "Summer 2019", "since 2024" and "n.d."; forcing those into ISO means either
   * refusing most of them or inventing precision nobody wrote down. `year` is
   * the sortable half, and it is optional because plenty of entries have none
   * that can be recovered.
   *
   * `source` is not checked as a node id here. Validation runs on load, when a
   * restored backup may hold a background whose source file was deleted before
   * the export — and a fact somebody's CV states does not stop being true
   * because the PDF is gone. It is a provenance breadcrumb, not a foreign key,
   * and the readers treat it as one.
   */
  /**
   * A relation, with its predicate as a string rather than an enum.
   *
   * Deliberately not `s.enum(...)` over the taxonomy. The whole point of the
   * open lane is that a predicate nobody enumerated is still stored, and a
   * validator that rejected one would delete exactly the facts a curated list
   * was never going to anticipate — on load, silently, from a backup.
   */
  claim: s.object({
    slug,
    predicate: s.string({ min: 1, label: 'Relation' }),
    surface: s.string({ min: 1, label: 'As written' }),
    known: s.boolean({ label: 'In the taxonomy' }),
    source: s.optional(s.string({ label: 'Read from' })),
  }),
  background: s.object({
    slug,
    kind: s.enum(BACKGROUND_KINDS, { label: 'Kind' }),
    title: s.string({ min: 1, label: 'Title' }),
    where: s.optional(s.string({ label: 'Where' })),
    period: s.optional(s.string({ label: 'When' })),
    year: s.optional(s.number({ min: 1900, max: 2100, label: 'Year' })),
    detail: s.optional(s.string({ label: 'Detail', multiline: true })),
    highlights: s.optional(s.array(s.string({ min: 1 }), { label: 'Highlights' })),
    source: s.optional(s.string({ label: 'Read from' })),
  }),
  person: s.object({
    slug,
    name: s.string({ min: 1, label: 'Name' }),
    role: s.optional(s.string({ label: 'Role' })),
    affiliation: s.optional(s.string({ label: 'Affiliation' })),
    email: s.optional(s.string({ label: 'Email' })),
    phone: s.optional(s.string({ label: 'Phone' })),
    note: s.optional(s.string({ label: 'Note', multiline: true })),
  }),
  /**
   * A conversation, validated loosely on purpose.
   *
   * `entries` is `s.unknown()` and every other schema here is exact, so the
   * exception has to earn itself. Two reasons, and the second is the one that
   * decides it:
   *
   *   1. It is a UNION of five shapes, and `core/schema.ts` has no union
   *      combinator — deliberately, because `FieldMeta` has to stay drawable as
   *      a form and a union of five is not a field.
   *   2. A transcript is append-only history. Every other prop here describes
   *      something the user can retype if a build rejects it; a chat log is not
   *      retypable, and a stricter schema would mean a thread written by a newer
   *      build is DROPPED by an older one. `validateRows` deletes what it cannot
   *      parse, so strictness here is measured in lost conversations.
   *
   * What still holds the line is the reader: `ThreadEntry` is a discriminated
   * union in TypeScript, and `entriesOf` in `kg/react/use-threads.ts` filters
   * anything that does not match before a screen ever sees it. Junk in this
   * array renders as nothing rather than as a crash.
   */
  thread: s.object({
    slug,
    title: s.string({ min: 1, label: 'Title' }),
    entries: threadEntries,
    // Kept so a conversation written before modes still validates. Nothing
    // writes it any more; `approvalOf` reads it as a fallback.
    autoApprove: s.optional(s.boolean({ label: 'Act without asking' })),
    approval: s.optional(s.enum(APPROVAL_MODES, { label: 'Approval' })),
    // The compaction summary and how far it reaches — see `ThreadProps`. Both
    // optional, because almost no conversation ever grows enough to need one.
    context: s.optional(s.string({ label: 'Earlier in this conversation' })),
    contextThrough: s.optional(s.number({ min: 0, int: true, label: 'Summarised through' })),
  }),
  posting: s.object({
    slug,
    title: s.string({ min: 1, label: 'Title' }),
    url: s.string({ label: 'Link' }),
    savedOn: s.isoDate({ label: 'Saved on' }),
    size: s.string({ label: 'Size' }),
  }),
  match: s.object({
    slug,
    role: s.string({ min: 1, label: 'Role' }),
    detail: s.string({ label: 'Detail' }),
    fit: s.number({ min: 0, max: 100, int: true, label: 'Fit' }),
  }),
  pipeline: s.object({
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
  }),
  /**
   * `input` is `s.string()` and not a parsed shape, on purpose.
   *
   * The reasoning is in `ProposalProps` and it is the same reasoning as
   * `thread.entries` above, arrived at from the other direction: a proposal's
   * payload is the input to SOME tool, so its shape is whatever that tool's
   * schema was. Validating it here would mean this file knowing all 67 of them,
   * and a tool whose schema tightened would silently delete queued proposals on
   * the next boot. It is text until `ctx.call` parses it at the moment of
   * approval, where a mismatch is a sentence on the card rather than a
   * disappearance.
   */
  proposal: s.object({
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
  }),
  profile: s.object({
    text: profileTextSchema,
    matchTerms: s.array(s.string({ min: 1 }), { label: 'Match terms' }),
    roles: s.array(s.string({ min: 1 }), { label: 'Role tags' }),
    includeAcademia: s.boolean({ label: 'Include academia' }),
    includeIndustry: s.boolean({ label: 'Include industry' }),
  }),
} satisfies { [T in NodeType]: Schema<NodePropsByType[T]> }

const NODE_TYPE_SET: ReadonlySet<string> = new Set<string>(NODE_TYPES)
const REL_SET: ReadonlySet<string> = new Set<string>(RELS)

const isNodeType = (value: string): value is NodeType => NODE_TYPE_SET.has(value)
const isRel = (value: string): value is Rel => REL_SET.has(value)

function propSchemaFor(type: NodeType): Schema<unknown> {
  return NODE_PROP_SCHEMAS[type]
}

/* -------------------------------- envelopes ------------------------------- */

const isRow = (row: unknown): row is Record<string, unknown> =>
  typeof row === 'object' && row !== null && !Array.isArray(row)

const readString = (row: Record<string, unknown>, key: string): string | null => {
  const value = row[key]
  return typeof value === 'string' ? value : null
}

/**
 * The envelope's timestamps, held to the standard every timestamp inside
 * `props` is already held to.
 *
 * They used to get a non-empty-string check and nothing else, while
 * `lastActionAt` sitting one field away went through `s.instant`. So a
 * hand-edited or truncated backup carrying `updatedAt: 'undefined'` crossed the
 * trust boundary untouched and surfaced as the literal 'undefined NaN' in the
 * thread list — a corrupt record that produced a screenshot instead of a
 * counted diagnostic, which is the one outcome this file exists to prevent.
 */
const INSTANT = s.instant()

const isInstant = (value: string): boolean => INSTANT.parse(value).ok

/**
 * A node row off disk.
 *
 * The id and the `type` field are checked against each other rather than
 * trusted separately. They are two spellings of one fact — 'app:0192…' already
 * says application — and a row where they disagree is a row written by a bug,
 * which is worth catching here rather than three layers up where the projection
 * hands an application's props to a keyword's renderer.
 */
export function validateNode(row: unknown): Validated<StoredNode> {
  if (!isRow(row)) return { ok: false, diagnostics: [diagnostic('nodes', null, 'Not a record.')] }

  const id = readString(row, 'id')
  if (!id) return { ok: false, diagnostics: [diagnostic('nodes', null, 'Has no id.')] }

  const parsed = parseNodeId(id)
  if (!parsed) {
    return { ok: false, diagnostics: [diagnostic('nodes', id, 'Its id is not a jojo id.')] }
  }

  const type = readString(row, 'type')
  if (!type || !isNodeType(type)) {
    return { ok: false, diagnostics: [diagnostic('nodes', id, `Unknown record type '${type}'.`)] }
  }
  if (type !== parsed.type) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('nodes', id, `Says it is a ${type} but its id says ${parsed.type}.`),
      ],
    }
  }

  const createdAt = readString(row, 'createdAt')
  const updatedAt = readString(row, 'updatedAt')
  if (!createdAt || !updatedAt) {
    return { ok: false, diagnostics: [diagnostic('nodes', id, 'Is missing its timestamps.')] }
  }
  if (!isInstant(createdAt) || !isInstant(updatedAt)) {
    return { ok: false, diagnostics: [diagnostic('nodes', id, 'Its timestamps are not times.')] }
  }

  const props = propSchemaFor(parsed.type).parse(row['props'], '')
  if (!props.ok) {
    return {
      ok: false,
      diagnostics: [diagnostic('nodes', id, `Could not be read — ${formatIssues(props.issues)}`)],
    }
  }

  // The trust boundary. Every field above has been checked; `props` came back
  // from the schema for exactly the type the id declares.
  return {
    ok: true,
    value: { id, type: parsed.type, props: props.value, createdAt, updatedAt } as StoredNode,
  }
}

/**
 * An edge row off disk.
 *
 * `EDGE_SCHEMA` is checked here and not left to a later integrity pass, because
 * type-prefixed ids make it a pure question: 'kw:…|TAGS|app:…' carries both
 * endpoint types in the key itself. An edge the schema forbids has no
 * projection that will ever read it, so keeping it would mean a row that exists,
 * survives export and renders nowhere.
 */
export function validateEdge(row: unknown): Validated<StoredEdge> {
  if (!isRow(row)) return { ok: false, diagnostics: [diagnostic('edges', null, 'Not a record.')] }

  const id = readString(row, 'id')
  if (!id) return { ok: false, diagnostics: [diagnostic('edges', null, 'Has no id.')] }

  const from = readString(row, 'from')
  const to = readString(row, 'to')
  const rel = readString(row, 'rel')
  if (!from || !to || !rel || !isRel(rel)) {
    return { ok: false, diagnostics: [diagnostic('edges', id, 'Does not name two records.')] }
  }

  const fromType = typeOfId(from)
  const toType = typeOfId(to)
  if (!fromType || !toType) {
    const message = 'Points at something that is not a jojo id.'
    return { ok: false, diagnostics: [diagnostic('edges', id, message)] }
  }

  if (id !== edgeId(from, rel, to)) {
    return { ok: false, diagnostics: [diagnostic('edges', id, 'Its id disagrees with its ends.')] }
  }

  if (!edgeIsWellTyped(rel, fromType, toType)) {
    const message = `A ${fromType} cannot ${EDGE_SCHEMA[rel].label} a ${toType}.`
    return { ok: false, diagnostics: [diagnostic('edges', id, message)] }
  }

  const createdAt = readString(row, 'createdAt')
  if (!createdAt) {
    return { ok: false, diagnostics: [diagnostic('edges', id, 'Is missing its timestamp.')] }
  }
  if (!isInstant(createdAt)) {
    return { ok: false, diagnostics: [diagnostic('edges', id, 'Its timestamp is not a time.')] }
  }

  const rawProps = row['props']
  const props = rawProps === undefined ? {} : rawProps
  if (!isRow(props)) {
    return { ok: false, diagnostics: [diagnostic('edges', id, 'Its details could not be read.')] }
  }

  return { ok: true, value: { id, rel, from, to, props, createdAt } as StoredEdge }
}

/* -------------------------------- the batch ------------------------------- */

export type ValidatedRows = {
  nodes: StoredNode[]
  edges: StoredEdge[]
  /** Never empty and never ignored: every one of these is a record not shown. */
  skipped: Diagnostic[]
}

/**
 * The whole store, node rows first.
 *
 * Edges are filtered against the nodes that survived, which is the graph
 * spelling of `addEdge`'s both-ends guard in `lib/graph/build.ts`: an edge with
 * a missing end would render as a
 * line running off into empty space, which reads as the layout having broken
 * rather than as a record having gone.
 */
/**
 * Props whose only job is pointing at a file, and which a restore may drop.
 *
 * A node fails validation as a WHOLE — one bad value and the record, its name,
 * its note and every edge incident to it are gone. That is right for a store
 * that came out of a transactional database, and wrong for `jojo/graph.json`,
 * which is explicitly a disposable mirror on a user's disk that they may copy,
 * sync, restore from a different moment, or edit by hand.
 *
 * Losing an application because one digit of a byte count is wrong, in a field
 * describing a document that is sitting right there in the same folder, is not
 * a trade worth making. These five are stripped and the record kept.
 *
 * `uri` joined them with the phone's file records. It belongs here for the same
 * reason and one extra: it is an absolute path into an app document directory
 * that a reinstall moves, so of the five it is the one most likely to be stale
 * in a backup a user restores months later. A stale `uri` costs an Open button;
 * dropping the whole application it was filed under costs the record.
 */
/*
 * `reading` is the sixth, and the only one that is not a link to bytes. It
 * earns its place on the same arithmetic: what it costs to strip is one model
 * call, and what it costs to keep is the whole file record.
 */
const SALVAGEABLE_FILE_PROPS = ['path', 'bytes', 'mtime', 'hash', 'uri', 'reading'] as const

/**
 * Props that may be dropped to keep the record, by the type that carries them.
 *
 * Was a single list for `file`, because `file` was the only type with one. An
 * application's `checklist` is the second, and it is the reason this generalised
 * rather than growing a second branch: the arithmetic is identical — what
 * stripping costs is a to-do list the person can ask for again, and what
 * keeping it costs is the application, its stage, its dates, its offer and
 * every edge pointing at it.
 *
 * A type absent from here has nothing droppable, and a malformed prop on one is
 * still what it always was: a database saying something impossible.
 */
const SALVAGEABLE_PROPS: Partial<Record<NodeType, readonly string[]>> = {
  file: SALVAGEABLE_FILE_PROPS,
  application: ['checklist', 'stageDates', 'noteFormat'],
}

/** What the restore summary says about each, in the person's terms. */
const SALVAGE_NOTE: Partial<Record<NodeType, string>> = {
  file: 'Came back without its document link.',
  application: 'Came back without its checklist, its stage dates or its note formatting.',
}

export type ValidateOptions = {
  /**
   * Retry a failed node with the file-link props removed, and keep it if that
   * succeeds. Used ONLY on the restore path — never on the hydrate path, where
   * a value this wrong means the database is corrupt and should say so.
   */
  salvage?: boolean
}

/**
 * Strips whatever this row's type is allowed to lose. `null` when there is
 * nothing to strip, which is also the answer for a row whose type is unreadable.
 */
function withoutSalvageable(row: unknown): { row: unknown; type: NodeType } | null {
  if (!isRow(row)) return null
  const props = row['props']
  const type = row['type']
  if (!isRow(props) || typeof type !== 'string') return null
  const droppable = SALVAGEABLE_PROPS[type as NodeType]
  if (droppable === undefined) return null
  const present = droppable.filter((k) => k in props)
  if (present.length === 0) return null
  const nextProps: Record<string, unknown> = { ...props }
  for (const k of present) delete nextProps[k]
  return { row: { ...row, props: nextProps }, type: type as NodeType }
}

export function validateRows(
  nodeRows: readonly unknown[],
  edgeRows: readonly unknown[],
  options: ValidateOptions = {},
): ValidatedRows {
  const nodes: StoredNode[] = []
  const edges: StoredEdge[] = []
  const skipped: Diagnostic[] = []
  const byId = new Map<string, StoredNode>()

  for (const row of nodeRows) {
    let parsed = validateNode(row)
    if (!parsed.ok && options.salvage === true) {
      const stripped = withoutSalvageable(row)
      if (stripped !== null) {
        const retry = validateNode(stripped.row)
        if (retry.ok) {
          // Reported, not silent. It IS a loss, and the restore summary names
          // WHAT was lost in its own sentence rather than folding it in with
          // records that were dropped altogether.
          skipped.push(
            diagnostic(
              'nodes',
              retry.value.id,
              SALVAGE_NOTE[stripped.type] ?? 'Came back with part of it missing.',
            ),
          )
          parsed = retry
        }
      }
    }
    if (!parsed.ok) {
      skipped.push(...parsed.diagnostics)
      continue
    }
    // Last one wins, and the loser is reported. A duplicate primary key cannot
    // come out of IndexedDB, so this only fires on an import or a merge — the
    // two paths where silently keeping one of two records is worst.
    if (byId.has(parsed.value.id)) {
      skipped.push(diagnostic('nodes', parsed.value.id, 'Appeared twice; the later one was kept.'))
    }
    byId.set(parsed.value.id, parsed.value)
  }
  nodes.push(...byId.values())

  const seenEdge = new Set<string>()
  for (const row of edgeRows) {
    const parsed = validateEdge(row)
    if (!parsed.ok) {
      skipped.push(...parsed.diagnostics)
      continue
    }
    const edge = parsed.value
    if (seenEdge.has(edge.id)) continue
    if (!byId.has(edge.from) || !byId.has(edge.to)) {
      skipped.push(diagnostic('edges', edge.id, 'Joins a record that is not there.'))
      continue
    }
    seenEdge.add(edge.id)
    edges.push(edge)
  }

  return { nodes, edges, skipped }
}

/* ------------------------------- invariants ------------------------------- */

/**
 * The integrity check R-2 asks for. Every boot, every build, no flag.
 *
 * It answers the question a UUID migration makes urgent and nothing else can:
 * did the seed compiler resolve every slug reference, or did it write an edge
 * to an id that was never minted? R-2 called for a dev-only check and this
 * comment used to describe one; all three boot paths — the seeded first run,
 * the in-memory session and `boot-ready`'s hydrate — call it unconditionally,
 * and the result reaches the user as `Session.problems` in Settings'
 * Diagnostics. That is the right shape at this scale and worth stating plainly:
 * a check that only ran in development would be a check that never saw the
 * store the report is about.
 *
 * Kept separate from `validateRows` because a violation here is a bug in jojo,
 * not a corrupt store, and the two want different recoveries: nothing is
 * dropped, nothing is skipped, and the app starts either way.
 */
export function checkInvariants(
  nodes: readonly StoredNode[],
  edges: readonly StoredEdge[],
): Diagnostic[] {
  const problems: Diagnostic[] = []
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const slugs = new Set<string>()
  for (const node of nodes) {
    // Narrowed on the discriminant here rather than through a `hasSlug(type)`
    // predicate: a guard over the type STRING narrows the string and tells the
    // compiler nothing about `node.props`, so `props.slug` two lines down would
    // still be an error on the profile branch. See `SluggedType` in `model.ts`,
    // where that helper was written, never called, and removed.
    if (node.type === 'profile') continue

    const key = `${node.type}\0${node.props.slug}`
    if (slugs.has(key)) {
      const message = `Two ${node.type} records share '${node.props.slug}'.`
      problems.push(diagnostic('nodes', node.id, message))
    }
    slugs.add(key)
  }

  const singles = new Set<string>()
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) {
      problems.push(diagnostic('edges', edge.id, 'Joins a record that is not there.'))
      continue
    }
    if (EDGE_SCHEMA[edge.rel].fromCardinality !== 'one') continue

    const key = `${edge.from}\0${edge.rel}`
    if (singles.has(key)) {
      problems.push(
        diagnostic('edges', edge.id, `${edge.rel} allows one target and this record has two.`),
      )
    }
    singles.add(key)
  }

  return problems
}
