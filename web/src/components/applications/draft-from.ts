/**
 * Moved to @/kg/core/parse-posting.
 *
 * It was imported by the removed `store-context.ts` — a domain write reaching UP into a
 * component folder for URL parsing, and the one layer violation the KG plan set
 * out to fix on the way past. The parser was always pure, so it moved down
 * rather than being rewritten.
 *
 * This file is a re-export so the dialog and the store keep compiling while the
 * remaining waves land; it goes with the rest of the compatibility façade in
 * Wave 4. Do not add anything to it.
 */

export { draftFromText, draftFromUrl } from '@/kg/core/parse-posting'
