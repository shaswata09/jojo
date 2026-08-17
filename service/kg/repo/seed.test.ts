/**
 * The projection round trip: the whole "collections are projections of the
 * graph" claim, mechanically checked.
 *
 * `seedToGraph` compiles the `src/data` fixtures to nodes and edges; they are
 * projected back and compared against the fixture arrays they came from. If the graph cannot reproduce them
 * exactly then something was lost in the compilation — a field, an edge, an
 * ordering — and every consumer of the six hooks would see the loss without
 * anything reporting it. This is also R-2's mechanical proof that the identity
 * change did not break the seed's cross-references.
 *
 * Two things about how the comparison is made, both load-bearing:
 *
 * - Ids are compared as SLUGS. `Application.id` is opaque now (a prefixed
 *   UUIDv7) and the fixture's `id` became the node's `slug`, so a literal
 *   comparison of ids could only ever fail. Translating the projected ids back
 *   through the slug is the honest statement of what is being claimed: the same
 *   information, spelled with different keys.
 * - The projectors are written HERE rather than imported. They are the spec the
 *   compat hooks have to satisfy, expressed as an executable oracle, and writing
 *   them independently is what stops the test from agreeing with the seed
 *   compiler because the same hand wrote both.
 */

import { describe, expect, it } from 'vitest'
import { seedLabels, seedLabelsByRecord } from '@/data/labels'
import { seedProfile } from '@/data/profile'
import {
  matches as seedMatches,
  pipelines as seedPipelines,
  savedPostings as seedPostings,
} from '@/data/scout'
import { applications as seedApplications } from '@/data/seed'
import {
  SEED_TODAY,
  addDays,
  daysBetween,
  partsOf,
  timeline as seedTimeline,
} from '@/data/timeline'
import {
  snippets as seedSnippets,
  vaultFiles as seedFiles,
  vaultLinks as seedLinks,
} from '@/data/vault'
import { EDGE_SCHEMA, NODE_TYPES } from '../core/model'
import type {
  Application,
  Instant,
  Label,
  Match,
  NodeId,
  NodeType,
  Pipeline,
  SavedPosting,
  Snippet,
  StoredNode,
  TimelineItem,
  VaultFile,
  VaultLink,
} from '../core/model'
import type { GraphSnapshot } from '../core/snapshot'
import { MutableSnapshot } from '../core/snapshot'
import { seedToGraph } from './seed'

/**
 * Local noon ON the day the fixtures were written, so the rebase offset is
 * exactly zero and the round trip below can compare against them verbatim.
 *
 * Built from `SEED_TODAY` through a local `Date` rather than written as a UTC
 * literal. `'2026-10-12T12:00:00.000Z'` is what this was, and `dayOf` reads the
 * LOCAL day out of an instant — so in Auckland that string is already the 13th,
 * the compiler shifted every fixture date forward by one, and the round trip
 * failed on a machine in New Zealand and nowhere else. Noon is what keeps it
 * away from both midnights.
 */
const noonOn = (iso: string): Instant => {
  const { y, m, d } = partsOf(iso)
  return new Date(y, m - 1, d, 12).toISOString()
}

const NOW: Instant = noonOn(SEED_TODAY)

const graph = seedToGraph(NOW)
const g: GraphSnapshot = MutableSnapshot.from(graph.nodes, graph.edges)

/* ------------------------------- projectors ------------------------------- */

/** 'YYYY-MM-DD' out of an Instant. Both ends UTC, so a day is a whole day. */
const dayOf = (at: Instant) => at.slice(0, 10)

/** The projected id, and what an `applicationId` points back at. */
const slugOf = (id: NodeId | undefined): string | undefined =>
  id === undefined ? undefined : (g.node(id)?.props as { slug?: string } | undefined)?.slug

const filedUnder = (id: NodeId) => slugOf(g.one(id, 'FILED_UNDER', 'application')?.id)

/** Present only when the edge is. An `applicationId: undefined` is not the same row. */
const pointing = (applicationId: string | undefined) =>
  applicationId === undefined ? {} : { applicationId }

function projectApplication(n: StoredNode<'application'>): Application {
  const { slug, lastActionAt, ...rest } = n.props
  return {
    ...rest,
    id: slug,
    org: g.one(n.id, 'AT', 'organisation')?.props.name ?? '',
    // The count that used to be stored, zeroed on every edit, and right only
    // because a reload wiped it.
    daysAgo: daysBetween(dayOf(lastActionAt), dayOf(NOW)),
  }
}

function projectTimelineItem(n: StoredNode<'timelineItem'>): TimelineItem {
  const { slug, ...rest } = n.props
  return {
    ...rest,
    id: slug,
    // The same fact the absence of `startMins` already carried.
    allDay: n.props.startMins === undefined,
    ...pointing(slugOf(g.one(n.id, 'ABOUT', 'application')?.id)),
  }
}

