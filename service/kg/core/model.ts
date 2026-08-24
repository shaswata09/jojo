/**
 * L1 — NODE_TYPES, RELS, StoredNode, StoredEdge, EDGE_SCHEMA.
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
 * Layer rule: `kg/core` imports nothing outside `kg/core` — not React, not
 * `idb`, not `@/data`, not `@/components`.
 */

/* ---------------------------------- ids ----------------------------------- */

/**
 * 'app:0192f4c1-7b3e-7a41-9c2d-8f5e1a0b6d33'.
 *
 * §3.1 of the architecture declares these three aliases in `storage/schema.ts`.
 * They are declared here instead because `core` may not import `storage` (§2),
 * and all three are aliases of `string`: two independent declarations of
 * `type NodeId = string` are the same type, so nothing is lost by the split and
 * the layer rule stays intact.
 */
export type NodeId = string

/** 'kw:0192…|TAGS|app:0192…' */
export type EdgeId = string

/** RFC3339 UTC — '2026-10-12T09:14:22.311Z'. A moment, not a day. */
export type Instant = string

/**
 * 'YYYY-MM-DD'. A day, with no time and no zone.
 *
 * Kept apart from `Instant` because they are read differently: a deadline is
 * the same day everywhere on earth, and rendering one through a timezone is how
 * a date silently shifts by one — the bug the date-handling header above `isoOf`
 * in `core/dates.ts` documents.
 */
export type ISODate = string

/** Edge props, and the shape a node's props are erased to at the boundary. */
export type Props = { readonly [key: string]: unknown }

/* --------------------------------- schema --------------------------------- */

/**
 * The eleven kinds of record that are persisted.
 *
 * `role` and `source` are absent on purpose: they are closed unions, they drive
 * a fixed filter and a fixed legend order, and promoting them to nodes would add
 * a join to every projection while buying nothing the user can act on. They are
 * synthesised as view-only nodes by `buildGraph` and never written down.
 */
export const NODE_TYPES = [
  'application',
  'organisation',
  'timelineItem',
  'keyword',
  'link',
  'file',
  'snippet',
  'posting',
  'match',
  'pipeline',
  'profile',
  /*
   * Someone in the search: a referee, a hiring chair, a recruiter, the person
   * who ran the screening call.
   *
   * A node rather than a field on the application, because the whole point of
   * a person is that they are not attached to one job. A referee writes for
   * nine applications and is chased once; a chair interviews you for two roles
   * in the same department. Modelled as a field, each of those becomes a copy
   * per application, and "who have I not thanked" stops being answerable.
   *
   * They were free text until now, and the seeded data shows what that cost:
   * "Chase the third reference letter for Texas Tech" is a REMINDER, because a
   * reminder was the only shape available for a fact about a person. Nothing
   * could count outstanding letters, list everyone at one university, or notice
   * that the same referee is late for three jobs.
   */
  'person',
  /*
   * A conversation with the assistant.
   *
   * It earns a node by the rule at the top of this file — the user can rename it
   * and annotate it — and it earns its place in the GRAPH by what that buys:
   * IndexedDB on the web and AsyncStorage on the phone with no second store to
   * write, `FILED_UNDER` to an application with no second kind of tagging, and
   * undo, the journal and Transfer for free. A chat log kept beside the graph
   * would have needed all four again, differently, on two platforms.
   */
  'thread',
  /*
   * One action an agent wants to take, kept until a person answers.
   *
   * A node rather than a side table for the same reason `thread` is one: it
   * needs to survive a reload, it needs to be filed against the pipeline that
   * raised it, and it needs to leave with the user when they export. A queue
   * kept beside the graph would have needed storage, an edge substitute and a
   * Transfer story invented again, on two platforms, for a record whose whole
   * life is measured in minutes.
   */
  'proposal',
] as const

export type NodeType = (typeof NODE_TYPES)[number]

/**
 * The seven ways two records can be joined.
 *
 * Spelled as verbs reading left to right — an application is AT an organisation
 * — but stored direction is a convenience, not a claim: every traversal in
 * `algebra.ts` walks both ways by default, because someone asking what connects
 * two records does not hold a direction in their head.
 *
 * `COPY_OF` is the one relation with no ancestor in the old model. `duplicate()`
 * produced a second application with nothing joining it to the first, so the two
 * rows drifted apart with no record that they had ever been the same job.
 */
