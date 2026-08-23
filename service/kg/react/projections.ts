/**
 * L4 — the domain projectors: StoredNode -> the record a card receives.
 *
 * §2 gives these no home of their own. `core/project.ts` is the cache and the
 * factory and deliberately knows nothing about applications; the projectors
 * themselves belong to whichever layer binds the clock, because `daysAgo` is
 * only correct for as long as "today" is. That layer is this one — which is the
 * honest shape of the problem, and is precisely why `daysAgo` could never be
 * right while it was a stored field.
 *
 * What leaves storage and is computed here (D25):
 *
 * - `daysAgo` — was stored and zeroed on every edit, and has only ever been
 *   right because a reload wiped it. On disk it starts lying on the second
 *   launch and says "1 day ago" about something done last March.
 * - `linked` — a `BECAME` edge rendered as a boolean, which needed four write
 *   sites to stay honest and lost one of them on the delete path.
 * - `allDay` — `startMins === undefined`, written down twice, so a card that
 *   cleared the start time without flipping the boolean produced an all-day
 *   item with a start time.
 * - `applicationId` and `org` — pointers. The edge is the storage; the scalar
 *   field is the projection of it.
 *
 * Every projection is keyed on `epoch(id)`, so one edit re-projects one row and
 * every other row keeps referential identity. That is what makes `React.memo`
 * hold on a board of sixty cards.
 */

import { compareItems, daysBetween } from '../core/dates'
import { emptyProfile } from '../core/profile'
import type {
  Application,
  ISODate,
  Label,
  Match,
  NodeId,
  Pipeline,
  Profile,
  Proposal,
  SavedPosting,
  Snippet,
  StoredNode,
  TimelineItem,
  VaultFile,
  VaultLink,
} from '../core/model'
import { createOneProjection, createProjection, dayOf } from '../core/project'
import type { GraphSnapshot } from '../core/snapshot'

/** A projected list, and the single-record read the detail routes need. */
type List<R> = (g: GraphSnapshot) => readonly R[]
type One<R> = (g: GraphSnapshot, id: NodeId) => R | undefined

export type Projections = {
  applications: List<Application>
  application: One<Application>
  timeline: List<TimelineItem>
  links: List<VaultLink>
  files: List<VaultFile>
  snippets: List<Snippet>
  postings: List<SavedPosting>
  matches: List<Match>
  pipelines: List<Pipeline>
  proposals: List<Proposal>
  keywords: List<Label>
  profile: (g: GraphSnapshot) => Profile
}

/** The application an edge of this kind points at, as an id. Absent, not null. */
const pointing = (id: NodeId | undefined) => (id === undefined ? {} : { applicationId: id })

/**
 * Every application a record is joined to, by one relation.
 *
 * A list because both relations are `fromCardinality: 'many'` now. Always an
 * array, empty when there are none: a caller that has to distinguish `undefined`
 * from `[]` from `['']` is a caller that will get one of the three wrong.
 */
const joinedTo = (g: GraphSnapshot, id: NodeId, rel: 'FILED_UNDER' | 'ABOUT') => ({
  // 'out' because both relations are spelled from the record TO the application
  // — a file is filed under a job, an item is about one.
  applicationIds: g.many(id, rel, 'out', 'application').map((a) => a.id),
})

const filedUnder = (g: GraphSnapshot, id: NodeId) => joinedTo(g, id, 'FILED_UNDER')

const became = (g: GraphSnapshot, id: NodeId) => g.one(id, 'BECAME', 'application')?.id

/**
 * Built per `today` rather than once at module load.
 *
 * The cache is keyed on epoch and nothing else, so a projector closing over a
 * day is correct only for as long as that day is. Rebuilding the whole set when
 * the day turns is the caller's job and it is one `useMemo` — the alternative,
 * a projector that read the clock itself, is a cache that silently serves
 * yesterday's answer and cannot be tested at all.
 */