function projectLink(n: StoredNode<'link'>): VaultLink {
  const { slug, ...rest } = n.props
  return { ...rest, id: slug, ...pointing(filedUnder(n.id)) }
}

function projectFile(n: StoredNode<'file'>): VaultFile {
  const { slug, ...rest } = n.props
  return { ...rest, id: slug, ...pointing(filedUnder(n.id)) }
}

function projectSnippet(n: StoredNode<'snippet'>): Snippet {
  const { slug, ...rest } = n.props
  return { ...rest, id: slug, ...pointing(filedUnder(n.id)) }
}

function projectPosting(n: StoredNode<'posting'>): SavedPosting {
  const { slug, ...rest } = n.props
  const became = slugOf(g.one(n.id, 'BECAME', 'application')?.id)
  // `linked` is this edge rendered as a boolean. It needed four write sites to
  // stay honest, and one of them was the delete path in the reducer.
  return { ...rest, id: slug, linked: became !== undefined, ...pointing(became) }
}

function projectMatch(n: StoredNode<'match'>): Match {
  const { slug, ...rest } = n.props
  return { ...rest, id: slug, ...pointing(slugOf(g.one(n.id, 'BECAME', 'application')?.id)) }
}

function projectPipeline(n: StoredNode<'pipeline'>): Pipeline {
  const { slug, ...rest } = n.props
  return { ...rest, id: slug }
}

function projectKeyword(n: StoredNode<'keyword'>): Label {
  const { slug, ...rest } = n.props
  return { ...rest, id: slug }
}

/* --------------------------------- the trip -------------------------------- */

describe('seedToGraph', () => {
  it('resolves every cross-reference in the fixtures', () => {
    expect(graph.unresolved).toEqual([])
  })

  it('compiles one node per fixture record, plus an organisation per employer', () => {
    const counts = Object.fromEntries(
      NODE_TYPES.map((type) => [type, g.ofType(type).length] as const),
    )

    expect(counts).toEqual({
      application: seedApplications.length,
      organisation: new Set(seedApplications.map((a) => a.org)).size,
      timelineItem: seedTimeline.length,
      keyword: seedLabels.length,
      link: seedLinks.length,
      file: seedFiles.length,
      snippet: seedSnippets.length,
      posting: seedPostings.length,
      match: seedMatches.length,
      pipeline: seedPipelines.length,
      profile: 1,
    })
  })
})

describe('the projection round trip', () => {
  it('projects the applications back exactly, in the same order', () => {
    expect(g.ofType('application').map(projectApplication)).toEqual(seedApplications)
  })

  it('projects the timeline back exactly, in the same order', () => {
    expect(g.ofType('timelineItem').map(projectTimelineItem)).toEqual(seedTimeline)
  })

  it('projects the vault back exactly', () => {
    expect(g.ofType('link').map(projectLink)).toEqual(seedLinks)
    expect(g.ofType('file').map(projectFile)).toEqual(seedFiles)
    expect(g.ofType('snippet').map(projectSnippet)).toEqual(seedSnippets)
  })

  it('projects the scout back exactly, including `linked`', () => {
    expect(g.ofType('posting').map(projectPosting)).toEqual(seedPostings)
    expect(g.ofType('match').map(projectMatch)).toEqual(seedMatches)
    expect(g.ofType('pipeline').map(projectPipeline)).toEqual(seedPipelines)
  })

  it('projects the keywords back exactly', () => {
    expect(g.ofType('keyword').map(projectKeyword)).toEqual(seedLabels)
  })

  it('projects the profile back exactly', () => {
    const profile = g.ofType('profile')[0]
    expect(profile?.props).toEqual(seedProfile())
  })

  /**
   * The keyword map, which is the one collection whose SHAPE deliberately does
   * not round-trip.
   *
   * `seedLabelsByRecord` is a flat map keyed by whatever id each list happened to
   * use — 'app:rice' for applications because theirs collide with five other
   * lists, everything else bare. That dual spelling is the audit bug D14 deletes,
   * and it is why the old `remove` had to sweep two spellings of the same edge.
   * What must survive is the edge itself: the same keywords on the same records.
   */
  it('puts every keyword back on the record it was on', () => {
    const bySlug = new Map<string, string[]>()
    for (const type of ['application', 'timelineItem', 'link', 'file', 'snippet'] as const) {
      for (const node of g.ofType(type)) {
        const names = g
          .many(node.id, 'TAGS', 'in', 'keyword')
          .map((k) => k.props.slug)
          .sort()
        if (names.length > 0) bySlug.set(`${type}:${node.props.slug}`, names)
      }
    }

    const expected = new Map<string, string[]>()
    for (const [key, ids] of Object.entries(seedLabelsByRecord)) {
      if (ids.length === 0) continue
      const type = key.startsWith('app:') ? 'application' : typeOfFixtureKey(key)
      const slug = key.startsWith('app:') ? key.slice('app:'.length) : key
      expected.set(`${type}:${slug}`, [...ids].sort())
    }

    expect(Object.fromEntries(bySlug)).toEqual(Object.fromEntries(expected))
  })
})

