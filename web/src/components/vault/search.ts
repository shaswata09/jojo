/**
 * The Vault's door to the shared search predicate.
 *
 * The rule itself is `@jojo/service/core/text` now, which is exactly where the
 * version of this file that declared it said it should end up. What moved it was
 * `core/fit.ts`: scoring a posting against a profile folds both sides the same
 * way, and writing these six lines a third time — in a repo whose lint step
 * exists to stop the service layer being copied — was not an option.
 *
 * WHAT DID NOT MOVE WITH IT. This app still has three rules for "does this
 * record match what the user typed", and they still differ on purpose: this one
 * folds accents and tests each field separately, `layout/SpotlightSearch.tsx`
 * splits on whitespace and requires every word, and `applications/list-query.ts`
 * joins the fields first so a query can straddle a boundary. Unifying them is a
 * decision about what the user sees rather than a file move, and the note has
 * travelled with the code rather than being lost in it.
 */
export { matchesQuery } from '@jojo/service/core/text'
