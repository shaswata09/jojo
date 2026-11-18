/**
 * The app's small prose helpers.
 *
 * Each of these was written out two or three times across the screens, and the
 * copies had already drifted.
 *
 * No `plural` or `listJoin` here any more (review 2026-11-18, docs-6): both
 * only ever spoke English — "3 days", "a, b and c" — in an app read in twenty
 * languages, and nothing called them. A count goes through a catalog plural
 * (`t('key', { count })`) and a list through `listJoiner(t)` in `graph-view.ts`.
 */

/** 'yesterday' → 'Yesterday'. For a label that stands alone rather than mid-phrase. */
export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * UTF-8 length without a TextEncoder.
 *
 * Hermes has one, but the shared layer counts bytes by hand for portability and
 * the two numbers have to agree — a capture labelled '1.2 MB' on the phone and
 * '2.4 MB' on the web is the same file described twice.
 *
 * It lived in `PostingBrowserScreen` until a second saver of pages arrived. Two
 * copies of a size calculation is two ways for that mismatch to come back, and
 * this file exists for exactly that failure — see the note at the top.
 */
export function byteLengthOf(text: string): number {
  let bytes = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}