/** Which list a bare key in `seedLabelsByRecord` came from. Prefixes, as authored. */
function typeOfFixtureKey(key: string): NodeType {
  if (key.startsWith('l-')) return 'link'
  if (key.startsWith('f-')) return 'file'
  if (key.startsWith('s-')) return 'snippet'
  return 'timelineItem'
}

/* ------------------------------- invariants -------------------------------- */

/**
 * The dev-only integrity check R-2 asks for, run against the seed.
 *
 * Every one of these is a class of corruption that renders as something else: a
 * dangling edge is a card with a missing name, a duplicate slug is a route that
 * resolves to the wrong record, and a second outgoing edge on a 'one' relation
 * is a reminder that is about two applications at once.
 */
describe('the seeded graph satisfies its own invariants', () => {
  it('has both endpoints of every edge', () => {
    const ids = new Set(graph.nodes.map((n) => n.id))
    const dangling = graph.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to))
    expect(dangling).toEqual([])
  })

  it('types every edge the way EDGE_SCHEMA allows', () => {
    const wrong = graph.edges.filter((e) => {
      const spec = EDGE_SCHEMA[e.rel]
      const from = g.node(e.from)?.type
      const to = g.node(e.to)?.type
      return !from || !to || !spec.from.includes(from) || !spec.to.includes(to)
    })
    expect(wrong).toEqual([])
  })

  it("gives each 'one' relation at most one outgoing edge per node", () => {
    const seen = new Set<string>()
    const doubled: string[] = []
    for (const edge of graph.edges) {
      if (EDGE_SCHEMA[edge.rel].fromCardinality !== 'one') continue
      const key = `${edge.from}|${edge.rel}`
      if (seen.has(key)) doubled.push(key)
      seen.add(key)
    }
    expect(doubled).toEqual([])
  })

  it('keeps slugs unique within a type, and lets them collide across types', () => {
    for (const type of NODE_TYPES) {
      const slugs = g.ofType(type).map((n) => (n.props as { slug?: string }).slug ?? '')
      expect(new Set(slugs).size).toBe(slugs.length)
    }

    // Six records answer to 'stripe' in the fixtures, and all six keep the name.
    const stripes = (['application', 'pipeline', 'posting'] as const)
      .map((type) => g.bySlug(type, 'stripe'))
      .filter((n) => n !== undefined)
    expect(stripes).toHaveLength(3)
    expect(new Set(stripes.map((n) => n.id)).size).toBe(3)
  })

  it('mints ids that sort into the order the fixtures are authored in', () => {
    const ids = g.ofType('application').map((n) => n.id)
    expect([...ids].sort()).toEqual(ids)
    expect(g.ofType('application').map((n) => n.props.slug)).toEqual(
      seedApplications.map((a) => a.id),
    )
  })

  /**
   * No derived value may reach storage.
   *
   * `daysAgo` on disk starts lying on the second launch; `allDay` is the same
   * fact as the absence of `startMins`; `linked` is an edge written as a
   * boolean, and it needed four write sites to stay honest. A pointer field is
   * the same mistake: `applicationId` in props is an edge the graph cannot see.
   */
  it('stores no derived value and no pointer', () => {
    const banned = ['daysAgo', 'allDay', 'linked', 'degree', 'displayName', 'applicationId', 'org']
    const offenders = graph.nodes.flatMap((n) =>
      banned.filter((key) => key in n.props).map((key) => `${n.type}.${key}`),
    )
    expect(offenders).toEqual([])
  })

  it('gives every node but the profile a slug', () => {
    const missing = graph.nodes.filter((n) => n.type !== 'profile' && !('slug' in n.props))
    expect(missing).toEqual([])
    expect(graph.nodes.find((n) => n.type === 'profile')?.props).not.toHaveProperty('slug')
  })
})

/* --------------------------------- the rebase ------------------------------ */

/**
 * The demo has to look alive whenever it is loaded, and it has to look like the
 * SAME demo.
 *
 * Everything above runs at offset zero, which is the only setting under which
 * the round trip can compare against the fixtures verbatim — so nothing above
 * would notice if the shift were dropped, applied twice, or applied to six of
 * the nine dated fields. This block is the half that would.
 */
