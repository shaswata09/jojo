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
  /*
   * A relation between two records, as a RECORD.
   *
   * Reified rather than stored as an edge, and the reason is structural: an
   * `EdgeId` is `${from}|${rel}|${to}` and the index is keyed by `Rel`, so a
   * relation's name is part of an edge's identity and the set of names is
   * closed. That closed set describes the app's own shape — an application is
   * at an organisation — and should stay closed.
   *
   * What a model reads out of a CV is not that shape. "Led the redesign",
   * "supervised six dissertations", "peer reviewed for TOCS" are relations
   * nobody enumerated, arriving under a different name each time. Putting the
   * predicate in a node's props buys an open vocabulary, any number of
   * relations between one pair, and somewhere to record what the model actually
   * said. It costs one hop on traversal.
   */
  'claim',
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
  /*
   * One fact about the person whose job search this is — a degree, a post, a
   * paper, a skill.
   *
   * A node rather than more fields on the profile, and the reason is the same
   * one that earns every other type here: these are things the user can rename,
   * annotate, delete and file. There are also an unbounded number of them,
   * which a fixed set of profile fields cannot hold, and they need to point at
   * the document they were read out of — which is an edge's job, or in this
   * case a `source` id, and either way not a text field's.
   *
   * The profile stays what it was: what the user SAYS they want. These are what
   * they have actually done. Scoring a posting needs both and they are not the
   * same claim.
   */
  'background',
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
/*
 * `SUBJECT` and `OBJECT` are the two ends of a reified relation, and they are
 * two names rather than one because an edge is identified by
 * `${from}|${rel}|${to}` — a claim pointing at both its ends through one
 * relation would be two edges the index cannot tell apart.
 */
export const RELS = [
  'AT',
  'ABOUT',
  'FILED_UNDER',
  'TAGS',
  'FROM',
  'BECAME',
  'COPY_OF',
  'SUBJECT',
  'OBJECT',
] as const

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

  /*
   * The two ends of a reified relation.
   *
   * `to` is EVERY node type, which no other relation here does, and it is the
   * point rather than a shortcut: the taxonomy is open, so what a claim can
   * join is not knowable in advance. Constraining it would put a second,
   * narrower vocabulary underneath the open one and quietly refuse the
   * relations the open lane exists to keep.
   *
   * `fromCardinality: 'one'` on both, and that IS a constraint worth having: a
   * claim has exactly one subject and one object. Without it a second `link`
   * would add an end rather than replace one, and the claim would silently mean
   * something else.
   */
  SUBJECT: {
    from: ['claim'],
    to: [...NODE_TYPES],
    fromCardinality: 'one',
    label: 'is about',
  },
  OBJECT: {
    from: ['claim'],
    to: [...NODE_TYPES],
    fromCardinality: 'one',
    label: 'points at',
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

/**
 * What a conversation asks about before it acts.
 *
 * Ordered from most cautious to least, which is the order they are offered in.
 */
export const APPROVAL_MODES = ['manual', 'semi', 'auto'] as const

export type ApprovalMode = (typeof APPROVAL_MODES)[number]

/**
 * What each mode is called, and what it actually does — written once.
 *
 * Three surfaces show this: the control on the web, the control on the phone,
 * and the announcement when the agent itself changes the setting. Copy about
 * what will happen WITHOUT being asked is exactly the copy that must not drift
 * between them.
 *
 * `SAID` names deletion explicitly rather than saying "dangerous", because the
 * line the app actually draws is `delete` and `admin`, plus the handful of
 * tools that ask to be confirmed themselves — twenty of a hundred, counted
 * 2026-09-13 and pinned in `catalog.test.ts`. Closing an application is a
 * `move` and passes without a prompt under `semi`, which is worth a person
 * knowing before they choose it.
 */
export const APPROVAL_LABEL: { readonly [M in ApprovalMode]: string } = {
  manual: 'Manual',
  semi: 'Semi-auto',
  auto: 'Auto',
}

/** The announcement, when the change itself is a step the agent took. */
export const APPROVAL_TITLE: { readonly [M in ApprovalMode]: string } = {
  manual: 'Asking before each change',
  semi: 'Asking only before deletions',
  auto: 'Acting without asking',
}

export const APPROVAL_SAID: { readonly [M in ApprovalMode]: string } = {
  manual: 'You are asked before anything in this conversation is written.',
  semi: 'Edits happen straight away. You are asked before anything is deleted or cleared.',
  auto: 'Everything happens straight away, deletions included. Nothing is confirmed.',
}

/**
 * The mode a stored conversation is in, including ones written before modes.
 *
 * A thread saved by an older build has `autoApprove` and no `approval`, and the
 * two settings it could hold map exactly onto the first two modes: asking about
 * every write, or asking only about the destructive ones. Nobody is silently
 * upgraded to `auto` — that is a mode a person has to choose.
 */
export const approvalOf = (props: {
  approval?: ApprovalMode
  autoApprove?: boolean
}): ApprovalMode => props.approval ?? (props.autoApprove === true ? 'semi' : 'manual')

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
 * the funnel's reach, the response-time chart, `frequency.sentOn`,
 * `recommend.ts` and the seed. Writing it in two places would be two copies of
 * one fact, and the copy nothing reads is the one that goes stale. Everything
 * that reads or writes a stage date goes through `core/stage-dates.ts`, which
 * is where that hole is filled in — and the only place that has to know.
 */
export type StageDates = { readonly [S in Stage]?: ISODate }

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
  postingId?: string
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

/*
 * The last three name a DOCUMENT rather than a use, and they arrived together
 * with tailoring (2026-09-13): a CV rewritten for one posting is a snippet —
 * text to copy into the real document — but "Application form" would have been
 * a lie about what it is. 'Cover letter' already sat on the list for the same
 * reason, which is what made the line worth crossing.
 */
export const SNIPPET_TAG_VALUES = [
  'Cover letter',
  'Application form',
  'Email',
  'Bio',
  'CV',
  'Research statement',
  'Teaching statement',
] as const
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
  /** Set when a model wrote this for one posting. See `TailoredFrom`. */
  tailored?: TailoredFrom
}

