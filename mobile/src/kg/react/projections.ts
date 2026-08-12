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

import { compareItems, daysBetween } from '@/data/timeline'
import { emptyProfile } from '@/data/profile'
import type {
  Application,
  ISODate,
  Label,
  Match,
  NodeId,
  Pipeline,
  Profile,
  SavedPosting,
  Snippet,
  StoredNode,
  TimelineItem,
  VaultFile,
  VaultLink,
} from '@/kg/core/model'
import { createOneProjection, createProjection, dayOf } from '@/kg/core/project'
import type { GraphSnapshot } from '@/kg/core/snapshot'

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
  keywords: List<Label>
  profile: (g: GraphSnapshot) => Profile
}

/** The application an edge of this kind points at, as an id. Absent, not null. */
const pointing = (id: NodeId | undefined) => (id === undefined ? {} : { applicationId: id })

const filedUnder = (g: GraphSnapshot, id: NodeId) =>
  pointing(g.one(id, 'FILED_UNDER', 'application')?.id)

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
      ...pointing(g.one(n.id, 'ABOUT', 'application')?.id),
    }
  }

  return {
    applications: createProjection('application', projectApplication),
    application: createOneProjection('application', projectApplication),

    timeline: sortedBy(createProjection('timelineItem', projectTimelineItem), compareItems),

    links: createProjection('link', (n, g): VaultLink => {
      const { slug: _slug, ...rest } = n.props
      return { ...rest, id: n.id, ...filedUnder(g, n.id) }
    }),

    files: createProjection('file', (n, g): VaultFile => {
      const { slug: _slug, ...rest } = n.props
      return { ...rest, id: n.id, ...filedUnder(g, n.id) }
    }),

    snippets: createProjection('snippet', (n, g): Snippet => {
      const { slug: _slug, ...rest } = n.props
      return { ...rest, id: n.id, ...filedUnder(g, n.id) }
    }),

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
 * The timeline is the one collection whose order is not creation order.
 *
 * Sorted by date and start time, because rescheduling is the most common edit
 * there is and an unsorted rail reads as a rendering bug. Memoised on the
 * projected array's identity so the sort runs once per commit that touched a
 * timeline item, not once per render of the calendar.
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
