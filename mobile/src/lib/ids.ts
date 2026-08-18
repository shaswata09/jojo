/**
 * Identity for records that are only unique within their own list.
 *
 * Six different records in the seed data answer to 'stripe': an application, a
 * deadline, a calendar event, an agenda event, a scout pipeline and a saved
 * posting — and 'rice', 'unt', 'tamu' and 'ut-austin' collide the same way. An
 * id on its own therefore cannot say what it points at, which is fine while
 * every list only talks to itself and wrong the moment anything links out of
 * one. A reference carries the kind alongside the id: 'app:stripe' is exact
 * where 'stripe' is a guess between six records.
 */

export const ENTITY_KINDS = [
  'app',
  'item',
  'link',
  'file',
  'snippet',
  'posting',
  'match',
  'pipeline',
] as const

export type EntityKind = (typeof ENTITY_KINDS)[number]

const KINDS: ReadonlySet<string> = new Set(ENTITY_KINDS)

/** The canonical form of a cross-entity reference — 'app:stripe'. */
export function refKey(kind: EntityKind, id: string) {
  return `${kind}:${id}`
}

/**
 * Splits a reference back into its parts.
 *
 * Tolerates a bare id with no kind, because the label store still keys most of
 * its records by one: `seedLabelsByRecord` in `@jojo/service/data/labels` is a single
 * flat map covering reminders, applications, links, files and snippets, and
 * `src/lib/labels.tsx` carries that shape into state. Applications in it are
 * spelled 'app:rice' — they are the ones whose ids collide with five other
 * lists — and everything else is still bare, so a bare key has to keep working.
 * It reads as an application, which is what an older stored key would have been.
 *
 * A prefix that is not a known kind counts as part of the id rather than as a
 * kind, so a pasted URL survives the round trip instead of becoming
 * `{ kind: 'https', id: '//stripe.com' }`. Only the first colon separates, for
 * the same reason.
 */
export function parseRef(key: string): { kind: EntityKind; id: string } {
  const at = key.indexOf(':')
  if (at === -1) return { kind: 'app', id: key }

  const kind = key.slice(0, at)
  if (!KINDS.has(kind)) return { kind: 'app', id: key }

  return { kind: kind as EntityKind, id: key.slice(at + 1) }
}

/**
 * Turns a display name into an id.
 *
 * Deliberately the same rules as `toLabelId` in `@jojo/service/data/labels`. That used to
 * be load-bearing for correctness — the two drifting would have split a keyword
 * in half — but `addLabel` now dedupes on the name rather than on the slug, so
 * drift costs readability, not identity. Worth keeping in lockstep anyway: these
 * ids are read in exports and in the URL, and two spellings of the same rule is
 * a question nobody should have to answer twice.
 */
export function slugify(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, '-')
}

/**
 * The first free id in the 'unt', 'unt-2', 'unt-3' series.
 *
 * Counting from 2 so the first duplicate reads as the second of its name —
 * 'unt-1' would imply an 'unt-0' somewhere. Takes the ids already spoken for
 * rather than a store, so a caller can include rows it has staged but not yet
 * committed. `base` is expected to be through `slugify` already; this only
 * settles collisions.
 */
export function uniqueId(base: string, taken: Iterable<string>) {
  const used = new Set(taken)
  if (!used.has(base)) return base

  let n = 2
  while (used.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}
