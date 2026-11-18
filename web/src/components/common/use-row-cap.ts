import { useState } from 'react'

/** Rows a long list mounts at first, and how many more each "Show more" adds. */
export const ROW_PAGE = 100

/**
 * How many of `total` rows to mount, given the current page `limit` and the
 * index of a row that must be mounted however far down it is (`keep`, -1 for
 * none). Pure, so the arithmetic has a test that runs it; `useRowCap` is the
 * state around it, and the board calls it once per column (a hook cannot be
 * called once per stage in a loop). The phone's `mobile/src/lib/use-row-cap.ts`
 * is the same function.
 */
export function rowCap(total: number, limit: number, keep = -1) {
  const shown = Math.max(0, Math.min(total, Math.max(limit, keep + 1)))
  return { shown, hidden: total - shown }
}

/** Where `id` sits in `rows`, or -1 — the `keep` an open or arriving row asks for. */
export function indexOfId(rows: readonly { id: string }[], id: string | null | undefined): number {
  return id ? rows.findIndex((r) => r.id === id) : -1
}

/**
 * How many rows of a long list to mount.
 *
 * The Applications table, Vault Files and Vault Reminders rendered their whole
 * collection, every row with its popovers and menus: 2,000 records were 55,000
 * DOM nodes and seconds of main-thread work on load and on each search
 * keystroke. These lists keep their order, keyboard and arrival behaviour; they
 * just stop after a page, with a button for the next.
 *
 * `keep` is the index of a row that must be mounted however far down it is —
 * the row a link arrived at (`?focus=`) or the open record — so a cap never
 * hides the one row the page was opened to show.
 */
export function useRowCap(total: number, keep = -1) {
  const [limit, setLimit] = useState(ROW_PAGE)
  // Raised for good, not just while `keep` is set: the arrival parameter is
  // cleared a moment after it lands, and a cap that fell back then would
  // unmount the very row the page had just scrolled to.
  if (keep + 1 > limit) setLimit(keep + 1)
  const { shown, hidden } = rowCap(total, limit, keep)
  return {
    /** How many rows to render, from the top. */
    shown,
    /** How many are left unmounted. */
    hidden,
    more: () => setLimit(shown + ROW_PAGE),
  }
}
