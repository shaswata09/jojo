/**
 * The phone's door to the shared search predicates.
 *
 * `matchesQuery` and `fold` were declared here and, byte for byte, again in
 * `web/src/components/vault/search.ts`. They are now `@jojo/service/core/text`,
 * which is where the web copy's own header said they should end up — and what
 * finally moved them was `core/fit.ts` needing the same fold to score a posting
 * against a profile. A third copy in a repo whose lint step exists to stop the
 * service layer being copied was not a thing to write.
 *
 * `matchesQuery` HERE is `matchesWords` (`core/word-match.ts`): accents folded,
 * the query split on words, every word somewhere in the record's fields. It is
 * the rule the web's ⌘K palette uses, so the phone's search and the web's find
 * the same things — "rice stat" finds "Rice — Statistics" here as it does there,
 * and "theme" finds "Thème" there as it does here. For a one-word query it is
 * exactly the old per-field substring match, so the lists filtered through it
 * lose nothing; a several-word query now finds a record whose words are spread
 * over its fields, rather than nothing.
 *
 * This file stays as the import path every screen already uses, so nothing that
 * filters a list had to change to gain a shared implementation.
 */
export { fold } from '@jojo/service/core/text'
export { matchesWords as matchesQuery } from '@jojo/service/core/word-match'
