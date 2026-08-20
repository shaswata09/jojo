/**
 * The 'app:rice' wrapper the keyword chips still spell, and nothing else.
 *
 * This file used to be jojo's identity scheme: six different records in the seed
 * answered to 'stripe' — an application, a deadline, a calendar event, an agenda
 * event, a scout pipeline and a saved posting — so a reference carried the kind
 * alongside the id. That scheme is gone. Ids are type-prefixed UUIDv7 now (D4)
 * and `@jojo/service/core/ref` owns them: the type is IN the id, so nothing has
 * to be told what an id points at.
 *
 * What was left behind was three functions with no caller anywhere in this app,
 * each a second spelling of one that ships in `core/ref.ts`:
 *
 * - `parseRef` — replaced by `parseNodeId`, which REJECTS a bare string where
 *   this guessed it was an application. Its doc comment justified that guess by
 *   saying `src/lib/labels.tsx` "carries that shape into state", and by the time
 *   anyone read it that was not true of any file in this repo: D14 moved the
 *   keyword map into the graph, and `labels.tsx` has held a `Set<string>` of lit
 *   chip ids and nothing else ever since. A wrong comment costs more than a
 *   missing one, and this one was wrong about the file next to it.
 * - `uniqueId` — `uniqueSlug` under another name, down to the comment explaining
 *   why the series counts from 2.
 * - `slugify` — a third spelling of the rule `core/ref`'s `slugify` and
 *   `toLabelId` already write twice between them.
 *
 * Web deleted its three first and recorded why: "this file is one of the modules
 * the phone keeps in step by copying it across: dead code here is dead code
 * copied, and a second `uniqueId` on the far side of that copy is a slug
 * generator nobody knows is there." That is this side of the copy, deleted for
 * that reason and measured before it went — `parseRef`, `slugify` and `uniqueId`
 * had one reference each across all 102 files of `mobile/src`, their own
 * definition.
 *
 * `refKey` is the last tenant and is itself on the way out. `recordKey` in
 * `@jojo/service/react/use-keywords` exists to UNWRAP what it produces — an
 * application whose id is already 'app:0192…' arrives there as 'app:app:0192…'
 * — and it survives only because five call sites in `screens/` and `sheets/`
 * still spell it. When the last of those stops, both functions go, and this file
 * with them.
 */

// Not exported: nothing outside this file reads the list, only the type derived
// from it. It was exported alongside `EntityKind` and the export claimed a
// contract no consumer ever took up.
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
