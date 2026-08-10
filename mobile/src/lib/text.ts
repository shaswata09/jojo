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
