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

import type { ISODate, Instant, NodeId, NodeType, StoredNode } from './model'
import type { GraphSnapshot } from './snapshot'

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
 * One projection per collection, created once and called on every render.
 *
 * Keyed on `epoch(id)` rather than on the snapshot version, because a
 * projection depends on the node AND on its incident edges: an application's
 * row carries its organisation's name, so renaming the organisation has to
 * re-project the application even though the application's own record did not
 * change. A `WeakMap<StoredNode, R>` cannot see that and would serve the old
 * name until the row was edited for some unrelated reason.
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
    // beside a Settings page correctly reporting the store empty.
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
        value = project(node, g)
        cache.set(node.id, { epoch, value })
        changed = true
      }

      // A row that kept its identity can still have MOVED, and a reordered
      // array with every element identical is a different array. Comparing
      // position by position is what catches a drag between stages.
      if (!changed && lastResult[i] !== value) changed = true
      next.push(value)
    }

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
