/**
 * L1 — createProjection(); the epoch cache.
 *
 * Derived values do not live in storage. `daysAgo`, `linked`, `allDay`,
 * `displayName` and `degree` are all computed here instead:
 *
 * - `daysAgo` was stored and zeroed on every edit, and has only ever been right
 *   because a reload wiped it. On disk it starts lying on the second launch.
 * - `linked` is an edge rendered as a boolean and needed four write sites to
 *   stay honest — that is the rot in miniature.
 * - `allDay` is `startMins === undefined`, and `degree` is a count of edges
 *   the snapshot already indexes.
 *
 * The rule they all break is the same one: a value is DERIVED if it can be
 * recomputed from what is stored, and a derived value written to storage is a
 * cache with no invalidation. That was survivable for as long as a reload wiped
 * the store — every one of them was recomputed on the next launch, so the bug
 * had nowhere to accumulate. From Wave 2 the store is on disk, and the same
 * `daysAgo` comes back saying "1 day ago" about something last touched in March.
 * Nothing new goes into `props` that any function here could have worked out.
 *
 * `dayOf` lives here for the same reason: the calendar day is a reading of an
 * instant, correct at the moment it is taken and never after.
 *
 * Keyed on epoch, so one edit re-projects one row and every other row keeps
 * referential identity — which is what makes React.memo hold.
 *
 * A projector that needs the clock takes it as a closure argument, because the
 * cache is keyed on epoch and nothing else: `createProjection('application',
 * (n) => ({ ...n, daysAgo: daysBetween(n.props.lastActionAt, today) }))` is
 * correct only for as long as `today` is. The caller that binds a day owns
 * rebuilding the projection when the day turns — which is the honest shape of
 * the problem, and is why `daysAgo` could never be right while it was stored.
 */

import type { Application, ISODate, Instant, NodeId, NodeType, StoredNode } from './model'
import type { GraphSnapshot } from './snapshot'
import { daysBetween } from './dates'

/**
 * The calendar day the user is standing in, derived from an instant.
 *
 * Here, in core, and nowhere else — `tools/support.ts` re-exports it and every
 * caller reaches it through one of the two. It moved down from `tools` when
 * `repo/seed.ts` needed it to date the rebase and could not import a layer above
 * itself; the alternative was a second copy of four lines, and a second copy of
 * a date rule is how two screens come to disagree about what day it is.
 *
 * Read through a local `Date` rather than by slicing the RFC3339 string.
 * `'2026-10-12T23:40:00Z'.slice(0, 10)` is the 12th, but anyone in Texas reading
 * that screen is on the evening of the 12th and anyone in Tokyo is on the
 * morning of the 13th — and "completed today" is a claim about the day the
 * person is in, not the day Greenwich is in.
 *
 * The most literal derived-not-stored value in the file: it is a reading of an
 * instant, correct only at the moment it is taken, and storing one would be
 * `daysAgo` again in a different costume.
 */
