/**
 * The web import path for the job-posting parser.
 *
 * The implementation is `@jojo/service/core/parse-posting`. It was imported by
 * the removed `store-context.ts` — a domain write reaching UP into a component
 * folder for URL parsing, and the one layer violation the KG plan set out to fix
 * on the way past. The parser was always pure, so it moved down rather than
 * being rewritten.
 *
 * This file used to end "it goes with the rest of the compatibility façade in
 * Wave 4". Wave 4 shipped and it is still here, because its two callers —
 * `AddByUrl.tsx` and `routes/JobScout.tsx` — kept their import line when the
 * parser moved and there is nothing to gain from editing them, which is the
 * precedent `src/lib/undo.ts` and `src/lib/files.ts` set. Treat it as one of
 * those rather than as a leftover: a re-export and nothing else, and nothing
 * else may be added to it.
 */

export { draftFromText, draftFromUrl } from '@jojo/service/core/parse-posting'
