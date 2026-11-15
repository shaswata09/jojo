/**
 * The calculator's running history, as a pure step.
 *
 * Moved out of `Calculator.tsx` so the order and the cap can be tested without
 * mounting the pad (D20). Session-only, as before: this is the list, not where
 * it is kept.
 */

/** History is a short memory, not an audit log. */
export const MAX_HISTORY = 30

export type HistoryEntry = { id: number; expr: string; value: string }

/** Puts a worked sum on top, newest first, and lets the oldest fall off the end. */
export function withEntry(
  prev: readonly HistoryEntry[],
  expr: string,
  value: string,
  max: number = MAX_HISTORY,
): HistoryEntry[] {
  return [{ id: prev.length ? prev[0].id + 1 : 1, expr, value }, ...prev].slice(0, max)
}