export const RELS = ['AT', 'ABOUT', 'FILED_UNDER', 'TAGS', 'FROM', 'BECAME', 'COPY_OF'] as const

export type Rel = (typeof RELS)[number]

/** The record types a keyword may sit on. One flat namespace, deliberately. */
export const TAGGABLE = [
  'application',
  'timelineItem',
  'link',
  'file',
  'snippet',
  'person',
] as const

export type Taggable = (typeof TAGGABLE)[number]

type StoredNodeOf<T extends NodeType> = {
  id: NodeId
  type: T
  /** Never binary, never a derived value. Both are invariants, not habits. */
  props: NodePropsByType[T]
  createdAt: Instant
  updatedAt: Instant
}

/**
 * Written as a mapped-then-indexed union rather than a plain generic so that
 * `type` discriminates `props`. A flat `{ type: T; props: NodePropsByType[T] }`
 * widens to `props: AllProps` at `T = NodeType`, and `if (n.type ===
 * 'application')` then narrows the tag while leaving `props` a union — which
 * reads as though the check worked and hands back `unknown` on every field.
 */
export type StoredNode<T extends NodeType = NodeType> = { [K in T]: StoredNodeOf<K> }[T]

export type StoredEdge<R extends Rel = Rel> = {
  /** `${from}|${rel}|${to}` — see `edgeId`. */
  id: EdgeId
  rel: R
  from: NodeId
  to: NodeId
  /** `{}` by default. One key per edge, so the first edge attribute is free. */
  props: Props
  createdAt: Instant
}

export type EdgeSpec = {
  from: readonly NodeType[]
  to: readonly NodeType[]
  /** 'one' => at most one outgoing edge of this rel per node; link() replaces. */
  fromCardinality: 'one' | 'many'
  /** 'is filed under' — reused by /graph's sentence builder. */
  label: string
}

/**
 * `fromCardinality: 'one'` is what preserves the old `applicationId?: string`
 * semantics.
 *
 * That invariant used to live nowhere at all — it was *implied* by the field
 * being a scalar, so nothing stopped a second write from producing a timeline
 * item that was about two applications at once. `tx.link` on a 'one' relation
 * drops the node's existing outgoing edge of that rel in the same commit.
 */
export const EDGE_SCHEMA: { readonly [R in Rel]: EdgeSpec } = {
  AT: { from: ['application'], to: ['organisation'], fromCardinality: 'one', label: 'is at' },
  ABOUT: {
    from: ['timelineItem'],
    to: ['application'],
    // Many, since a reminder is often about more than one job at once: a
    // reference deadline that covers three applications, a conference where you
    // are meeting two departments. It was 'one' because the projection carried a
    // scalar `applicationId`, which is the tail wagging the dog — the edge is
    // the storage and the field was only ever a reading of it.
    fromCardinality: 'many',
    label: 'is about',
  },
  FILED_UNDER: {
    // A thread files under an application exactly as a document does, which is
    // the whole reason it is this relation and not a new one: "everything about
    // the Rice job" should return the conversation alongside the CV.
    // A person files under an application exactly as a CV does, and for exactly
    // the reason the cardinality note below gives: one referee goes to every job
    // you name them on.
    from: ['link', 'file', 'snippet', 'thread', 'person'],
    to: ['application'],
    // Many. One CV goes to every application you send it to, and filing it under
    // whichever you touched last is not filing it — it is losing it from the
    // other nine. The same is true of a link to a department page shared by two
    // roles there, and of a snippet reused across a batch.
    fromCardinality: 'many',
    label: 'is filed under',
  },
  TAGS: { from: ['keyword'], to: TAGGABLE, fromCardinality: 'many', label: 'tags' },
  FROM: {
    // A proposal came from a pipeline exactly as a match did — same question
    // ("which saved search raised this?"), so the same relation rather than a
    // second one that would need its own traversal in `algebra.ts`.
    from: ['match', 'posting', 'proposal'],
    to: ['pipeline'],
    fromCardinality: 'one',
    label: 'came from',
  },
  BECAME: {
    from: ['posting', 'match'],
    to: ['application'],
    fromCardinality: 'one',
    label: 'became',
  },
  COPY_OF: {
    from: ['application'],
    to: ['application'],
    fromCardinality: 'one',
    label: 'is a copy of',
  },
}

