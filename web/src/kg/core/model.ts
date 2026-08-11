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
 * in `data/timeline.ts` documents.
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
export const TAGGABLE = ['application', 'timelineItem', 'link', 'file', 'snippet'] as const

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
    fromCardinality: 'one',
    label: 'is about',
  },
  FILED_UNDER: {
    from: ['link', 'file', 'snippet'],
    to: ['application'],
    fromCardinality: 'one',
    label: 'is filed under',
  },
  TAGS: { from: ['keyword'], to: TAGGABLE, fromCardinality: 'many', label: 'tags' },
  FROM: {
    from: ['match', 'posting'],
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

/** The same four the sources donut splits by, so the two can't drift apart. */
export const SOURCES = ['Job scout', 'Job board', 'Referral', 'Careers page'] as const
export type Source = (typeof SOURCES)[number]

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
export const ROLES = [
  'Assistant Professor',
  'Postdoc',
  'Researcher',
  'ML Engineer',
  'Lecturer',
] as const
export type RoleTag = (typeof ROLES)[number]

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
  /** The edge the old models were missing — `Application['id']`. */
  applicationId?: string
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
  /** `Application['id']`. Cleared, never followed, when that application goes. */
  applicationId?: string
}

export const FILE_BUCKET_VALUES = ['To read', 'Applications', 'Talks', 'Admin'] as const
export type FileBucket = (typeof FILE_BUCKET_VALUES)[number]

export const FILE_KIND_VALUES = ['pdf', 'doc', 'slides', 'note'] as const
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
  applicationId?: string
}

export const SNIPPET_TAG_VALUES = ['Cover letter', 'Application form', 'Email', 'Bio'] as const
export type SnippetTag = (typeof SNIPPET_TAG_VALUES)[number]

export type Snippet = {
  id: string
  title: string
  tag: SnippetTag
  body: string
  applicationId?: string
}

export type Pipeline = {
  id: string
  name: string
  source: string
  schedule: string
  filter: string
  enabled: boolean
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
  includeAcademia: boolean
  includeIndustry: boolean
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
  /** '184 KB' — a label the user reads, not a byte count. No bytes are held. */
  size: string
  savedOn: ISODate
  note?: string
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
}

export type ProfileProps = Profile

/** The one map that gives L0 and L1 their domain types without either knowing them. */
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
}

/** Everything but `profile` carries a slug, and the slug index depends on it. */
export type SluggedType = Exclude<NodeType, 'profile'>

export function hasSlug(type: NodeType): type is SluggedType {
  return type !== 'profile'
}