describe('the whole-day rebase', () => {
  /** Far enough out to cross a year end, a leap day and both clock changes. */
  const OFFSET = 512
  const later = noonOn(addDays(SEED_TODAY, OFFSET))

  const shifted = seedToGraph(later)
  const s = MutableSnapshot.from(shifted.nodes, shifted.edges)

  /** Every authored date in the graph, keyed so the two runs line up row by row. */
  const datesOf = (snapshot: GraphSnapshot): Record<string, string> => {
    const out: Record<string, string> = {}
    const put = (key: string, value: unknown) => {
      if (typeof value === 'string') out[key] = value
    }
    for (const n of snapshot.ofType('application')) {
      const p = n.props
      put(`application:${p.slug}.appliedOn`, p.appliedOn)
      put(`application:${p.slug}.submittedOn`, p.submittedOn)
      put(`application:${p.slug}.firstReplyOn`, p.firstReplyOn)
      put(`application:${p.slug}.offer.respondBy`, p.offer?.respondBy)
    }
    for (const n of snapshot.ofType('timelineItem')) {
      put(`timelineItem:${n.props.slug}.date`, n.props.date)
      put(`timelineItem:${n.props.slug}.completedOn`, n.props.completedOn)
    }
    for (const type of ['link', 'file', 'posting'] as const) {
      for (const n of snapshot.ofType(type)) {
        put(`${type}:${n.props.slug}.savedOn`, n.props.savedOn)
      }
    }
    return out
  }

  const before = datesOf(g)
  const after = datesOf(s)
  const keys = Object.keys(before).sort()

  /** NaN for a key one run has and the other has not, so a gap can never pass. */
  const gapOf = (key: string) => {
    const was = before[key]
    const now = after[key]
    return was === undefined || now === undefined ? Number.NaN : daysBetween(was, now)
  }

  it('moves every authored date, and moves them all by the same whole number of days', () => {
    expect(Object.keys(after).sort()).toEqual(keys)
    // A guard on the guard: a `datesOf` that stopped finding anything would
    // otherwise satisfy every assertion below with an empty set.
    expect(keys.length).toBeGreaterThan(30)
    expect([...new Set(keys.map(gapOf))]).toEqual([OFFSET])
  })

  it('leaves every relationship between the dates untouched', () => {
    // The point of a constant shift. "Replied three weeks after submitting" and
    // "this deadline is the day after that interview" are what the fixtures
    // encode, and a per-record regeneration would have kept every date plausible
    // and no pair of them true.
    const spreadOf = (dates: Record<string, string>) => {
      const values = keys.map((key) => dates[key] ?? '')
      const base = values[0] ?? ''
      return values.map((value) => daysBetween(base, value))
    }
    expect(spreadOf(after)).toEqual(spreadOf(before))
  })

  it('does not shift what was never a date', () => {
    const sizes = (snapshot: GraphSnapshot) => snapshot.ofType('file').map((n) => n.props.size)
    expect(sizes(s)).toEqual(sizes(g))

    const comps = (snapshot: GraphSnapshot) =>
      snapshot.ofType('application').map((n) => n.props.comp ?? null)
    expect(comps(s)).toEqual(comps(g))
  })

  it('leaves an absent optional date absent rather than present-and-undefined', () => {
    // `{ firstReplyOn: undefined }` survives structured clone with the key on
    // it, so `'firstReplyOn' in props` would answer yes for an application
    // nobody has heard back from — and the shift is the one place that could
    // have added it.
    const openApplications = seedApplications.filter((a) => a.firstReplyOn === undefined)
    expect(openApplications.length).toBeGreaterThan(0)
    for (const a of openApplications) {
      expect(s.bySlug('application', a.id)?.props).not.toHaveProperty('firstReplyOn')
    }

    const openItems = seedTimeline.filter((i) => !i.completedOn)
    expect(openItems.length).toBeGreaterThan(0)
    for (const i of openItems) {
      expect(s.bySlug('timelineItem', i.id)?.props).not.toHaveProperty('completedOn')
    }
  })

  it('keeps `daysAgo` measured from the day it is seeded on, at any offset', () => {
    // `lastActionAt` is compiled from a relative count, not from an authored
    // date, so it takes no shift — and a shift applied to it as well would have
    // pushed every record's last activity 512 days into the future.
    const daysAgoOf = (snapshot: GraphSnapshot, at: Instant) =>
      snapshot.ofType('application').map((n) => daysBetween(dayOf(n.props.lastActionAt), dayOf(at)))
    expect(daysAgoOf(s, later)).toEqual(daysAgoOf(g, NOW))
  })
})