/** Whether this pair of endpoint types is one the relation is allowed to join. */
export function edgeIsWellTyped(rel: Rel, from: NodeType, to: NodeType): boolean {
  const spec = EDGE_SCHEMA[rel]
  return spec.from.includes(from) && spec.to.includes(to)
}

/* ------------------------------ domain types ------------------------------ */
/*
 * Moved verbatim from src/data/*, comments included. They are the shape of the
 * PROJECTIONS — what a card receives — not the shape of storage. `NodePropsByType`
 * below is the shape of storage, and the two differ everywhere a value can be
 * derived; project.ts says which and why.
 */

/*
 * Every closed union below is written as a value tuple with the type derived
 * from it, not as a bare union.
 *
 * `validate.ts` has to check a string off disk against the union, and a union
 * with no runtime spelling cannot be checked at all — the alternative is a
 * second hand-written list beside each type, which is the drift the `SOURCES`
 * comment already warns about. `src/data/*` keeps its own mutable arrays for
 * the UI's ordering and spreads them from these, so there is still one list.
 */

export const URGENCY_VALUES = ['red', 'amber', 'gray'] as const
export type Urgency = (typeof URGENCY_VALUES)[number]

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
 * same reason every other value union in this file moved down. `data/seed.ts`
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
  /** All 'YYYY-MM-DD'. Optional because the mock rows predate them. */
  appliedOn?: string
  submittedOn?: string
  firstReplyOn?: string
  outcome?: Outcome
  /** Present only while stage === 'offer'. */
  offer?: Offer
}

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

export const TIMELINE_KIND_VALUES = [
  'deadline',
  'interview',
  'visit',
  'call',
  'prep',
  'admin',
  'follow-up',
] as const
export type TimelineKind = (typeof TIMELINE_KIND_VALUES)[number]

export type TimelineItem = {
  id: string
  title: string
  /** One-line context, shown under the title. */
  detail?: string
  /** The user's own scribble, kept apart from `detail` so edits never clobber it. */
  note?: string
  /** 'YYYY-MM-DD'. A real sortable date, never "in 3 days". */
  date: string
  /** Derived: `startMins === undefined`. See project.ts. */
  allDay: boolean
  /** Minutes from midnight. Undefined whenever `allDay`. */
  startMins?: number
  durationMins?: number
  kind: TimelineKind
  urgency: Urgency
  /**
   * Every application this is about, newest edge last.
   *
   * A LIST, and it replaced a scalar `applicationId`. A reference deadline
   * covers three applications; a conference is where you meet two departments.
   * Empty rather than absent, so a caller never has to ask which kind of nothing
   * it is looking at.
   */
  applicationIds: string[]
  /** Whether this surfaces in the Vault's Reminders tool. */
  remind: boolean
  completedOn?: string | null
  location?: string
  joinUrl?: string
}

export const LINK_CATEGORY_VALUES = ['Posting', 'Institution', 'Person', 'Guide'] as const
export type LinkCategory = (typeof LINK_CATEGORY_VALUES)[number]

export type VaultLink = {
  id: string
  title: string
  url: string
  category: LinkCategory
  note?: string
  /** ISO date the record was filed. Rendered through `agoLabel`. */
  savedOn: string
  /**
   * Every application this is filed under, newest edge last.
   *
   * A LIST, and it replaced a scalar `applicationId`. The scalar was not a
   * simplification of this, it was a constraint disguised as one: a CV goes to
   * every job you send it to, and a field that holds one id filed it under
   * whichever you touched last — which is not filing it, it is losing it from
   * the other nine. Empty rather than absent, so a caller never has to ask which
   * kind of nothing it is looking at.
   */
  applicationIds: string[]
}