export function createProjections(today: ISODate): Projections {
  const projectApplication = (n: StoredNode<'application'>, g: GraphSnapshot): Application => {
    // `slug` is kept, unlike everywhere else below. It was dropped in Wave 1
    // because nothing read it, and the consequence was that `appPath` had only
    // the per-session id to build a link out of — so every URL in the address
    // bar died on reload. It is a STORED prop, not a derived one, so passing it
    // through is not the thing D25 forbids.
    const { lastActionAt, ...rest } = n.props
    return {
      ...rest,
      id: n.id,
      org: g.one(n.id, 'AT', 'organisation')?.props.name ?? '',
      // The LOCAL calendar day of the instant, not `slice(0, 10)`.
      // `lastActionAt` is minted from a local-noon clock, so slicing the UTC
      // string is the previous day for anyone more than twelve hours east — and
      // every row on their screen would have read one day older than it was.
      daysAgo: daysBetween(dayOf(lastActionAt), today),
    }
  }

  const projectTimelineItem = (n: StoredNode<'timelineItem'>, g: GraphSnapshot): TimelineItem => {
    const { slug: _slug, ...rest } = n.props
    return {
      ...rest,
      id: n.id,
      allDay: n.props.startMins === undefined,
      ...joinedTo(g, n.id, 'ABOUT'),
    }
  }

  return {
    applications: createProjection('application', projectApplication),
    application: createOneProjection('application', projectApplication),

    timeline: sortedBy(createProjection('timelineItem', projectTimelineItem), compareItems),

    /*
     * ------------------------------------------------------------------------
     * The Vault's filed records, all newest first
     * ------------------------------------------------------------------------
     *
     * `ofType` is id-ascending, which is creation order, which puts the OLDEST
     * record at the top and the newest below the fold — so the one you have
     * just added is the one you have to scroll to find. That was fixed for
     * documents first, on the same complaint, and left the Vault ordering one
     * of its lists one way and two the other.
     *
     * Reminders are the deliberate exception and are ordered elsewhere: they
     * are commitments with dates rather than things you filed, the Vault groups
     * them by those dates, so they stay chronological. See `remindersOf` in
     * `core/dates.ts`.
     *
     * Sorted here rather than in the Vault's own components so that both apps
     * and every other surface agree without each remembering to. Nothing in
     * `web/src/components/vault` or `mobile/src/screens/vault` sorts anything —
     * they filter and group, and the order they group is this one.
     *
     * ## Two keys, because the records do not all carry the same fields
     *
     * Links and files have `savedOn`, so they use it, tie-broken by id.
     *
     * Snippets have no date at all, so they go by id alone. That is not a
     * lesser key: ids are `uuidv7` with a monotonic counter, so id order IS
     * creation order, exactly, down to records minted inside one millisecond.
     * `savedOn` is a DAY, which is why it needs the id tie-break underneath it —
     * a batch filed in one go shares a date and would otherwise come back in an
     * arbitrary order.
     *
     * ## Why links do not use the id key, which is the more precise one
     *
     * Because it would invert them. The link fixtures are authored newest-first,
     * so their ids ASCEND as their dates DESCEND — id-descending would put the
     * oldest link at the top of a list whose every row prints `saved 11 months
     * ago`. A sort key the reader can check against what is on screen beats one
     * they cannot, and `savedOn` is the one they can see.
     *
     * `savedOn` is set to the day of the write on every creation path and no
     * editor exposes it — both tools strip it on save
     * (`Omit<VaultLink, 'id' | 'savedOn'>`). It is NOT immutable, though:
     * `vault.link.update` and `vault.file.update` both accept it, so the
     * assistant can write one even where a person cannot. If that ever becomes
     * a way to backdate a record, the id tie-break is what still orders
     * everything filed on the same day.
     */
    links: sortedBy(
      createProjection('link', (n, g): VaultLink => {
        const { slug: _slug, ...rest } = n.props
        return { ...rest, id: n.id, ...filedUnder(g, n.id) }
      }),
      compareNewestFirst,
    ),

    files: sortedBy(
      createProjection('file', (n, g): VaultFile => {
        const { slug: _slug, ...rest } = n.props
        return { ...rest, id: n.id, ...filedUnder(g, n.id) }
      }),
      compareNewestFirst,
    ),

    snippets: sortedBy(
      createProjection('snippet', (n, g): Snippet => {
        const { slug: _slug, ...rest } = n.props
        return { ...rest, id: n.id, ...filedUnder(g, n.id) }
      }),
      compareNewestById,
    ),

    postings: createProjection('posting', (n, g): SavedPosting => {
      const { slug: _slug, ...rest } = n.props
      const application = became(g, n.id)
      return { ...rest, id: n.id, linked: application !== undefined, ...pointing(application) }
    }),

    matches: createProjection('match', (n, g): Match => {
      const { slug: _slug, ...rest } = n.props
      return { ...rest, id: n.id, ...pointing(became(g, n.id)) }
    }),

    pipelines: createProjection('pipeline', (n): Pipeline => {
      const { slug: _slug, ...rest } = n.props
      return { ...rest, id: n.id }
    }),

    /*
     * Ordered by id, which is creation order, and deliberately not re-sorted by
     * status: a card that is answered should stay where it was rather than jump
     * to the bottom of the list under the pointer that just answered it.
     */
    proposals: createProjection('proposal', (n, g): Proposal => {
      const { slug: _slug, ...rest } = n.props
      return { ...rest, id: n.id, pipelineId: g.one(n.id, 'FROM', 'pipeline')?.id ?? null }
    }),

    keywords: createProjection('keyword', (n): Label => {
      const { slug: _slug, ...rest } = n.props
      return { ...rest, id: n.id }
    }),

    // Blank rather than absent when there is no profile node yet. The page has
    // to render something, and `profileIsBlank` is what the manifest and
    // Settings read to decide whether anything is there.
    profile: (g) => g.ofType('profile')[0]?.props ?? emptyProfile(),
  }
}

