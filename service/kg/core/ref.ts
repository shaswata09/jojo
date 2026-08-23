/**
 * L1 — NodeId minting and parsing, slugify, uniqueSlug.
 *
 * Ids collide across collections. Six records in the seed answer to 'stripe': an
 * application, a deadline, a calendar event, an agenda event, a scout pipeline
 * and a saved posting — and 'rice', 'unt', 'tamu' and 'ut-austin' collide the
 * same way. An id on its own therefore cannot say what it points at, which is
 * fine while every list only talks to itself and wrong the moment anything links
 * out of one.
 *
 * So: a bare id is never a valid key. Ids are type-prefixed UUIDv7
 * ('app:0192f4c1-…'), and `slug` is demoted to a prop with a unique
 * [type, slug] index. Time-ordered ids also make "restore to its old position"
 * free, which is what deletes the reducer's captured `at` index.
 *
 * The difference from `parseRef`, the scheme this replaced and which has since
 * been deleted from `src/lib/ids.ts`, is that
 * `parseRef` *tolerated* a bare key and read it as an application. It had to:
 * the label store keyed most records by a bare id. Here a bare id is rejected,
 * because the tolerance is exactly what let a keyword written against 'stripe'
 * find the wrong one of six records.
 *
 * A bare id is never a valid key. Not in a map, not in a route, not in a prop,
 * not in a journal entry, not on the wire. The three places tempted to break it,
 * and what each does instead:
 *
 * - **Routes.** A URL carries the SLUG, resolved through `bySlug` with an id
 *   fallback for links minted before slugs existed (`core/address.ts`). It has
 *   to be a slug rather than an id because ids are minted per store: the id in
 *   a bookmark is dead after a reseed, and on another device it never existed.
 * - **The keyword map.** `labelsByRecord` keyed applications 'app:rice' and
 *   everything else bare, and that dual spelling IS the collision — read once by
 *   `repo/seed.ts` and never written again. Tagging is a `TAGS` edge (D14).
 * - **Fixture cross-references.** `applicationId: 'rice'` in `src/data` is a
 *   slug within a known type, resolved in the seed compiler's single pass. The
 *   pass is what makes the ambiguity impossible; the string alone never was.
 *
 * The prefix is not decoration and not a debugging aid. It is the type, carried
 * by the value, so a function that is handed one cannot be handed the wrong kind
 * of record without saying so — and `parseRef` rejecting a bare string is the
 * enforcement, which is why it returns a result rather than a guess.
 */

import type { EdgeId, NodeId, NodeType, Rel } from './model'
import { NODE_TYPES, RELS } from './model'

/* -------------------------------- prefixes -------------------------------- */

/**
 * Short, stable and never re-spelled: a prefix is written into every id ever
 * minted, so renaming one rewrites the user's whole store. 'app' and 'kw' match
 * what `graphNodeId` in `lib/graph/build.ts` and `refKey` already emit, so an id read out of an
 * older export lines up with one read out of here.
 */
export const TYPE_PREFIX: { readonly [T in NodeType]: string } = {
  application: 'app',
  organisation: 'org',
  timelineItem: 'item',
  keyword: 'kw',
  link: 'link',
  file: 'file',
  snippet: 'snippet',
  posting: 'posting',
  match: 'match',
  pipeline: 'pipeline',
  profile: 'profile',
  thread: 'thread',
  proposal: 'proposal',
}

const TYPE_OF_PREFIX = new Map<string, NodeType>(
  NODE_TYPES.map((type) => [TYPE_PREFIX[type], type] as const),
)

const REL_SET: ReadonlySet<string> = new Set<string>(RELS)

/* --------------------------------- uuidv7 --------------------------------- */

const HEX: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
)

/**
 * `crypto` is read off `globalThis` rather than imported.
 *
 * `core` may import nothing, and `node:crypto` would also be the wrong answer:
 * this module runs in a browser. The Math.random fallback exists for a test
 * runner or an old embedded WebView with no WebCrypto — ids only need to not
 * collide, they are not a secret, and a boot that threw here would take the
 * whole app down over a random number.
 */
function fillRandom(bytes: Uint8Array<ArrayBuffer>): void {
  const source = globalThis.crypto
  if (source && typeof source.getRandomValues === 'function') {
    source.getRandomValues(bytes)
    return
  }
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
}

/**
 * Monotonic within a millisecond.
 *
 * Two nodes created in one transaction share `ctx.now` to the millisecond, and
 * ids are the sort key for `ofType` — "id-ascending = creation order". Without
 * the counter the two would sort by their random tails, so an application and
 * the timeline item minted alongside it would swap places between reloads and
 * the board would look like it had reordered itself.
 */
let lastMs = -1
let seq = 0

/** Twelve bits of `rand_a`, per RFC 9562's monotonic-counter method. */
const SEQ_MAX = 0xfff