/**
 * The five drawers a document can be in.
 *
 * 'Job postings' is the newest and is the only one nothing of the user's goes
 * into by hand: it is where the extension files a captured listing. It exists
 * because those captures were going to 'Applications', which is the drawer for
 * the things a person WROTE — the CV, the statements, the cover letters. A
 * posting is somebody else's document about the job, kept for reference, and
 * mixing it in meant the Profile page's Documents card — which is that drawer,
 * filtered — filled up with pages the user never put there.
 *
 * Ordered as the filters read, so the two drawers about a job sit together.
 */
export const FILE_BUCKET_VALUES = [
  'To read',
  'Applications',
  'Job postings',
  'Talks',
  'Admin',
] as const
export type FileBucket = (typeof FILE_BUCKET_VALUES)[number]

/**
 * `page` is the fifth, and it is the first kind whose bytes jojo produced rather
 * than received.
 *
 * A job posting is the one document in a search that belongs to somebody else
 * and disappears on their schedule — the listing is pulled the week after the
 * interview, and with it the requirements the user is about to be asked about.
 * So a page is a CAPTURE: the posting as it read on the day it was filed,
 * serialised with every stylesheet, image and font rewritten to a `data:` URI so
 * that opening it a year later reads the same and reaches nothing.
 *
 * That last clause is the reason it is a kind of its own rather than a `doc`
 * with an .html name. Every other kind is inert to a viewer — a PDF reader
 * cannot be talked into fetching a tracking pixel. This one is live markup from
 * a site nobody here controls, so it carries a rule the other four do not: it is
 * rendered with scripts off and no network, and `core/capture.ts` owns what
 * counts as a well-formed one.
 */
export const FILE_KIND_VALUES = ['pdf', 'doc', 'slides', 'note', 'page'] as const
export type FileKind = (typeof FILE_KIND_VALUES)[number]

export type VaultFile = {
  id: string
  name: string
  kind: FileKind
  bucket: FileBucket
  size: string
  /** ISO date the record was filed. Rendered through `agoLabel`. */
  savedOn: string
  note?: string
  /**
   * Every application this is filed under, newest edge last.
   *
   * A LIST, and it replaced a scalar `applicationId`. The scalar was not a
   * simplification of this, it was a constraint disguised as one: a CV goes to
   * every job you send it to, and a field that holds one id filed it under
   * whichever you touched last — which is not filing it, it is losing it from
   * the other nine. Empty rather than absent, so a caller never has to ask which
   * kind of nothing it is looking at.
   */
  applicationIds: string[]
  /** See `FileProps.uri`. Projected straight through by `projections.files`. */
  uri?: string
  /** See `FileProps.sourceUrl`. Straight through, and never followed by a viewer. */
  sourceUrl?: string
  /** See `FileProps.capturedAt`. Straight through. */
  capturedAt?: Instant
}

export const SNIPPET_TAG_VALUES = ['Cover letter', 'Application form', 'Email', 'Bio'] as const
export type SnippetTag = (typeof SNIPPET_TAG_VALUES)[number]

export type Snippet = {
  id: string
  title: string
  tag: SnippetTag
  body: string
  /**
   * Every application this is filed under, newest edge last.
   *
   * A LIST, and it replaced a scalar `applicationId`. The scalar was not a
   * simplification of this, it was a constraint disguised as one: a CV goes to
   * every job you send it to, and a field that holds one id filed it under
   * whichever you touched last — which is not filing it, it is losing it from
   * the other nine. Empty rather than absent, so a caller never has to ask which
   * kind of nothing it is looking at.
   */
  applicationIds: string[]
}

export type Pipeline = {
  id: string
  name: string
  source: string
  schedule: string
  filter: string
  enabled: boolean
  /** Absent on every pipeline written before there were two kinds. */
  kind?: PipelineKind
  auto?: boolean
  lastRunAt?: Instant
  idleRounds?: number
}

/**
 * A queued suggestion, as a screen reads it.
 *
 * `pipelineId` is the `FROM` edge flattened, exactly as `Match.applicationId`
 * flattens `BECAME` — the edge is the storage and the scalar is a reading of
 * it. `null` rather than absent because a card whose pipeline has been deleted
 * still has to render, and "which pipeline?" then has a real answer: none.
 */