/**
 * The kinds of document a person applies with.
 *
 * Declared here rather than in `core/document-kind.ts`, which owned it, since
 * the day a kind became a stored value — `TailoredFrom.kind` — and everything
 * that goes on disk is described in this file. `document-kind.ts` re-exports
 * it, so every reader of the classifier still finds it where it expects to.
 *
 * `other` is the open lane, for the same reason `BACKGROUND_KINDS` has one: a
 * document that is none of the four is still a document, and a closed list
 * would have to refuse it or lie about it.
 */
export const PROFILE_DOCUMENTS = [
  'cv',
  'research-statement',
  'teaching-statement',
  'cover-letter',
  'other',
] as const
export type ProfileDocument = (typeof PROFILE_DOCUMENTS)[number]

/**
 * Where a tailored snippet came from, and enough about it to be doubted.
 *
 * A model wrote this body for one posting, out of one of the person's own
 * documents. The four fields are what the card needs to say so: which document
 * (`source`, a file id — a breadcrumb, not a foreign key, exactly as
 * `BackgroundProps.source` is; the file may be gone and the snippet still
 * stands), what kind it was, which model, and when.
 *
 * It describes ORIGIN, not current content. A person who edits the body in the
 * Vault leaves this in place, as they would a "read from" line on a background
 * fact — the snippet was tailored from that document, and editing it afterwards
 * does not make that untrue. What it must never do is survive a copy: a
 * duplicate the person made is not the model's output, and
 * `vault.snippet.duplicate` drops it.
 */
