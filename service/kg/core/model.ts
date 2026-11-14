/**
 * L1 — the domain model's import surface: NODE_TYPES, RELS, StoredNode,
 * StoredEdge, EDGE_SCHEMA, and every domain type and constant beside them.
 *
 * The rule for what earns a node: a value is a node iff the user can rename or
 * annotate it. Organisation passes. `roleTag` and `source` are closed unions
 * driving a fixed filter and a fixed legend order, so they stay props and are
 * synthesised as view-only nodes by `buildGraph`.
 *
 * The domain types live here too, below everything that reads them. They used
 * to be declared in `src/data/*` beside the fixtures, which made the seed data
 * the definition of the model: `TimelineItem` imported `Urgency` from the file
 * holding twelve hand-written applications, so the shape of a record and one
 * demo of it could not be separated. `src/data/*` now imports them back and is
 * fixtures only.
 *
 * ## Where the declarations are
 *
 * Split by domain into the `model-*.ts` files beside this one, and re-exported
 * from here by name, so every importer — several hundred of them, across both
 * apps — keeps writing `core/model` and nothing else:
 *
 *   - `model-graph.ts`        ids, node types, relations, the edge schema, `NodePropsByType`
 *   - `model-application.ts`  applications, stages, offers, checklists, organisations
 *   - `model-timeline.ts`     timeline items
 *   - `model-vault.ts`        links, files, snippets, tailoring provenance
 *   - `model-scout.ts`        pipelines, proposals, matches, postings and their reading
 *   - `model-label.ts`        the keyword palette, keywords, sticky notes
 *   - `model-format.ts`       a note's stored formatting
 *   - `model-profile.ts`      the profile, background facts, claims
 *   - `model-person.ts`       people, contact roles, referee briefs
 *   - `model-thread.ts`       conversations and approval modes
 *
 * Named re-exports and never `export *`: this file alone says which
 * declaration each name resolves to, and a name added to a domain file is not
 * part of the model's surface until it is listed here. Types go through
 * `export type`, so they add no value edge for `scripts/import-cycles.mjs` to
 * follow; the values are all leaves, and no `model-*.ts` file imports a value
 * from another.
 *
 * Layer rule: `kg/core` imports nothing outside `kg/core` — not React, not
 * `idb`, not `@/data`, not `@/components`.
 */

/* ------------------------------ domain types ------------------------------ */
/*
 * Moved verbatim from src/data/*, comments included. They are the shape of the
 * PROJECTIONS — what a card receives — not the shape of storage. `NodePropsByType`
 * is the shape of storage, and the two differ everywhere a value can be
 * derived; project.ts says which and why.
 */

/*
 * Every closed union is written as a value tuple with the type derived
 * from it, not as a bare union.
 *
 * `validate.ts` has to check a string off disk against the union, and a union
 * with no runtime spelling cannot be checked at all — the alternative is a
 * second hand-written list beside each type, which is the drift the `SOURCES`
 * comment already warns about. `src/data/*` keeps its own mutable arrays for
 * the UI's ordering and spreads them from these, so there is still one list.
 */

/* ----------------------------- stored props ------------------------------- */
/*
 * What actually goes on disk — every `*Props` type. Three rules, in force for
 * all of them:
 *
 *   1. No derived value. `daysAgo`, `allDay`, `linked` and `degree` are absent
 *      here and computed in project.ts.
 *   2. No pointer. An `applicationId` field is an edge written as a scalar; the
 *      edge is the storage and the field is the projection.
 *   3. No binary (D27). The moment a Blob lands in props, reading every node
 *      stops being a 5 ms operation.
 *
 * `slug` is on every type but `profile`, which is a singleton and has nothing to
 * be unique against.
 */

export type { Hex } from './ink'

