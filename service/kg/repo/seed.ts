/**
 * L2 — seedToGraph(): the src/data fixtures compiled to nodes and edges.
 *
 * The fixtures stay verbatim — readable and diffable — and are resolved through a
 * slug -> id table in a single pass, so `applicationId`, `org` and
 * `labelsByRecord` all land as real edges.
 *
 * WHO CALLS THIS, WHICH IS NOT WHAT THIS HEADER USED TO CLAIM
 *
 * It said this was the only place `src/data` is read and that it was reached by
 * exactly one tool, `memory.reset`. Neither half is true. Several modules under
 * `kg` import `@/data` for a fixture that is not the seed — the label
 * palette, the stage list, the seed's timeline helpers — and `memory.reset`
 * does not call this at all: it holds a SECOND compiler over the same fixture
 * arrays, which `tools/memory.ts` names in its own header as the thing to
 * reconcile. The real callers are `boot.ts` (a first run, and every in-memory
 * session) and `lib/data-set.ts` (Settings' "Load demo data"). Those two agree
 * because they are one function; `memory.reset` is the one that can drift.
 *
 * Three things the compiler does that are worth knowing before changing it:
 *
 * - The fixture's own id becomes the node's `slug`, never its `NodeId`. Six
 *   records in the seed answer to 'stripe' — an application, a deadline, a
 *   pipeline, a saved posting and two more — and the whole reason for the
 *   prefixed UUID is that 'stripe' cannot say which. Slug uniqueness is per
 *   [type, slug], so all six keep the name they had.
 * - **Every authored date is shifted by one whole-day offset**, the gap between
 *   `SEED_TODAY` — the day the fixtures were written against — and the day the
 *   seed is being written on. Before this the dates went in verbatim, which was
 *   invisible for as long as the store died on reload and became the first thing
 *   a new user saw once it did not: a demo opened in 2027 showed an October
 *   eight months gone, twelve overdue deadlines, an offer that expired last
 *   spring and a "This week" panel with nothing in it. One shift, applied to all
 *   of them, is the only rebase that preserves what the fixtures encode — "the
 *   reply came three weeks after the submission", "this deadline lands on the
 *   Monday the week strip opens with". Regenerating each date against today
 *   would produce twelve individually plausible dates telling no story at all.
 * - `daysAgo` is compiled to `lastActionAt = now - daysAgo days`, because the
 *   count is derived now (D25). It was already relative and needs no shift: the
 *   fixture means "this many days before today", which was `SEED_TODAY - daysAgo`
 *   when the offset was zero and is the same distance from the same day now.
 * - A `labelsByRecord` key that resolves to nothing is REPORTED, never dropped.
 *   The map is a flat namespace over five kinds of record, and a key that
 *   silently matched nothing would have been a keyword the user set and cannot
 *   see, count or remove.
 */

import { seedLabels, seedLabelsByRecord } from '../../data/labels'
import { seedProfile } from '../../data/profile'
import {
  matches as seedMatches,
  pipelines as seedPipelines,
  savedPostings as seedPostings,
} from '../../data/scout'
import { applications as seedApplications } from '../../data/seed'
import { addDays, seedOffset, timeline as seedTimeline } from '../../data/timeline'
import {
  snippets as seedSnippets,
  vaultFiles as seedFiles,
  vaultLinks as seedLinks,
} from '../../data/vault'
import type {
  ApplicationProps,
  FileProps,
  ISODate,
  Instant,
  KeywordProps,
  LinkProps,
  MatchProps,
  NodeId,
  NodePropsByType,
  NodeType,
  PipelineProps,
  PostingProps,
  Rel,
  SnippetProps,
  StoredEdge,
  StoredNode,
  TimelineItemProps,
} from '../core/model'
import { dayOf } from '../core/project'
import { edgeId, newNodeId, slugify, uniqueSlug } from '../core/ref'

