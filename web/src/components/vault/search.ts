/**
 * What the Vault's search box means, for all four tools.
 *
 * It lived at the bottom of `VaultToolbar.tsx`, exported from a module that
 * also exports two components — so every keystroke-level edit to the toolbar's
 * markup invalidated the predicate's module for Fast Refresh, and any surface
 * that wanted the rule had to import a React tree to get it. It is a domain
 * rule with no DOM in it, so it is a `.ts` file now.
 *
 * WHERE THIS SHOULD END UP: the service layer, beside the other two search
 * predicates this app has grown — the word-wise scorer in
 * `layout/SpotlightSearch.tsx` and the joined-haystack filter in
 * `applications/list-query.ts`. Three rules for "does this record match what
 * the user typed" is two too many, and the reconciliation is a decision about
 * behaviour, not a move: this one folds accents and matches per field, the
 * palette's splits on whitespace and requires every word, and the applications
 * one matches across a field boundary because it joins first. Whoever unifies
 * them has to pick, and the pick is visible to the user.
 *
 * HERMES NOTE, carry it if this moves: `\p{Diacritic}` is a unicode
 * property escape. `String.prototype.normalize('NFD')` needs full ICU, and both
 * are things a bare React Native runtime can be missing — the escape is a
 * parse-time failure, not a runtime one, so it takes the whole bundle down
 * rather than one search box.
 */

/**
 * Case- and accent-insensitive substring match across a record's fields.
 *
 * Normalised on both sides so "Andre" finds "André" — a job search collects
 * names typed by other people, and a filter that hides a row because of an
 * accent the user did not type reads as a missing record.
 */
export function matchesQuery(query: string, ...fields: (string | undefined)[]) {
  const needle = fold(query)
  if (!needle) return true
  return fields.some((field) => field && fold(field).includes(needle))
}

const fold = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