export function dayOf(now: Instant): ISODate {
  const at = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

export type Projector<T extends NodeType, R> = (n: StoredNode<T>, g: GraphSnapshot) => R

type Cached<R> = { epoch: number; value: R }

/**
 * Structural equality over what a projector actually returns.
 *
 * ## Why a projection needs this at all
 *
 * The epoch is deliberately coarse. It moves for a node, for its incident
 * edges, AND for every neighbour one hop out, because an application's row
 * carries its organisation's NAME and nothing finer can see that. The cost of
 * that safety is that the epoch moves for edits the projector never reads.
 *
 * Measured on the benchmark world — six applications, five organisations —
 * changing one application's `note`, which neither list projects:
 *
 *     organisation   array republished: yes   1 of 5 rows newly identified
 *     application    array republished: yes   1 of 6 rows newly identified
 *     ...and the CONTENT of zero rows in either list had changed.
 *
 * A new row object is a `React.memo` miss and a republished array is a list
 * re-render, so an edit to a field nobody displays cost both. Comparing the
 * re-projected value against the one already cached costs one walk of a small
 * flat record and turns that into nothing at all.
 *
 * Deliberately NOT `JSON.stringify` on both sides: it is quadratic-ish on the
 * hot path, it calls two objects with keys in different orders different, and
 * it throws on a cycle rather than returning an answer.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => sameValue(x, b[i]))
  }

  // Anything with a prototype of its own — a Date, a Map, a class instance — is
  // not something this can compare by walking keys, and guessing would be worse
  // than a cache miss. `Object.is` above already caught the same instance.
  const pa = Object.getPrototypeOf(a) as unknown
  const pb = Object.getPrototypeOf(b) as unknown
  if (pa !== Object.prototype || pb !== Object.prototype) return false

  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every(
    (k) =>
      Object.hasOwn(b, k) &&
      sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}

/**
 * One projection per collection, created once and called on every render.
 *
 * Keyed on `epoch(id)` rather than on the snapshot version, because a
 * projection depends on the node, on its incident edges, AND on the props of
 * the neighbours it reads one hop out: an application's row carries its
 * organisation's name, so renaming the organisation has to re-project the
 * application even though the application's own record did not change. A
 * `WeakMap<StoredNode, R>` cannot see that and would serve the old name until
 * the row was edited for some unrelated reason.
 *
 * That third clause is load-bearing and used to be missing here and in
 * `snapshot.ts`, both of which named this exact case and then located the org
 * name on the EDGE. It is a prop on the organisation's node, so the epoch moved
 * for the organisation alone and every application row hit the cache — the
 * failure the paragraph promised was solved. `MutableSnapshot.putNode` bumps
 * the neighbours now; a projector that reaches TWO hops out is still outside
 * what this cache can see.
 */
export function createProjection<T extends NodeType, R>(
  type: T,
  project: Projector<T, R>,
): (g: GraphSnapshot) => readonly R[] {
  const cache = new Map<NodeId, Cached<R>>()
  let lastVersion = -1
  let lastResult: readonly R[] = []

  return (g: GraphSnapshot): readonly R[] => {
    // A version that went BACKWARDS is a different store, not an earlier commit
    // of this one, and the equality check below would read it as a cache hit
    // and hand back the array from the store that was replaced. `Repository`
    // keeps `version` monotonic — `replaceAll` and `rehydrate` swap the
    // snapshot's contents in place rather than minting a fresh one — so this
    // should be unreachable. It is here because the failure it guards is silent
    // and total: every list in the app rendering records that no longer exist,
    // beside a Settings page correctly reporting the store empty. Pinned by
    // 'serves the snapshot it was handed' in `project.test.ts`, since "should be
    // unreachable" on its own reads as an invitation to delete the line.
    if (g.version < lastVersion) cache.clear()

    // Same commit, same answer. Without this the identity check below still
    // runs over every row on every render, which is the O(n) work React.memo
    // was supposed to remove.
    else if (g.version === lastVersion) return lastResult

    const nodes = g.ofType(type)
    const next: R[] = []
    const live = new Set<NodeId>()
    let changed = nodes.length !== lastResult.length

    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]
      if (!node) continue

      live.add(node.id)
      const epoch = g.epoch(node.id)
      const hit = cache.get(node.id)

      let value: R
      if (hit && hit.epoch === epoch) {
        value = hit.value
      } else {
        const projected = project(node, g)
        // A moved epoch is not a changed row. The epoch is coarse on purpose —
        // see `sameValue` — so the commonest miss here is a neighbour bump for
        // a field this projector does not read. Keeping the OLD object when the
        // new one is structurally identical is what lets `React.memo` hold and
        // what keeps `changed` false, so the ARRAY identity survives too.
        const unchanged = hit !== undefined && sameValue(hit.value, projected)
        value = unchanged ? hit.value : projected
        cache.set(node.id, { epoch, value })
        if (!unchanged) changed = true
      }

      // A row that kept its identity can still have MOVED, and a reordered
      // array with every element identical is a different array.
      //
      // NOT what catches a drag between stages, which this used to say: a stage
      // change is a `putNode`, so the row's epoch moves and the miss above has
      // already set `changed`. `ofType` is id-ascending, and a set of rows that
      // all hit the cache cannot have reordered under that rule — so this is a
      // backstop, not a live path. It stays because the rule is one line away
      // from being a reading of `props`, and on that day an unchanged row
      // moving would republish yesterday's array with no other guard reaching
      // it.
      if (!changed && lastResult[i] !== value) changed = true
      next.push(value)
    }

    // Reclaiming memory, and only that. A removed id can never be served from
    // here again — `removeNode` bumps its epoch and a re-add bumps it once
    // more, so a surviving entry would miss on the epoch — and its removal
    // already showed up as a length change above. Nothing a caller can read
    // distinguishes this loop being here from it being gone, which is why there
    // is no test for it: one would pass either way.
    // A snapshot, not a copy: the loop body mutates the collection it is
    // walking, so it has to walk a list taken before the first change.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const id of [...cache.keys()]) {
      if (!live.has(id)) {
        cache.delete(id)
        changed = true
      }
    }

    lastVersion = g.version
    if (!changed) return lastResult

    lastResult = next
    return next
  }
}