export type SeedGraph = {
  nodes: readonly StoredNode[]
  edges: readonly StoredEdge[]
  /**
   * Fixture references that resolved to nothing. Empty for the shipped seed —
   * it is a test assertion, not a runtime branch.
   */
  unresolved: readonly string[]
}

const DAY_MS = 86_400_000

/**
 * Every node in the seed is created at one instant, and every id is minted from
 * it. `uuidv7`'s monotonic counter is what orders them inside that millisecond,
 * so "id-ascending" still means "the order this function wrote them in" — which
 * is the order the fixtures are authored in, which is the order the lists render.
 */
export function seedToGraph(now: Instant): SeedGraph {
  const atMs = Date.parse(now)
  const nodes: StoredNode[] = []
  const edges: StoredEdge[] = []
  const unresolved: string[] = []

  /**
   * The rebase. Whole days from the day the fixtures were written to today.
   *
   * Computed once, from the SAME instant every node is stamped with, so the
   * shift and the timestamps cannot land on different days — a seed run at
   * 23:59:59 that read the clock twice would otherwise date half the graph
   * yesterday.
   */
  const shift = seedOffset(dayOf(now))

  /**
   * Authored date in, rebased date out. `undefined` in, `undefined` out.
   *
   * The keys it is applied to are named at each call site rather than sniffed
   * out of the props, because a fixture's `size` is '184 KB' and its `comp` is
   * '$180k' and a walker looking for things that parse as dates is one plausible
   * string away from moving one of them. Nine fields carry a date; they are
   * listed, and a tenth added to the model without a line here is a date that
   * quietly stays in 2026.
   */
  const on = (iso: ISODate): ISODate => (shift === 0 ? iso : addDays(iso, shift))

  /**
   * The same, over the optional date keys of a spread rest object.
   *
   * It assigns only where a string is already present, so an absent
   * `firstReplyOn` stays ABSENT rather than becoming an explicit `undefined`.
   * That distinction survives structured clone, and `'firstReplyOn' in props`
   * answering yes for an application nobody has heard back from is the same bug
   * the `completedOn` handling below spells out at length.
   */
  function shiftDates<T extends object>(props: T, keys: readonly (keyof T)[]): T {
    const out = { ...props }
    for (const key of keys) {
      const value = out[key]
      if (typeof value === 'string') out[key] = on(value) as T[keyof T]
    }
    return out
  }

  /** '<type>:<slug>' -> NodeId. The single pass the whole compiler runs on. */
  const byRef = new Map<string, NodeId>()
  const slugsOf = new Map<NodeType, Set<string>>()

  function add<T extends NodeType>(type: T, slug: string, props: NodePropsByType[T]): NodeId {
    const id = newNodeId(type, atMs)
    nodes.push({ id, type, props, createdAt: now, updatedAt: now } as StoredNode)
    byRef.set(`${type}:${slug}`, id)
    return id
  }

  /**
   * Minted through `uniqueSlug` against the slugs already taken WITHIN the type.
   *
   * The fixtures do not collide today, but the organisation nodes are derived
   * from free text ('UT Austin', 'Texas A&M') rather than authored, so two
   * employers whose names slugify the same way would otherwise have produced one
   * node with two applications' worth of meaning attached to it.
   */
  function mintSlug(type: NodeType, base: string): string {
    let taken = slugsOf.get(type)
    if (!taken) {
      taken = new Set<string>()
      slugsOf.set(type, taken)
    }
    const slug = uniqueSlug(base, taken)
    taken.add(slug)
    return slug
  }

  const link = (from: NodeId, rel: Rel, to: NodeId) => {
    edges.push({ id: edgeId(from, rel, to), rel, from, to, props: {}, createdAt: now })
  }

  /* ------------------------------ organisations ----------------------------- */

  /**
   * Created on first mention rather than from a list of their own.
   *
   * The fixtures have no organisations in them — `org` is a string on each
   * application — so the employer only becomes a record the user can annotate at
   * the moment an application names it.
   */
  const orgIds = new Map<string, NodeId>()
  function orgFor(name: string): NodeId {
    const existing = orgIds.get(name)
    if (existing) return existing
    const slug = mintSlug('organisation', slugify(name))
    const id = add('organisation', slug, { slug, name })
    orgIds.set(name, id)
    return id
  }

  /* ------------------------------ applications ------------------------------ */

  for (const application of seedApplications) {
    const { id: fixtureId, org, daysAgo, ...rest } = application
    const slug = mintSlug('application', fixtureId)
    const dated = shiftDates(rest, ['appliedOn', 'submittedOn', 'firstReplyOn'])
    const props: ApplicationProps = {
      ...dated,
      // The offer's deadline is one level down and `shiftDates` is deliberately
      // shallow — a generic deep walk over props is the thing that would have
      // reached into a note and rewritten a date the user typed into prose.
      ...(dated.offer ? { offer: { ...dated.offer, respondBy: on(dated.offer.respondBy) } } : {}),
      slug,
      lastActionAt: new Date(atMs - daysAgo * DAY_MS).toISOString(),
    }
    const id = add('application', slug, props)
    link(id, 'AT', orgFor(org))
  }

  /* -------------------------------- timeline -------------------------------- */

  for (const item of seedTimeline) {
    const { id: fixtureId, allDay: _allDay, applicationId, completedOn, ...rest } = item
    const slug = mintSlug('timelineItem', fixtureId)
    // `allDay` is dropped, not stored: it is `startMins === undefined` and was
    // the same fact written twice, which is one write site away from an item
    // that is all-day and has a start time.
    // `completedOn` is narrowed rather than spread: the domain type spells it
    // `string | null` because null is how the reducer reopened an item, and an
    // explicit null survives structured clone — so `'completedOn' in props`
    // would answer yes for something nobody has completed.
    const props: TimelineItemProps = completedOn
      ? { ...rest, slug, date: on(rest.date), completedOn: on(completedOn) }
      : { ...rest, slug, date: on(rest.date) }
    const id = add('timelineItem', slug, props)
    if (applicationId) {
      const target = byRef.get(`application:${applicationId}`)
      if (target) link(id, 'ABOUT', target)
      else unresolved.push(`timelineItem:${fixtureId} -> application:${applicationId}`)
    }
  }

  /* ---------------------------------- vault --------------------------------- */

  /**
   * Links, files and snippets differ only in their props, so the FILED_UNDER
   * half is written once. No fixture carries an `applicationId` today, which is
   * why the seeded graph has no FILED_UNDER edges at all — the branch exists for
   * a store the user has actually filed things in, and for the round-trip test
   * to keep proving that "unlink, never cascade" has something to unlink.
   */
  function filed<T extends 'link' | 'file' | 'snippet'>(
    type: T,
    fixtureId: string,
    applicationId: string | undefined,
    props: NodePropsByType[T],
  ) {
    const id = add(type, props.slug, props)
    if (!applicationId) return
    const target = byRef.get(`application:${applicationId}`)
    if (target) link(id, 'FILED_UNDER', target)
    else unresolved.push(`${type}:${fixtureId} -> application:${applicationId}`)
  }

  for (const record of seedLinks) {
    const { id: fixtureId, applicationId, ...rest } = record
    const props: LinkProps = {
      ...rest,
      slug: mintSlug('link', fixtureId),
      savedOn: on(rest.savedOn),
    }
    filed('link', fixtureId, applicationId, props)
  }

  for (const record of seedFiles) {
    const { id: fixtureId, applicationId, ...rest } = record
    const props: FileProps = {
      ...rest,
      slug: mintSlug('file', fixtureId),
      savedOn: on(rest.savedOn),
    }
    filed('file', fixtureId, applicationId, props)
  }

  for (const record of seedSnippets) {
    const { id: fixtureId, applicationId, ...rest } = record
    const props: SnippetProps = { ...rest, slug: mintSlug('snippet', fixtureId) }
    filed('snippet', fixtureId, applicationId, props)
  }

  /* ---------------------------------- scout --------------------------------- */

  for (const pipeline of seedPipelines) {
    const { id: fixtureId, ...rest } = pipeline
    const slug = mintSlug('pipeline', fixtureId)
    const props: PipelineProps = { ...rest, slug }
    add('pipeline', slug, props)
  }

  /**
   * BECAME, not FROM. A promotion is the edge the fixtures carry — `linked` on a
   * posting and `applicationId` on a match are the same fact spelled twice — and
   * FROM would need a pipeline reference the fixtures have never had. Inventing
   * one to make the graph look connected would put data in the demo that no
   * screen ever showed.
   */
  for (const posting of seedPostings) {
    const { id: fixtureId, linked: _linked, applicationId, ...rest } = posting
    const slug = mintSlug('posting', fixtureId)
    const props: PostingProps = { ...rest, slug, savedOn: on(rest.savedOn) }
    const id = add('posting', slug, props)
    if (!applicationId) continue
    const target = byRef.get(`application:${applicationId}`)
    if (target) link(id, 'BECAME', target)
    else unresolved.push(`posting:${fixtureId} -> application:${applicationId}`)
  }

  for (const match of seedMatches) {
    const { id: fixtureId, applicationId, ...rest } = match
    const slug = mintSlug('match', fixtureId)
    const props: MatchProps = { ...rest, slug }
    const id = add('match', slug, props)
    if (!applicationId) continue
    const target = byRef.get(`application:${applicationId}`)
    if (target) link(id, 'BECAME', target)
    else unresolved.push(`match:${fixtureId} -> application:${applicationId}`)
  }

  /* --------------------------------- keywords -------------------------------- */

  for (const label of seedLabels) {
    const { id: fixtureId, ...rest } = label
    const slug = mintSlug('keyword', fixtureId)
    const props: KeywordProps = { ...rest, slug }
    add('keyword', slug, props)
  }

  /**
   * Where a keyword sits is looked up by slug across four types in a fixed order.
   *
   * `seedLabelsByRecord` is one flat map over reminders, applications, links,
   * files and snippets, keyed by whatever id each list happened to use —
   * applications as 'app:rice' because theirs collide with five other lists,
   * everything else bare. That dual spelling is the bug D14 deletes, so it is
   * read once, here, and never written again.
   */
  const TAG_TARGETS: readonly NodeType[] = ['timelineItem', 'link', 'file', 'snippet']

  function recordFor(key: string): NodeId | undefined {
    if (key.startsWith('app:')) return byRef.get(`application:${key.slice('app:'.length)}`)
    for (const type of TAG_TARGETS) {
      const id = byRef.get(`${type}:${key}`)
      if (id) return id
    }
    return undefined
  }

  for (const [recordKey, labelIds] of Object.entries(seedLabelsByRecord)) {
    const record = recordFor(recordKey)
    if (!record) {
      if (labelIds.length > 0) unresolved.push(`labelsByRecord:${recordKey}`)
      continue
    }
    for (const labelId of labelIds) {
      const keyword = byRef.get(`keyword:${labelId}`)
      if (keyword) link(keyword, 'TAGS', record)
      else unresolved.push(`labelsByRecord:${recordKey} -> keyword:${labelId}`)
    }
  }

  /* --------------------------------- profile -------------------------------- */

  /**
   * The one node with no slug. It is a singleton — there is nothing for it to be
   * unique against — which is why the [type, slug] index is sparse.
   */
  const profileId = newNodeId('profile', atMs)
  nodes.push({
    id: profileId,
    type: 'profile',
    props: seedProfile(),
    createdAt: now,
    updatedAt: now,
  })
  byRef.set('profile:', profileId)

  return { nodes, edges, unresolved }
}
