/**
 * The 'app:rice' wrapper the keyword chips still spell, and nothing else.
 *
 * This file used to be jojo's identity scheme: six different records in the seed
 * answered to 'stripe', so a reference carried the kind alongside the id. That
 * scheme is gone. Ids are type-prefixed UUIDv7 now (D4) and `kg/core/ref.ts`
 * owns them — the type is IN the id, so nothing has to be told what an id points
 * at, and `parseNodeId` rejects a bare string where `parseRef` used to guess it
 * was an application.
 *
 * What was left behind was three functions with no caller outside this file's
 * own test, each a second spelling of one that ships in `kg/core/ref.ts`:
 *
 * - `parseRef` — replaced by `parseNodeId`, which rejects the bare key rather
 *   than guessing. Its tolerance existed for `seedLabelsByRecord`, which
 *   `repo/seed.ts` reads once and nothing writes.
 * - `uniqueId` — byte-identical to `uniqueSlug`, down to the comment explaining
 *   why the series counts from 2, and tested twice with the same four cases.
 * - a re-export of `slugify` — added so `sortDrop` could predict a slug across
 *   two copies of one function; `sortDrop` stopped needing to predict anything
 *   when the transaction overlay landed, and no import survived.
 *
 * They were deleted rather than left, because this file is one of the modules
 * the phone keeps in step by copying it across: dead code here is dead code
 * copied, and a second `uniqueId` on the far side of that copy is a slug
 * generator nobody knows is there.
 *
 * `refKey` is the last tenant and is itself on the way out. `recordKey` in
 * `kg/react/use-keywords.ts` exists to UNWRAP what it produces — an application
 * whose id is already 'app:0192…' arrives there as 'app:app:0192…' — and it
 * survives only because eight call sites in `components/applications` and
 * `routes/Applications.tsx` still spell it. When the last of those stops, both
 * functions go, and this file with them.
 */

// Not exported: nothing outside this file reads the list, only the type derived
// from it. It was exported alongside `EntityKind` and the export claimed a
// contract that no consumer ever took up.
const ENTITY_KINDS = [
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

/**
 * The canonical form of a cross-entity reference — 'app:stripe'.
 *
 * Every live call site passes 'app'. The other seven kinds are kept because the
 * union is what stops a caller inventing an eighth spelling on the way out.
 */
export function refKey(kind: EntityKind, id: string) {
  return `${kind}:${id}`
}