export type Proposal = {
  id: string
  pipelineId: string | null
  kind: PipelineKind
  tool: string
  input: string
  title: string
  rationale: string
  status: ProposalStatus
  proposedAt: Instant
  decidedAt?: Instant
  error?: string
}

export type Match = {
  id: string
  role: string
  detail: string
  fit: number
  /** Set once the match has been promoted. The match itself stays in the feed. */
  applicationId?: string
}

export type SavedPosting = {
  id: string
  title: string
  url: string
  /** ISO date the snapshot was taken. Rendered through `agoLabel`. */
  savedOn: string
  size: string
  /** Derived: whether a BECAME edge exists. Never stored — see project.ts. */
  linked: boolean
  applicationId?: string
}

export const LABEL_TONE_VALUES = ['teal', 'amber', 'red', 'green', 'gray'] as const
export type LabelTone = (typeof LABEL_TONE_VALUES)[number]

export type Label = {
  id: string
  name: string
  tone: LabelTone
}

/** Every free-text field on the profile page, in one record. */
export type ProfileText = {
  fullName: string
  position: string
  location: string
  email: string
  website: string
  scholar: string
  github: string
  linkedin: string
  targetRoles: string
  regions: string
}

export type Profile = {
  text: ProfileText
  /**
   * What the scout scores a posting against. Not the global keyword system —
   * see the panel copy, which has to keep the two apart for the reader too.
   */
  matchTerms: string[]
  /**
   * The role tags this search uses, in the order they are offered.
   *
   * Seeded from `DEFAULT_ROLES` and editable in Profile. An application may
   * still carry a tag that is no longer in here — deleting a role must not
   * rewrite records — so every reader that needs the full vocabulary takes the
   * union of this and what is actually in use. `roleVocabulary` does that.
   */
  roles: string[]
  includeAcademia: boolean
  includeIndustry: boolean
}

/**
 * Every role tag worth offering: the profile's list, plus any still on a record.
 *
 * The second half is what makes deleting a role safe. Without it, removing
 * "Lecturer" from the profile would hide every lecturer application from the
 * filter and drop them out of the per-role table — the records would still be
 * there and the app would have stopped admitting it.
 */
export function roleVocabulary(
  roles: readonly string[],
  inUse: readonly { roleTag: string }[],
): string[] {
  const out = [...roles]
  for (const record of inUse) {
    if (record.roleTag && !out.includes(record.roleTag)) out.push(record.roleTag)
  }
  return out
}

/* ----------------------------- stored props ------------------------------- */
/*
 * What actually goes on disk. Three rules, in force everywhere below:
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
  appliedOn?: ISODate
  submittedOn?: ISODate
  firstReplyOn?: ISODate
  outcome?: Outcome
  offer?: Offer
}

export type OrganisationProps = {
  slug: string
  name: string
}

export type TimelineItemProps = {
  slug: string
  title: string
  detail?: string
  note?: string
  date: ISODate
  /** Absent means all-day. `allDay` was the same fact stored twice. */
  startMins?: number
  durationMins?: number
  kind: TimelineKind
  urgency: Urgency
  remind: boolean
  /**
   * Absent while the item is open.
   *
   * The domain type spells this `string | null` because `null` is how the
   * reducer reopened an item. Storing that distinction would keep an explicit
   * `null` on disk, where structured clone preserves it — so `'completedOn' in
   * props` would answer yes for an item nobody has completed.
   */
  completedOn?: ISODate
  location?: string
  joinUrl?: string
}

export type KeywordProps = {
  slug: string
  name: string
  tone: LabelTone
}

export type LinkProps = {
  slug: string
  title: string
  url: string
  category: LinkCategory
  note?: string
  savedOn: ISODate
}

