/**
 * The app's small prose helpers.
 *
 * Each of these was written out two or three times across the screens, and the
 * copies had already drifted — one `plural` took the plural form as an argument
 * and another appended an 's', so "1 saved item" and "1 replies" could both
 * reach a toast.
 */

/** `1 day` · `3 days`. Pass `many` where an 's' will not do. */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** `a` · `a and b` · `a, b and c`. */
export function listJoin(parts: string[]) {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** Sentence fragments joined by the app's one separator. Empty parts drop out. */
export const sentence = (...parts: (string | undefined | false | null)[]) =>
  parts.filter(Boolean).join(' · ')

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