export type TailoredFrom = {
  /** The id of the `file` node the base document was. Not validated as one. */
  source: string
  /** What that document was, as `documentKindOf` classified it at the time. */
  kind: ProfileDocument
  /** The model that wrote it — 'gemma_4_31b'. Shown, never used to decide anything. */
  model: string
  /** When, from `ctx.now`. */
  at: Instant
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
  /** See `ProposalProps.swept`. Filtered out before any screen sees it. */
  swept?: boolean
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

/**
 * The palette a keyword can be painted in — and the only set of colours this
 * app ever asks a person to choose from.
 *
 * Eight, and picked as hues rather than as meanings. The first five are the
 * originals and their ids are kept exactly as they were, because they are the
 * wire format: they are stored on every keyword, validated by `s.enum` against
 * this array, and written into backups. `teal` is the id of the blue — a
 * misnomer from the first five minutes of this feature that is now not worth a
 * migration, which is why `TONE_LABEL` below exists to say what each one is
 * actually called.
 *
 * Why a fixed palette rather than a colour wheel: every colour here is drawn as
 * text on its own tinted background in two themes, and each of the eight was
 * measured at 5.1:1 or better against both (`index.css` records the figures).
 * A hex a person types cannot be measured, and the ones people reach for first
 * — a bright yellow, a mid grey — are exactly the ones that disappear against
 * one theme or the other. Sixteen tokens with known contrast beats infinite
 * choice with none.
 *
 * Separation, measured in CIELAB: the closest pair by eye is Grey/Cyan at
 * dE 28. Simulated for deuteranopia the closest is Amber/Red at dE 5.6, which
 * is a pair this palette inherited rather than introduced — the three colours
 * added alongside sit at dE 12 or more from their nearest neighbour. Every
 * swatch carries its name as its accessible name for that reason.
 */
export type { Hex } from './ink'
import type { Hex } from './ink'

export const LABEL_TONE_VALUES = [
  'teal',
  'cyan',
  'green',
  'amber',
  'red',
  'pink',
  'violet',
  'gray',
] as const
export type LabelTone = (typeof LABEL_TONE_VALUES)[number]

/**
 * What each colour is called out loud — in the swatch's label, its tooltip and
 * the phone's radio.
 *
 * Here rather than once per app, which is where it was: the web called `teal`
 * "Blue" and the phone called it "Teal", so the same keyword had two different
 * colours depending on which screen you asked. A `Record<LabelTone, string>`
 * annotation is also the only spelling in which adding a colour and forgetting
 * to name it is a compile error.
 */
export const TONE_LABEL: Record<LabelTone, string> = {
  teal: 'Blue',
  cyan: 'Cyan',
  green: 'Green',
  amber: 'Amber',
  red: 'Red',
  pink: 'Pink',
  violet: 'Violet',
  gray: 'Grey',
}

export type Label = {
  id: string
  name: string
  tone: LabelTone
  /**
   * A colour off the spectrum, when one of the eight was not the one.
   *
   * ADDITIVE, and `tone` stays required beside it rather than being replaced by
   * it. Three reasons, in the order they bite:
   *
   *   - `tone` is the wire format. It is on every keyword ever stored, in every
   *     backup, and validated by `s.enum`. Widening that field to "a name or a
   *     hex" would make every `Record<LabelTone, …>` in both apps a lie.
   *   - It is the fallback. `ink` is in `SALVAGEABLE_PROPS`, so a keyword whose
   *     custom colour fails validation comes back in the colour it had before —
   *     rather than the whole keyword being dropped, which is what happens to a
   *     node that fails whole.
   *   - A surface that cannot compute a colour can still draw the preset. There
   *     are fewer of those than there were, but "the chip is blue instead of
   *     the plum you chose" is a better failure than a chip with no colour.
   *
   * Stored as '#rrggbb' — `core/ink.ts` normalises on the way in and derives
   * the three values a chip actually needs, per theme, on the way out.
   */
  ink?: Hex
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
  /** The posting's own reference, when it states one. See `core/duplicates.ts`. */
  postingId?: string
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
 * What a form hands in to create a timeline item.
 *
 * Derived from `TimelineItem` rather than written out, so a field added to the
 * record cannot be forgotten here. The four made optional are the ones the
 * projection guarantees on the way out but a caller should not have to state on
 * the way in — `applicationIds: []` to say "filed under nothing" is noise.
 *
 * IN CORE rather than beside `useTimeline`, because `core/stage-policy.ts`
 * returns one and core may not import the React layer. `kg/react/use-timeline`
 * re-exports it, so every existing importer is unaffected.
 */
export type TimelineDraft = Omit<
  TimelineItem,
  'id' | 'allDay' | 'remind' | 'urgency' | 'applicationIds'
> &
  Partial<Pick<TimelineItem, 'allDay' | 'remind' | 'urgency' | 'applicationIds'>>

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
  /** A colour off the spectrum. See `Label.ink`, which this is projected into. */
  ink?: Hex
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
  /**
   * The formatting over `note`. See `ApplicationProps.noteFormat`, whose rules
   * this shares exactly — one module owns what a span is, for all three fields
   * that carry them.
   *
   * The vault's list still prints `note` as plain text, and that is the point
   * of keeping formatting beside the text rather than inside it: the row, the
   * search index and anything a model is shown read the string, and only the
   * drawer that drew the formatting reads the spans.
   */
  noteFormat?: NoteSpan[]

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
   * different facts, and collapsing either into the other would lose the one
   * distinction that decides whether a document is still reachable after a
   * reinstall — a `path` that survives one against a `uri` that does not.
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

  /**
   * What a model read off this posting, kept so it is not read again.
   *
   * ## Why this is stored at all
   *
   * `use-read-fit.ts` held it in a module Map and said, in writing, that it
   * must not survive a reload. That was wrong in the way a person notices: the
   * fit panel re-read the posting on every refresh, so opening the same
   * application twice in a morning spent two model calls and fifteen seconds to
   * arrive back at the answer it already had. A cache whose only invalidation
   * is losing the tab is not an invalidation strategy; it is an outage every
   * time the tab is closed.
   *
   * ## Why it is not a derived value
   *
   * The rule above this file's props says no derived value goes on disk, and a
   * derived value is one `project.ts` could recompute from what is stored.
   * Nothing can recompute this: it took a non-deterministic model call over
   * bytes the graph deliberately does not hold. It is an OBSERVATION — the
   * same category as `background` (a model's reading of a CV), `claim`, and
   * `ThreadProps.context` (a model's summary, stored on the thread it
   * summarises beside its own watermark). What stays derived is the SCORE:
   * `assess` and `guidanceFrom` still run on every render, so recording a new
   * publication moves the verdict without asking a model anything.
   *
   * ## Why it lives on the file rather than on the application
   *
   * Because it is a fact about the posting, not about the job hunt. Two
   * applications to the same listing weigh themselves against one reading, and
   * the panel already says which document it measured against. Storing it here
   * also means it is deleted when the document is — `tx.del` takes the props
   * with it — and that re-capturing a posting mints a NEW file id, so a stored
   * reading can never silently describe a page it was not read from: the id
   * the panel asks about has moved on, and the old reading is simply not found.
   */
  reading?: PostingReading
}

/**
 * One thing a posting asks for, as a reader would state it.
 *
 * Declared here rather than in `core/assess.ts`, which owned it until it became
 * a stored shape — everything that goes on disk is described in this file, and
 * a type that is half in the scorer and half in the store is one nobody can
 * check against `NODE_PROP_SCHEMAS`. `assess.ts` re-exports it, so every reader
 * of the scorer still finds it where it expects to.
 */
export type Requirement = {
  /** The phrase from the posting: 'distributed systems', 'PhD in CS'. */
  readonly text: string
  /**
   * Whether the posting states this as required or preferred.
   *
   * Weighted differently by `assess`, because missing a "must have" and missing
   * a "nice to have" are not the same news.
   */
  readonly essential: boolean
}

/**
 * How many requirements are worth having.
 *
 * A posting that yields forty is one where the model has started listing
 * sentences, and `assess` would then divide a real score across thirty pieces
 * of boilerplate. Twelve is more than any posting genuinely asks for and few
 * enough that the gap list stays readable.
 *
 * Here rather than in `agent/read-requirements.ts`, which owned it: it stopped
 * being only the reader's ceiling the day a reading went on disk, and the trust
 * boundary that has to enforce it — `NODE_PROP_SCHEMAS` in `core/validate.ts` —
 * may not import from `agent`. The reader re-exports it.
 */
export const MAX_REQUIREMENTS = 12

/**
 * The longest a requirement phrase may be.
 *
 * A cap on the STORE, and `read-requirements.ts` applies the same one so a
 * reply can never produce a reading the store refuses — a schema refusal is
 * all-or-nothing, so one 300-character entry would throw away the other eleven
 * and the model call that found them. Two hundred characters is longer than any
 * real requirement and shorter than the paragraph a model writes when it has
 * started paraphrasing.
 */
export const MAX_REQUIREMENT_TEXT = 200

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

/* ----------------------------- note formatting ---------------------------- */

/**
 * The sizes a note may be written in. Normal is the ABSENCE of a size.
 *
 * Names rather than the 1–7 scale `execCommand('fontSize')` speaks, because the
 * scale is an implementation detail of one browser API and this is stored on
 * somebody's record for years. The editor's four buttons map onto these three
 * plus normal.
 */
export const NOTE_SIZES = ['small', 'large', 'huge'] as const
export type NoteSize = (typeof NOTE_SIZES)[number]

/**
 * One formatted stretch of an application's note.
 *
 * Half-open `[start, end)` over the UTF-16 code units of `note`, which is the
 * unit JavaScript slices in — so a boundary is snapped outward past a surrogate
 * pair rather than splitting an emoji in half.
 *
 * The flags are `?: true` and never `boolean`, so formatting that is equal has
 * exactly ONE spelling on disk. D12 compares whole records, and `{ bold: false }`
 * beside `{}` would be two bytes for one meaning and an undo that looked like a
 * change.
 *
 * `colour` is a `LabelTone` NAME. `ink` is the same field for a colour off the
 * spectrum, and the pair works exactly as `Label.tone`/`Label.ink` does: the
 * name is the fallback, the hex wins when it is there.
 *
 * This comment used to end "never a hex", and the reasoning behind that line
 * is kept because it is right: nothing about a note's formatting may be a
 * string a renderer could be talked into interpreting. What changed is how
 * that is enforced. An enum is one way to guarantee a value is inert; a parser
 * that accepts '#rgb' and '#rrggbb' and refuses every other string is another,
 * and it is the one `s.hexColor` implements — at the tool boundary and again
 * on the way back from a backup, where a bad value is stripped rather than
 * rendered. Sixteen million possible values, all of them six hex digits, none
 * of them `url(...)`.
 */
export type NoteSpan = {
  readonly start: number
  readonly end: number
  readonly bold?: true
  readonly italic?: true
  readonly underline?: true
  readonly strike?: true
  readonly colour?: LabelTone
  /** A colour off the spectrum. Wins over `colour` when both are there. */
  readonly ink?: Hex
  readonly size?: NoteSize
}

/**
 * How much formatting one note may carry.
 *
 * Judgement rather than measurement. Two hundred runs is far past what anybody
 * writes by hand and is the point at which a pasted web page is being stored as
 * formatting rather than as a note.
 */
export const MAX_NOTE_SPANS = 200

/**
 * One model's reading of one posting, and enough about it to be doubted.
 *
 * Every field beside `requirements` is here so the panel can say where the
 * answer came from rather than presenting it as a fact of nature. That is the
 * price of persisting it: a reading that outlives its session has to carry the
 * means of noticing it is old, because a reload is no longer doing that job.
 *
 * There is no fingerprint of the document beside them, and that is deliberate
 * rather than an omission. A re-captured posting mints a NEW file id, so the
 * common way a page changes takes the reading out of reach on its own. What is
 * left is one narrow path — bytes evicted from the blob store, then refilled
 * from a different file with the same name — and nothing in the graph can see
 * it: `FileProps.hash` is declared and written by nobody, and a check against a
 * field nothing writes is a check that never fires, which is the failure the
 * never-written `FROM` edge on `match` already recorded. When the folder port
 * starts writing hashes, `staleOf` in `core/fit-reading.ts` is where the
 * comparison goes.
 *
 * `clearedAt` is the tombstone, and it is why this is not simply deleted when
 * somebody discards it. `pipeline.proposal.sweep` learned this the hard way —
 * deleting the row was amnesia, and the queue refilled with what the person had
 * just turned down. Here the amnesia is worse than a refill: the panel reads a
 * posting automatically when it finds no reading, so a delete that left nothing
 * behind would start a fresh model call on the very next render, and the button
 * would look broken. Cleared keeps the row, empties it, and tells the panel a
 * person has already answered this question.
 */
export type PostingReading = {
  /**
   * What the posting asks for. Capped at `MAX_REQUIREMENTS` by the reader, so
   * this is a dozen short phrases and not the page — D27 is intact, and the
   * argument in `posting-source.ts` against storing the posting TEXT (40k of
   * somebody else's prose in every `getAll('nodes')`) does not reach a list
   * this size.
   *
   * Empty when `clearedAt` is set: discarding the answer discards the answer.
   */
  requirements: Requirement[]
  /**
   * The model that read it — 'gemma_4_31b'. Shown, never used to decide
   * anything on its own.
   *
   * The name only. Not the endpoint, which is a fact about a machine rather
   * than about this reading, and never the key: `core/provider.ts` says where
   * that must not go, and the graph is the first place it names.
   */
  model: string
  /** When it was read, from `ctx.now`. */
  readAt: Instant
  /**
   * How many lines the reader could not use, when any.
   *
   * `readRequirements` has always returned this and every caller threw it away.
   * "Four of sixteen were skipped" is exactly the kind of thing a person wants
   * when a verdict reads lower than they expected, and it costs one number.
   */
  skipped?: number
  /**
   * Set when the person discarded the reading. See the note above on why the
   * row survives being deleted.
   *
   * Optional, so every file written before this field existed reads back as a
   * document nobody has cleared — which is what it was.
   */
  clearedAt?: Instant
}

export type SnippetProps = {
  slug: string
  title: string
  tag: SnippetTag
  /**
   * Plain text — with one exception. A snippet a model TAILORED carries inline
   * marks in the four spellings `core/marks.ts` reads (`**changed**`,
   * `_reworded_`, `__moved up__`, `## heading`), so the person can see what was
   * altered for the posting. Only a body whose record carries `tailored` is
   * read that way; a hand-written snippet with an underscore in it stays what
   * it is. Copy strips the marks.
   */
  body: string
  /**
   * The formatting over `body`, as offsets into it. Same shape and same rules
   * as an application's `noteFormat` — `core/note-format.ts` is the only thing
   * that decides what a well-formed list of spans is, for every field carrying
   * them.
   *
   * Offsets into the STORED string, marks and all. A tailored body carries
   * `**changed**` as characters, and the spans are measured over the text as it
   * is stored rather than as `core/marks.ts` displays it — so neither mechanism
   * has to know about the other. What that costs, said plainly: formatting
   * applied across a `**` pair is measured against characters that Copy strips,
   * and Copy takes plain text anyway.
   */
  bodyFormat?: NoteSpan[]
  /** Set when a model wrote this for one posting. See `TailoredFrom`. */
  tailored?: TailoredFrom
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
  /**
   * Answered, and cleared off the queue — but still remembered.
   *
   * `pipeline.proposal.sweep` used to DELETE these rows, and once the scout
   * started deduping against every proposal rather than only the pending ones,
   * that delete became a hole: pressing Clear forgot which jobs the person had
   * already turned down, and the next round proposed them again. The button
   * meant to empty the queue refilled it.
   *
   * So sweeping marks instead. The card goes — `use-pipelines` filters these
   * out and no screen ever sees one — and the record stays where
   * `knownPostings` can still read it. A discarded suggestion is the strongest
   * evidence there is that a job should not be offered again, and it was the
   * one piece of evidence being thrown away.
   *
   * Optional, so every proposal written before this field existed reads back as
   * unswept, which is what it was.
   */
  swept?: boolean
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
  /**
   * Something said mid-run, and `app` says by whom.
   *
   * Absent (the default) means the MODEL said it — narration while it works,
   * "let me look that up" — and `toTranscript` replays it as assistant speech,
   * which is what it was.
   *
   * `app: true` means this app said it: the conversation was trimmed, the reply
   * hit the server's output limit. The person should see those in the
   * transcript and the model must NOT read them back as its own words. It never
   * said them, and a model that finds "I trimmed this conversation" in its own
   * prior speech will reason from it.
   */
  | { kind: 'note'; text: string; app?: true }
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
  /**
   * How much this conversation is allowed to do without being asked.
   *
   * Three modes rather than a switch, because the switch had two settings and
   * three meanings. `autoApprove: true` mapped to the `destructive` gate — stop
   * for the fifteen tools that delete — which is neither "ask me about
   * everything" nor "act freely", and its label said only "act without asking".
   * Measured, that gap matters: both reasoning models in the benchmark close a
   * LIVE application when asked to close an ambiguous one, and a stage change
   * is a `move`, not a delete, so the old auto setting waved it through.
   *
   * `autoApprove` above is kept for conversations written before this existed
   * and is read only as a fallback — see `approvalOf`. Nothing writes it now.
   */
  approval?: ApprovalMode
  /**
   * What this conversation established, for the part of it no longer sent.
   *
   * A long chat outgrows the model's window, and the alternative to dropping
   * the beginning is remembering it in one line instead of forty. This is that
   * line: written when a compaction happens, carried on the THREAD so it
   * survives a reload and is not recomputed on every turn, and put in front of
   * the messages the model sees.
   *
   * Absent on every conversation that has never needed one, which is almost all
   * of them — one that fits is left exactly as it is, byte-identical, which is
   * also what keeps the provider's prefix cache warm.
   *
   * NOT shown in the transcript. A person can scroll up and read what actually
   * happened; this exists for the model, which cannot.
   */
  context?: string
  /**
   * How many entries `context` already accounts for.
   *
   * Without it a second compaction would summarise the same early exchanges
   * again — a summary of a summary — and each pass would blur what the last had
   * already blurred. This says where the summarised part ends, so the next
   * compaction starts at the first entry the summary does not cover.
   */
  contextThrough?: number
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
/**
 * The kinds of fact a CV yields about the person whose CV it is.
 *
 * ONE node type with a kind, rather than seven types, and the precedent is
 * `timelineItem` — which is a deadline, an interview and a reminder under one
 * roof because they share a shape and differ in a word. These share a shape
 * too: a thing you did, somewhere, between two dates, that a hiring committee
 * might care about.
 *
 * Seven separate types would each need a schema, a projection, an id prefix, an
 * analytics bucket and a screen, and would still be joined by an OR in every
 * query that asked "what has this person got". The discriminator is cheaper and
 * says the same thing.
 */
/**
 * The kinds of fact a CV states about a person.
 *
 * ## Why there are fourteen and not seven
 *
 * There were seven, and the seven were a silent filter. `readCv` drops any row
 * whose kind is not in this list, so a model correctly reading "AWS Certified
 * Solutions Architect", "German — C1", "openbench, 2k stars" or "US11234567B2"
 * had every one of them discarded on the way into the graph. The extraction was
 * right; the vocabulary could not hold it. Measured on a realistic reply, seven
 * of eight rows were lost.
 *
 * The list is now the union of what JSON Resume models — work, education,
 * skills, awards, certificates, publications, languages, volunteer, projects —
 * and what an academic CV additionally carries: teaching, service, grants and
 * patents. Those four have no equivalent in a developer-CV schema and are the
 * bulk of the evidence for anybody applying to a university.
 *
 * ## The two pairs that look redundant and are not
 *
 * `service` is academic service — reviewing, programme committees, editorial
 * work — and it is a professional credential. `volunteering` is unpaid work in
 * the world, which is a different claim about a person and reads differently to
 * a hiring committee. Collapsing them would file a stint at a food bank as a
 * qualification.
 *
 * `award` is a prize; `grant` is money won to do work with. For a researcher
 * the second is the one a search committee counts, and a schema that merged
 * them would make a £2M fellowship indistinguishable from a best-poster ribbon.
 */
export const BACKGROUND_KINDS = [
  'education',
  'employment',
  'publication',
  'skill',
  'teaching',
  'award',
  'service',
  'certification',
  'language',
  'project',
  'volunteering',
  'membership',
  'grant',
  'patent',
  'leadership',
  'outreach',
  'training',
  /*
   * The catch-all, and it is the most important entry in the list.
   *
   * The seven-kind version of this vocabulary was a SILENT FILTER: `readCv`
   * drops any row whose kind is not here, so a certification, a language, a
   * patent and a society membership were each extracted correctly and then
   * discarded on the way in. Measured on a realistic reply, one row of eight
   * survived.
   *
   * Widening the list fixed those eight. It cannot fix the ninth. Somebody's CV
   * has a section nobody here thought of — a portfolio of exhibitions, a list
   * of translations, military service — and a closed vocabulary loses it in
   * exactly the same silent way.
   *
   * So this is the open lane, the same shape `core/ontology.ts` gives relations
   * for the same reason: a fact filed under an unfamiliar name is honest and
   * still findable, and a fact dropped is gone with nothing on screen to say so.
   * The prompt asks the model to name what it is in `detail`.
   */
  'other',
] as const
export type BackgroundKind = (typeof BACKGROUND_KINDS)[number]

/**
 * The order a background reads in, and what each kind is called.
 *
 * Here rather than in each app's panel, where it was written twice. It is data
 * about the vocabulary — not layout — and two copies is two chances for a kind
 * added above to be rendered by one platform and silently dropped by the other,
 * leaving entries in the graph with nowhere to see or delete them.
 *
 * NOT the declaration order above, which is the order the list was extended in.
 * This is the order a CV prints: what you studied, what you have held, what
 * came out of it. It is what a reader expects because it is what every CV they
 * have read used.
 *
 * `Record<BackgroundKind, …>` on the label map and a length assertion in the
 * test on the order: between them a new kind cannot be added without both being
 * updated.
 */
export const BACKGROUND_ORDER: readonly BackgroundKind[] = [
  'education',
  'employment',
  'publication',
  'patent',
  'grant',
  'award',
  'teaching',
  'service',
  'project',
  'leadership',
  'outreach',
  'certification',
  'training',
  'skill',
  'language',
  'volunteering',
  'membership',
  // Last, always. It is what did not fit the headings above it, so it reads
  // as a footnote rather than as a category somebody chose.
  'other',
]

/** Plural, because every one of these heads a list. */
export const BACKGROUND_LABEL: Readonly<Record<BackgroundKind, string>> = {
  education: 'Education',
  employment: 'Employment',
  publication: 'Publications',
  patent: 'Patents',
  grant: 'Grants',
  leadership: 'Leadership',
  outreach: 'Outreach',
  training: 'Professional development',
  other: 'Other',
  award: 'Awards',
  teaching: 'Teaching',
  service: 'Service',
  project: 'Projects',
  certification: 'Certifications',
  skill: 'Skills',
  language: 'Languages',
  volunteering: 'Volunteering',
  membership: 'Memberships',
}

/**
 * One fact about the user, extracted from something they wrote.
 *
 * ## Why this exists
 *
 * The profile was ten text fields the user typed, and `fitOf` scored postings
 * against those — so somebody who had uploaded a forty-page CV got exactly as
 * good an answer as somebody who had uploaded nothing. Every fact that would
 * actually decide a fit — what they studied, where they worked, what they have
 * published, what they can teach — sat in a PDF the app could read and never
 * did.
 *
 * ## Why `source` is not optional in spirit
 *
 * It is optional in the type, because a user may type a background by hand and
 * there is no document behind that. But everything EXTRACTED carries the file
 * it came from, and that is what makes the feature trustworthy rather than
 * magical: a claim the app makes about somebody's background can be traced back
 * to the sentence in the document that produced it, and a wrong one can be
 * found and removed rather than argued with.
 *
 * ## Dates are strings, and loosely so
 *
 * A CV says "2021–2024", "Summer 2019", "since 2024" and "n.d.". Forcing those
 * into ISO dates means either refusing most of them or inventing precision
 * nobody wrote down. They are kept as the person wrote them and compared as
 * text; `frame` carries a sortable year when one can be recovered, which is
 * what the ordering actually needs.
 */
export type BackgroundProps = {
  slug: string
  kind: BackgroundKind
  /** The degree, the job title, the paper's title, the skill's name. */
  title: string
  /** University, employer, journal, conference. Free text — not an org node. */
  where?: string
  /** As written on the document: '2021–2024', 'Summer 2019', 'since 2024'. */
  period?: string
  /**
   * A four-digit year for ordering, when one can be recovered from `period`.
   *
   * Separate from `period` because the display string and the sort key are
   * different jobs, and deriving the second from the first on every render is
   * how a list ends up in a different order than the one it printed.
   */
  year?: number
  /** Anything worth keeping that is not the title — a venue, a grade, a note. */
  detail?: string
  /**
   * The bullet points under an entry: what was built, shipped, taught, found.
   *
   * ## Why this earns a field of its own rather than going in `detail`
   *
   * It is the part of a CV that answers a posting. A requirement reads "five
   * years running distributed systems in production" and the thing that
   * answers it is not the job title `Staff Engineer` or the employer
   * `Cloudflare` — it is the line underneath saying the person ran a
   * multi-region store. `assess.ts` scores by term overlap over what it is
   * given, so squashing those lines into a single optional `detail`, or
   * dropping them as the first extractor did, removed most of the evidence
   * from the one place it was needed.
   *
   * An ARRAY, not a paragraph, and JSON Resume calls it the same thing for the
   * same reason: the bullets are separately true, separately quotable in a
   * cover letter, and a screen renders them as a list. Joining them into one
   * string means every reader has to guess how to split it again.
   */
  highlights?: readonly string[]
  /**
   * Where this came from, when it was extracted rather than typed.
   *
   * The id of the `file` node. Not an edge, because an edge would be a second
   * place to look and this is a property of the claim rather than a
   * relationship anybody navigates.
   */
  source?: string
}

/**
 * One relation the graph holds, in whatever words it was proposed.
 *
 * The ends are edges (`OF` to the subject, `ABOUT` to the object) rather than
 * id properties, because they are the thing traversal walks — the whole point
 * of reifying was to make "what evidence do I have for this" a graph question.
 */
export type ClaimProps = {
  slug: string
  /**
   * The canonical predicate from `core/ontology.ts`, or the normalised surface
   * form when the taxonomy had no name for it.
   *
   * Never the raw surface: two spellings of one relation have to compare equal
   * or `core/claim.ts` cannot tell a duplicate from a new fact.
   */
  predicate: string
  /**
   * Exactly what was proposed, before canonicalising.
   *
   * Kept because it is evidence. A person looking at "BUILT" who does not
   * recognise it needs to see that the document said "contributed to" and that
   * jojo made that mapping — otherwise the claim reads as something the app
   * decided rather than something the document says.
   */
  surface: string
  /** False when the taxonomy had no name for this and it was kept open. */
  known: boolean
  /** The file this was read from. A breadcrumb, not a foreign key — see `BackgroundProps.source`. */
  source?: string
}

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

/** One fact about the user, as a screen reads it. See `BackgroundProps`. */
export type Background = {
  id: string
  kind: BackgroundKind
  title: string
  where?: string
  period?: string
  year?: number
  detail?: string
  highlights?: readonly string[]
  source?: string
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
  background: BackgroundProps
  claim: ClaimProps
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