/**
 * The same cache for a single record — the detail route and the profile.
 *
 * Separate from `createProjection` because a detail page that re-projected the
 * whole collection to find one row would do the work of the board to render one
 * card, and because the answer here is legitimately `undefined` when the record
 * has gone. `routes/ApplicationDetail.tsx` renders its "This application no
 * longer exists" state from exactly that, so the distinction has to survive.
 */
export function createOneProjection<T extends NodeType, R>(
  type: T,
  project: Projector<T, R>,
): (g: GraphSnapshot, id: NodeId) => R | undefined {
  const cache = new Map<NodeId, Cached<R>>()

  return (g: GraphSnapshot, id: NodeId): R | undefined => {
    const node = g.node(id, type)
    if (!node) {
      cache.delete(id)
      return undefined
    }

    const epoch = g.epoch(id)
    const hit = cache.get(id)
    if (hit && hit.epoch === epoch) return hit.value

    const value = project(node, g)
    cache.set(id, { epoch, value })
    return value
  }
}

/**
 * One application row, from the node and its edges.
 *
 * Down here rather than in `react/projections.ts`, where it was written,
 * because a second reader needed it: `stats.report` computes the same funnel
 * and the same rates the Statistics page shows, and it runs at L3 where the
 * React projections are out of reach. The alternative was a copy — and a second
 * definition of `daysAgo` is the exact thing this file's header spends thirty
 * lines arguing against.
 *
 * `today` is a parameter for the reason `createProjection`'s header gives: a
 * projector that closed over the day would be correct only for as long as that
 * day was, and the cache is keyed on epoch and nothing else.
 */
export function applicationFrom(
  n: StoredNode<'application'>,
  g: GraphSnapshot,
  today: ISODate,
): Application {
  /*
   * `slug` is kept, unlike everywhere else. It was dropped in Wave 1 because
   * nothing read it, and the consequence was that `appPath` had only the
   * per-session id to build a link out of — so every URL in the address bar
   * died on reload. It is a STORED prop, not a derived one, so passing it
   * through is not the thing D25 forbids.
   */
  const { lastActionAt, ...rest } = n.props
  return {
    ...rest,
    id: n.id,
    org: g.one(n.id, 'AT', 'organisation')?.props.name ?? '',
    /*
     * The LOCAL calendar day of the instant, not `slice(0, 10)`. `lastActionAt`
     * is minted from a local-noon clock, so slicing the UTC string is the
     * previous day for anyone more than twelve hours east — and every row on
     * their screen would read one day older than it is.
     */
    daysAgo: daysBetween(dayOf(lastActionAt), today),
  }
}
