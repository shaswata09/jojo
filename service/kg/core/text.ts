/**
 * What "does this record match what the user typed" means, once.
 *
 * This is the move `web/src/components/vault/search.ts` asked for in its own
 * header — "WHERE THIS SHOULD END UP: the service layer" — and it arrived here
 * because a third caller finally needed it. `core/fit.ts` scores a posting
 * against a profile and folds both sides to do it; putting a fourth copy of
 * these six lines beside it, in a repo whose lint step exists to stop the
 * service layer being copied, was not an option.
 *
 * WHAT DID NOT MOVE, and deliberately. This app has three rules for matching
 * typed text and they behave differently on purpose: this one folds accents and
 * tests each field separately, the command palette's splits on whitespace and
 * requires every word, and `applications/list-query.ts` joins the fields first
 * so a query can straddle a boundary. Unifying them is a decision about what the
 * user sees, not a file move, and whoever makes it has to pick a behaviour.
 * Moving this one down does not make that decision.
 *
 * HERMES NOTE, carried from the file this came from: `\p{Diacritic}` is a
 * unicode property escape and `String.prototype.normalize('NFD')` needs full
 * ICU. Both are things a bare React Native runtime can be missing, and the
 * escape fails at PARSE time rather than at runtime — so a bundle that lacks it
 * does not lose one search box, it does not start.
 */

/**
 * Trimmed, lowercased, and stripped of accents.
 *
 * Both sides of every comparison go through it, so "Andre" finds "André" — a job
 * search collects names typed by other people, and a filter that hides a row
 * over an accent the user did not type reads as a missing record.
 */
export const fold = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

/**
 * Case- and accent-insensitive substring match across a record's fields.
 *
 * Every list that filters by typing goes through this: the Vault's tools, the
 * applications list and the phone's search screen. They were each doing their
 * own `.toLowerCase().includes()`, which meant six lists and one of them
 * treating "Muñoz" as unfindable.
 *
 * `null` is accepted alongside `undefined` because half the projections spell an
 * absent field one way and half the other, and a search predicate is the wrong
 * place to make a caller care which.
 */
export function matchesQuery(query: string, ...fields: (string | undefined | null)[]): boolean {
  const needle = fold(query)
  if (!needle) return true
  return fields.some((field) => field && fold(field).includes(needle))
}
