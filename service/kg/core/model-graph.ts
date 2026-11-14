/**
 * L1 — ids, NODE_TYPES, RELS, StoredNode, StoredEdge, EDGE_SCHEMA.
 *
 * The rule for what earns a node: a value is a node iff the user can rename or
 * annotate it. Organisation passes. `roleTag` and `source` are closed unions
 * driving a fixed filter and a fixed legend order, so they stay props and are
 * synthesised as view-only nodes by `buildGraph`.
 *
 * The shape of the graph itself, and the map from each node type to its stored
 * props. The props live in the per-domain `model-*.ts` files beside it; all of
 * it is imported through `core/model.ts`, which re-exports every name here.
 */

import type { ApplicationProps, OrganisationProps } from './model-application'
import type { KeywordProps, StickyNoteProps } from './model-label'
import type { PersonProps } from './model-person'
import type { BackgroundProps, ClaimProps, ProfileProps } from './model-profile'
import type { MatchProps, PipelineProps, PostingProps, ProposalProps } from './model-scout'
import type { ThreadProps } from './model-thread'
import type { TimelineItemProps } from './model-timeline'
import type { FileProps, LinkProps, SnippetProps } from './model-vault'

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
   * A sticky note on the dashboard's board: something the person wants in
   * front of them for a while — "ask Maria about the visa letter", a phone
   * number, a half-formed thought — and not yet anything more structured.
   *
   * Its own type rather than a snippet with a special tag, because a snippet is
   * reusable text for forms and a sticky is the opposite: short-lived, owned by
   * nobody else, and thrown away when done. Filed under nothing; when one turns
   * out to have a date, it becomes a reminder, which is the structured shape
   * for that.
   */
  'stickyNote',
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
    // A person's edge may carry `{ role }` — recommender or point of contact on
    // THAT job (`ContactRole`). The only edge attribute in the graph so far, and
    // the reason `fileUnder` in `tools/vault-shared.ts` keeps props across a refiling.
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
  person: PersonProps
  stickyNote: StickyNoteProps
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
