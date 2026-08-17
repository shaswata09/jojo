/**
 * L1 — the segment a URL carries for a record, and the lookup that reads it back.
 *
 * Wave 1 shipped half of the R-2 mitigation. The resolver landed in
 * `use-applications.ts` and the BUILDER did not: `appPath` still took a bare
 * string and every one of its eighteen call sites handed it `a.id`. Ids are
 * per-session UUIDv7, so `/applications/app:0192f4c1-7b3e-…` was dead the moment
 * the tab reloaded — click a card, press F5, "This application no longer
 * exists." on a record that was still sitting in the list behind the panel.
 *
 * So the slug is the address and the id is a legacy form we accept but never
 * mint. Four reasons, in the order they bite:
 *
 * - A reload re-mints every id. That is the reported bug.
 * - Any import that replays an export through `application.create` rather than
 *   assigning a parsed blob mints fresh ids, so an id URL dies on transfer even
 *   once ids are stable per install. `slug` is a stored prop and survives the
 *   round trip verbatim. (Written as "Wave 2's `memory.import`" — that tool is
 *   deliberately absent, see the header of `kg/tools/memory.ts`; the argument
 *   holds for whatever import arrives.)
 * - React Navigation and Electron's `open-url` hand the app a path string on a
 *   COLD start, before any graph exists. A key that only means something to the
 *   process that minted it is exactly the key that cannot survive that handoff.
 * - `/applications/rice` is legible; `app%3A01a1310e-8e80-77f9-8e1d-…` is fifty
 *   characters of noise in an address bar someone is about to paste to a friend.
 *
 * Pure and React-free on purpose: RN and Electron route handling must be able to
 * resolve a deep link with nothing mounted.
 */

import type { NodeId, NodeType, StoredNode } from './model'
import type { GraphSnapshot } from './snapshot'

/**
 * What a URL segment may contain: the slug a link was built from, or a NodeId
 * pasted out of a link built before this file existed.
 *
 * Deliberately not `NodeId`. The whole point is that the caller has a string off
 * the wire and does not yet know which of the two it is holding.
 */
export type AddressKey = string

/**
 * A record that can address itself.
 *
 * `slug` is optional because the `src/data` fixtures do not carry one — their
 * `id` field IS their slug, which is what `repo/seed.ts` compiles it into. So
 * `addressOf` falling back to `id` is a true statement about those rows rather
 * than a shrug: a fixture-shaped record addressed by its id is addressed by its
 * slug. Every record that has been through a projection carries a real `slug`,
 * because `application.create` mints one through `uniqueSlug` and
 * `projections.ts` no longer throws it away.
 */
export type Addressable = { readonly id: NodeId; readonly slug?: string }

/**
 * The canonical segment for a record — the only thing a path builder may put in
 * a URL.
 *
 * Taking the record rather than a string is the half of R-2 that was missing.
 * `appPath(a.id)` used to compile and produce a link that died on reload; it is
 * now a type error, which is the only mechanism that keeps eighteen call sites
 * honest.
 */
export function addressOf(record: Addressable): AddressKey {
  return record.slug ?? record.id
}

/**
 * Slug first, id second.
 *
 * Reversed from the lookup this replaces, deliberately. The slug is the form
 * every builder now emits, so it is the hot path; putting the id branch second
 * makes it visibly the legacy branch — the one that gets deleted if it ever
 * stops being needed.
 *
 * `expect` is not optional, and it is what handles the collision the seed
 * already contains: six records answer to 'stripe' — an application, a deadline,
 * a calendar event, a pipeline, a saved posting and a match. `bySlug` is indexed
 * on the unique [type, slug] pair (D4), and `node(id, expect)` refuses an id of
 * the wrong type, so `/applications/stripe` and `/scout?focus=posting:stripe`
 * cannot resolve to each other's record. A bare `node(key)` would happily hand
 * `/applications/kw:0192…` back a keyword, which is the exact confusion the type
 * prefix exists to prevent.
 *
 * `undefined` for a key that names nothing. That is a real destination — a
 * bookmark to a deleted record, a typo — and the detail route renders its empty
 * state from it.
 */
export function resolveAddress<T extends NodeType>(
  graph: GraphSnapshot,
  expect: T,
  key: AddressKey,
): StoredNode<T> | undefined {
  return graph.bySlug(expect, key) ?? graph.node(key, expect)
}