export {
  EDGE_SCHEMA,
  edgeIsWellTyped,
  NODE_TYPES,
  RELS,
  TAGGABLE,
} from './model-graph'
export type {
  EdgeId,
  EdgeSpec,
  Instant,
  ISODate,
  NodeId,
  NodePropsByType,
  NodeType,
  Props,
  Rel,
  SluggedType,
  StoredEdge,
  StoredNode,
  Taggable,
} from './model-graph'
export {
  DEFAULT_ROLES,
  displayName,
  DRAFT_CHECKLIST_ITEMS,
  MAX_CHECKLIST_ITEMS,
  MAX_CHECKLIST_TEXT,
  OUTCOME_VALUES,
  PERIOD_VALUES,
  ROLES,
  SOURCES,
  STAGE_LABEL,
  STAGE_VALUES,
} from './model-application'
export type {
  Application,
  ApplicationPatch,
  ApplicationProps,
  ChecklistItem,
  Offer,
  OfferApplication,
  Organisation,
  OrganisationProps,
  Outcome,
  Period,
  RoleTag,
  Source,
  Stage,
  StageDates,
} from './model-application'
export {
  TIMELINE_KIND_VALUES,
  URGENCY_VALUES,
} from './model-timeline'
export type {
  TimelineDraft,
  TimelineItem,
  TimelineItemProps,
  TimelineKind,
  Urgency,
} from './model-timeline'
export {
  FILE_BUCKET_VALUES,
  FILE_KIND_VALUES,
  LINK_CATEGORY_VALUES,
  PROFILE_DOCUMENTS,
  SNIPPET_TAG_VALUES,
} from './model-vault'
export type {
  FileBucket,
  FileKind,
  FileProps,
  LinkCategory,
  LinkProps,
  ProfileDocument,
  Snippet,
  SnippetProps,
  SnippetTag,
  TailoredFrom,
  VaultFile,
  VaultLink,
} from './model-vault'
export {
  MAX_POSTING_SUMMARY,
  MAX_PROPOSAL_READING,
  MAX_REQUIREMENT_TEXT,
  MAX_REQUIREMENTS,
  PIPELINE_KINDS,
  PROPOSAL_STATUSES,
} from './model-scout'
export type {
  Match,
  MatchProps,
  Pipeline,
  PipelineKind,
  PipelineProps,
  PostingProps,
  PostingReading,
  Proposal,
  ProposalProps,
  ProposalStatus,
  Requirement,
  SavedPosting,
} from './model-scout'
export {
  DEFAULT_STICKY_TONE,
  LABEL_TONE_VALUES,
  MAX_STICKY_TEXT,
  TONE_LABEL,
} from './model-label'
export type {
  KeywordProps,
  Label,
  LabelTone,
  StickyNote,
  StickyNoteProps,
} from './model-label'
export {
  MAX_NOTE_SPANS,
  NOTE_SIZES,
} from './model-format'
export type {
  NoteSize,
  NoteSpan,
} from './model-format'
export {
  BACKGROUND_KINDS,
  BACKGROUND_LABEL,
  BACKGROUND_ORDER,
  roleVocabulary,
} from './model-profile'
export type {
  Background,
  BackgroundKind,
  BackgroundProps,
  ClaimProps,
  Profile,
  ProfileProps,
  ProfileText,
} from './model-profile'
export {
  CONTACT_ROLE_LABEL,
  CONTACT_ROLE_VALUES,
  contactRoleOf,
  MAX_BRIEF_HIGHLIGHT_TEXT,
  MAX_BRIEF_HIGHLIGHTS,
  MAX_BRIEF_NOTE_TEXT,
  MAX_BRIEFS,
} from './model-person'
export type {
  ContactRole,
  Person,
  PersonProps,
  RefereeBrief,
} from './model-person'
export {
  APPROVAL_LABEL,
  APPROVAL_MODES,
  APPROVAL_SAID,
  APPROVAL_TITLE,
  approvalOf,
  MAX_THOUGHT_STORED,
} from './model-thread'
export type {
  ApprovalMode,
  ThreadEntry,
  ThreadProps,
} from './model-thread'
