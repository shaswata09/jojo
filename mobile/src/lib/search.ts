/**
 * The phone's door to the shared search predicate.
 *
 * `matchesQuery` and `fold` were declared here and, byte for byte, again in
 * `web/src/components/vault/search.ts`. They are now `@jojo/service/core/text`,
 * which is where the web copy's own header said they should end up — and what
 * finally moved them was `core/fit.ts` needing the same fold to score a posting
 * against a profile. A third copy in a repo whose lint step exists to stop the
 * service layer being copied was not a thing to write.
 *
 * This file stays as the import path every screen already uses, so nothing that
 * filters a list had to change to gain a shared implementation.
 */
export { fold, matchesQuery } from '@jojo/service/core/text'