/**
 * Newest first by the day a record was filed, then by the instant it was minted.
 *
 * The id tie-break is not a formality. `savedOn` is a DAY, so everything filed
 * in one session shares it — a batch of documents dropped in one go, or three
 * links saved while reading one posting — and the date alone would leave those
 * in whatever order the store happened to return them.
 */
const compareNewestFirst = (a: { savedOn: string; id: string }, b: { savedOn: string; id: string }) =>
  b.savedOn.localeCompare(a.savedOn) || b.id.localeCompare(a.id)

/**
 * Newest first for records that carry no date of their own.
 *
 * Ids are `uuidv7` minted from the write's own instant, with a monotonic
 * counter ordering records inside a single millisecond — see `core/ref.ts`. So
 * comparing ids compares creation time, exactly, and it is the more precise of
 * the two keys rather than the fallback it looks like.
 *
 * Snippets are the only list that uses it, because they are the only records
 * here with no date of any kind. It is deliberately not exported: reminders
 * looked like a second caller and are not one — they stay in due-date order,
 * for the reasons in `remindersOf`.
 */
const compareNewestById = (a: { id: string }, b: { id: string }) => b.id.localeCompare(a.id)

/**
 * A projection with an order imposed on it.
 *
 * Memoised on the projected array's identity, so the sort runs once per commit
 * that touched one of these records rather than once per render of every screen
 * reading them — the calendar re-renders on a great deal that has nothing to do
 * with the timeline.
 */
function sortedBy<R>(list: List<R>, compare: (a: R, b: R) => number): List<R> {
  let lastInput: readonly R[] | null = null
  let lastOutput: readonly R[] = []
  return (g) => {
    const next = list(g)
    if (next === lastInput) return lastOutput
    lastInput = next
    lastOutput = [...next].sort(compare)
    return lastOutput
  }
}