export function uuidv7(atMs: number): string {
  let ms = Math.max(0, Math.floor(atMs))

  if (ms > lastMs) {
    lastMs = ms
    const seed = new Uint8Array(2)
    fillRandom(seed)
    // Seeded in the low half so there is always counting room left in this
    // millisecond; a counter seeded near 0xfff overflows on its second id.
    seq = (((seed[0] ?? 0) << 8) | (seed[1] ?? 0)) & 0x7ff
  } else {
    ms = lastMs
    seq += 1
    if (seq > SEQ_MAX) {
      // 4096 ids inside one millisecond. Borrowing from the next millisecond
      // keeps the ids ordered and unique; the timestamp is then a few
      // milliseconds fast, which nothing reads.
      lastMs += 1
      ms = lastMs
      seq = 0
    }
  }

  const bytes = new Uint8Array(16)
  fillRandom(bytes)

  const hi = Math.floor(ms / 2 ** 32)
  const lo = ms % 2 ** 32
  bytes[0] = (hi >>> 8) & 0xff
  bytes[1] = hi & 0xff
  bytes[2] = (lo >>> 24) & 0xff
  bytes[3] = (lo >>> 16) & 0xff
  bytes[4] = (lo >>> 8) & 0xff
  bytes[5] = lo & 0xff
  bytes[6] = 0x70 | ((seq >>> 8) & 0x0f)
  bytes[7] = seq & 0xff
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f)

  const h = (i: number) => HEX[bytes[i] ?? 0] ?? '00'
  return (
    `${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-${h(8)}${h(9)}-` +
    `${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`
  )
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/* ------------------------------- node ids --------------------------------- */

/**
 * `atMs` is required, not defaulted to `Date.now()`.
 *
 * D26 is about more than the `TODAY` constant: a default clock is a clock
 * nobody passes, and the first tool to mint an id off the wall clock while
 * stamping `updatedAt` off `ctx.now` produces a record whose id and timestamp
 * disagree — which is invisible until a test tries to pin either one.
 */
export function newNodeId(type: NodeType, atMs: number): NodeId {
  return `${TYPE_PREFIX[type]}:${uuidv7(atMs)}`
}

/**
 * Splits an id into its type and its uuid, or returns null.
 *
 * Only the first colon separates and only a known prefix counts as a type, for
 * the reason `parseRef` gave before it was deleted: a pasted URL must survive
 * the round trip
 * rather than becoming `{ type: 'https', uuid: '//stripe.com' }`. Unlike
 * `parseRef`, a bare id with no prefix is not read as an application — it is
 * rejected, because guessing between six records is what the prefix exists to
 * stop.
 */
export function parseNodeId(id: string): { type: NodeType; uuid: string } | null {
  const at = id.indexOf(':')
  if (at <= 0) return null

  const type = TYPE_OF_PREFIX.get(id.slice(0, at))
  if (!type) return null

  const uuid = id.slice(at + 1)
  if (!UUID.test(uuid)) return null

  return { type, uuid }
}

/** The type an id claims, without caring whether the record exists. */
export function typeOfId(id: string): NodeType | null {
  return parseNodeId(id)?.type ?? null
}

export function isNodeId(id: unknown, expect?: NodeType): id is NodeId {
  if (typeof id !== 'string') return false
  const parsed = parseNodeId(id)
  return parsed !== null && (expect === undefined || parsed.type === expect)
}

/* ------------------------------- edge ids --------------------------------- */

/**
 * `${from}|${rel}|${to}` — exactly what `addEdge` inside `buildGraph`
 * (`lib/graph/build.ts`) already mints.
 *
 * The id being a function of its ends is what makes create and delete
 * idempotent with no read-before-write: linking the same keyword twice writes
 * the same key twice. The cost is that there can be no parallel edges, which is
 * accepted — every case for one here is really a timelineItem or a reified node.
 */
export function edgeId(from: NodeId, rel: Rel, to: NodeId): EdgeId {
  return `${from}|${rel}|${to}`
}

export function parseEdgeId(id: string): { from: NodeId; rel: Rel; to: NodeId } | null {
  const parts = id.split('|')
  if (parts.length !== 3) return null

  const [from, rel, to] = parts
  if (!from || !rel || !to || !REL_SET.has(rel)) return null
  if (!isNodeId(from) || !isNodeId(to)) return null

  return { from, rel: rel as Rel, to }
}

/* --------------------------------- slugs ---------------------------------- */

/**
 * Turns a display name into a slug.
 *
 * Deliberately the same rules as `slugify` and `toLabelId` before it — these
 * strings are read in exports and in the URL, and two spellings of one rule is
 * a question nobody should have to answer twice. A slug is no longer identity,
 * so drift now costs readability rather than splitting a keyword in half.
 */
export function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '-')
}

/**
 * Folded for comparison only — 'UT Austin' and '  ut austin ' are one keyword.
 *
 * Trim and lowercase, matching what the old keyword provider in `labels.tsx`
 * did exactly, so keywords minted before D14 still fold together. Deliberately NOT
 * `slugify`: matching on the slug misses a renamed keyword, because after a
 * rename the id says nothing about what the keyword is called, and 'developr'
 * can legitimately read "Developer".
 */
export function foldName(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * The first free slug in the 'unt', 'unt-2', 'unt-3' series.
 *
 * Counting from 2 so the first duplicate reads as the second of its name —
 * 'unt-1' would imply an 'unt-0' somewhere. Takes the slugs already spoken for
 * rather than a snapshot, so a caller can include rows it has staged inside a
 * transaction but not yet committed — which is what lets a bulk add drop ten
 * files with the same name and give each a distinct slug. Before the overlay,
 * `sortDrop` in `components/vault/files/intake.ts` had to work that around by
 * predicting this function's output; it no longer does.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base

  let n = 2
  while (used.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/**
 * Test seam only: resets the monotonic counter so a fixed clock mints the same
 * sequence twice. Never called by anything that ships — resetting it in a live
 * session would mint an id that already exists.
 */
export function resetIdCounterForTests(): void {
  lastMs = -1
  seq = 0
}