export type FileProps = {
  slug: string
  name: string
  kind: FileKind
  bucket: FileBucket
  /** '184 KB' — a label the user reads. `bytes` below is the number. */
  size: string
  savedOn: ISODate
  note?: string

  /*
   * The four link fields. All optional, and their absence is a valid, complete
   * state — a record with no `path` is every file that predates the folder, and
   * every file belonging to a user who has not connected one. Nothing is wrong
   * with such a record and the UI must not mark it as broken.
   *
   * D27's binary-free invariant is intact: these are a path and three facts
   * about bytes, never the bytes, so `getAll('nodes')` is the same 5 ms
   * operation it was. What is stale is D27's stated TRIGGER — it said a blobs
   * store "arrives with the server", and there is no server; the bytes live in
   * a folder the user picked, reached through `storage/file-store.ts`. If the
   * architecture doc still reads "no `File` in the graph", that sentence is
   * describing the trigger and not this field, and there is no numbered
   * decision recording the port. Do not read the absence as a prohibition.
   */

  /** Folder-relative POSIX path. Its PRESENCE is the "has bytes" flag. Write-once. */
  path?: string
  /** True byte count. `size` is a label rounded into a 1,024-byte window. */
  bytes?: number
  /** `File.lastModified`, epoch ms. A tripwire for drift, never identity. */
  mtime?: number
  /** 'sha256:<64 hex>'. The only field that can say "these are the same bytes". */
  hash?: string

  /**
   * Absolute device URI of a copy inside app storage. NATIVE ONLY, and the
   * fifth of five location fields rather than a synonym for `path`.
   *
   * It arrived here from the phone's fork of this file, where its header called
   * itself "the one divergence from the web app's copy" — a copy-maintenance
   * note the extraction made obsolete, which is why it is restated as a fact
   * about the field instead. `path` above is a folder-RELATIVE name inside a
   * directory the user granted, resolved through `storage/file-store.ts`;
   * this is an ABSOLUTE path into the app's own document directory, written by
   * `expo-file-system` after the picker copied the file there. They describe
   * different facts, and collapsing either into the other would make the drift
   * classification in `core/folder.ts` meaningless — a `path` that survives a
   * reinstall against a `uri` that does not.
   *
   * It is declared in `validate.ts` alongside the other four and listed in
   * `SALVAGEABLE_FILE_PROPS`. Until this move it was declared on the phone and
   * validated by nobody, so `uri: 99` reached `openDocument(file.uri)` in
   * `screens/vault/FileViewer.tsx` intact.
   *
   * The successor is the RN `FileStore` adapter over `expo-file-system`: once
   * that satisfies `storage/file-store-conformance.ts`, new records write
   * `path` and this field stops being written. Existing records keep it, so it
   * does not become removable by that alone. That adapter is deferred, and this
   * comment is where the deferral is recorded rather than a line in a document.
   */
  uri?: string

  /**
   * The page this file was captured from. `kind: 'page'` only.
   *
   * Kept because the capture is a copy of something that had an address, and the
   * address is half of what makes the copy trustworthy a year later: it is what
   * the record can be checked against while the original still exists, and what
   * the user reads when they are trying to remember which of four Workday
   * listings this was. It is NOT a fallback the viewer may quietly follow —
   * opening a capture must never reach the network, or the archive becomes a
   * tracker that fires every time somebody revisits their own notes.
   *
   * Validated as a string here and re-checked against `CAPTURE_SCHEMES` before
   * anything renders it as a link, because a stored `javascript:` would
   * otherwise arrive at an `href` intact.
   */
  sourceUrl?: string
  /**
   * When the capture was taken, which is not `savedOn`.
   *
   * `savedOn` is a date and means "when this record was filed"; a posting saved
   * from a tab left open for a week was captured on a day the user may care
   * about separately. Instant rather than ISODate so a second capture of the
   * same posting sorts against the first.
   */
  capturedAt?: Instant
}

export type SnippetProps = {
  slug: string
  title: string
  tag: SnippetTag
  body: string
}

export type PostingProps = {
  slug: string
  title: string
  url: string
  savedOn: ISODate
  size: string
}

export type MatchProps = {
  slug: string
  role: string
  detail: string
  fit: number
}

