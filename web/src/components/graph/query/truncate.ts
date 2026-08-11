/**
 * Elides a long label rather than wrapping it.
 *
 * Shared by the node pickers and the answer table because they sit in the same
 * two-column panel: a record whose name wrapped to a second line in one of them
 * and elided in the other would look like two different records.
 */
export const truncate = (s: string, n = 46) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