export type PipelineProps = {
  slug: string
  name: string
  source: string
  schedule: string
  filter: string
  enabled: boolean
  /**
   * Which of the two agents this pipeline runs. Absent means `scout`.
   *
   * Optional rather than required, and the default is not arbitrary: every
   * pipeline that existed before there were two kinds was described on the page
   * as "a saved search — a board to watch, the terms that matter, and how often
   * to look", which is what `scout` is. So an old row read under the new type
   * keeps the meaning it was written with. Making it required would have been
   * the other choice, and `validateRows` deletes what it cannot parse — the
   * cost of that decision is measured in the user's saved searches.
   */
  kind?: PipelineKind
  /**
   * Run without asking. Twin only — see `AUTO_CAPABLE` in `core/proposal.ts`.
   *
   * The tools do not enforce this and cannot usefully: a pipeline's kind and its
   * auto flag are two props on one record, and a tool that refused to set them
   * inconsistently would still be one commit away from a graph where they are.
   * The gate is at the point of USE — the driver reads `AUTO_CAPABLE[kind]`
   * before it decides whether to bypass the queue — which is the only place the
   * answer matters.
   */
  auto?: boolean
  /** When the last round finished. Absent means it has never run. */
  lastRunAt?: Instant
  /** Consecutive rounds that raised nothing. See `shouldOfferShutdown`. */
  idleRounds?: number
}

/**
 * `twin` keeps the graph honest; `scout` looks outward.
 *
 * Named for what they are FOR rather than what they do, because both of them
 * "run an agent over the graph" and that tells a reader nothing. The digital
 * twin fills in what the user forgot to write down; the scout finds jobs. What
 * each is ALLOWED to do is `core/proposal.ts`, which is policy and belongs
 * somewhere testable rather than in a prompt.
 */
export const PIPELINE_KINDS = ['twin', 'scout'] as const

export type PipelineKind = (typeof PIPELINE_KINDS)[number]

export const PROPOSAL_STATUSES = ['pending', 'approved', 'discarded', 'failed'] as const

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

/**
 * One thing an agent wants to do, kept until a person answers.
 *
 * `input` is JSON text rather than a structured value, and that is the one
 * decision in this type worth defending. The alternative is a
 * `Record<string, unknown>` in the node's props, which the store would happily
 * keep — but then the shape of a stored proposal depends on the shape of a
 * tool's input schema at the moment it was written, and a tool whose schema
 * tightens later has proposals in the store that no longer parse and no way to
 * tell that from a bug. As text it is inert: it round-trips through storage
 * unexamined, and the only thing that ever interprets it is `ctx.call`, which
 * parses it with the target tool's own schema at the moment of approval and
 * fails cleanly if it no longer fits.
 */
export type ProposalProps = {
  slug: string
  kind: PipelineKind
  /** The registry name, `timeline.item.create`. */
  tool: string
  /** The tool's input, as JSON text. See the note above. */
  input: string
  /** One line, in the user's language: "Add a follow-up reminder for Stripe". */
  title: string
  /** Why the agent thinks so — shown under the title on the card. */
  rationale: string
  status: ProposalStatus
  proposedAt: Instant
  decidedAt?: Instant
  /**
   * Why it failed, when `status` is 'failed'. The tool's own sentence.
   *
   * Written by a SECOND commit, not by the approval that failed, and the reason
   * is the transaction: `ctx.call` throwing is what rolls the approval back, so
   * by the time there is a message to record, the transaction that would have
   * recorded it no longer exists. `pipeline.proposal.fail` is that second
   * commit. It only ever runs on the failure path, which is the rare one.
   *
   * There is deliberately no `journalId` beside this. An approval's write and
   * its status change are one transaction and therefore one journal row, so
   * reverting that row already puts both back — a stored id would name the row
   * that undo can already find, and a field nothing writes is worse than no
   * field, as the never-written `FROM` edge on `match` has been demonstrating.
   */
  error?: string
}

export type ProfileProps = Profile

/** The one map that gives L0 and L1 their domain types without either knowing them. */
/**
 * One turn of a conversation, as it is kept.
 *
 * The DISPLAY shape, not the model-facing one. `kg/agent/transcript.ts` derives
 * the OpenAI messages from these, so a thread is stored once and read two ways
 * rather than stored twice and kept in step by hand — which is the failure mode
 * a chat log invites, because the two drift only in old threads nobody reopens.
 *
 * `step` keeps what a person needs to read back: which tool ran, what it was
 * asked, and what it said. It does NOT keep the undo closure, which cannot
 * survive a reload — the journal is what takes an agent's writes back after the
 * conversation has been closed, and it already does.
 */
export type ThreadEntry =
  | { kind: 'you'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'answer'; text: string }
  | { kind: 'error'; text: string }
  | {
      kind: 'step'
      /** The registry name, `graph.query`. */
      tool: string
      title: string
      effect: string
      args: unknown
      status: 'done' | 'failed' | 'declined'
      detail?: string
    }

export type ThreadProps = {
  slug: string
  /** The user's name for it, or the first thing they said, trimmed. */
  title: string
  entries: ThreadEntry[]
  /**
   * Let the agent write without stopping to ask. Absent means ask.
   *
   * Optional, so every conversation written before this existed keeps the safe
   * meaning — the same reason `PipelineProps.auto` is optional, and this is
   * that field's shape transplanted: a boolean on the record, validated as
   * optional, set by a one-field tool, and enforced at the point of USE rather
   * than in the tool. A tool that refused to set it could still be one commit
   * away from a graph where it disagreed with something else.
   *
   * Per conversation rather than per device, and that is a real choice with a
   * real cost. It is a statement about how much this person trusts the agent
   * for THIS piece of work — "this one is a cleanup session, stop asking me" —
   * which travels with them, so it is a record and Transfer carries it to the
   * phone. An endpoint would not be; see `model-settings-context.ts` for the
   * line that separates the two.
   */
  autoApprove?: boolean
}

/**
 * What is worth keeping about someone, and deliberately not more.
 *
 * `name` is the only required field, because the first thing anyone records
 * about a referee is that they exist and are late. Everything else is filled in
 * when it turns out to matter — a form that demanded an email before it would
 * remember a name would be a form people work around in the note field, which
 * is the state this replaces.
 *
 * `role` is THEIR role, not the job's: "Hiring chair", "Referee", "Recruiter".
 * It is free text rather than a union for the reason `ROLES` is a union and
 * should not be — the shapes a search takes are not knowable from here, and a
 * closed list would send half of them into the note.
 *
 * `affiliation` AND NOT `org`, and the name is the point. On an application,
 * `org` is a pointer — the employer is the `organisation` node on the other end
 * of `AT`, and `seed.test.ts` bans the key outright to keep it that way. A
 * person's affiliation is not that: a referee at KTH is named on two Baylor
 * applications and there is no KTH organisation in the store, nor should there
 * be. It is a fact about them, in their own words, and it points at nothing.
 */
export type PersonProps = {
  slug: string
  name: string
  role?: string
  affiliation?: string
  email?: string
  phone?: string
  note?: string
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
 * relation read backwards, which is the rule this file states at the top —
 * the edge is the storage and a field would be a copy of it.
 */
export type Organisation = {
  id: string
  name: string
  slug: string
  /** Every application at this employer, newest edge last. */
  applicationIds: string[]
}

/** A person, with the jobs they are named on. See `PersonProps`. */
export type Person = {
  id: string
  name: string
  role?: string
  /** Where they are, in their own words. Not a pointer — see `PersonProps`. */
  affiliation?: string
  email?: string
  phone?: string
  note?: string
  /** Every application this person is named on, newest edge last. */
  applicationIds: string[]
}

export type NodePropsByType = {
  application: ApplicationProps
  organisation: OrganisationProps
  timelineItem: TimelineItemProps
  keyword: KeywordProps
  link: LinkProps
  file: FileProps
  snippet: SnippetProps
  posting: PostingProps
  match: MatchProps
  pipeline: PipelineProps
  profile: ProfileProps
  person: PersonProps
  thread: ThreadProps
  proposal: ProposalProps
}

/**
 * Everything but `profile` carries a slug, and the slug index depends on it.
 *
 * The type and no predicate. A `hasSlug(type): type is SluggedType` lived here
 * and was never called once: a guard over the `type` STRING narrows the string
 * and tells the compiler nothing about the node's `props`, so every site that
 * wanted it — the slug loop in `checkInvariants`, the indexes in
 * `MutableSnapshot` — still had to narrow on `node.type` itself and did. It is
 * the kind of helper that reads as missing until you write it.
 */
export type SluggedType = Exclude<NodeType, 'profile'>
