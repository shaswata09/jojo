import { useState } from 'react'

/** Rows a long list mounts at first, and how many more each "Show more" adds. */
export const ROW_PAGE = 100

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
  const shown = Math.min(total, Math.max(limit, keep + 1))
  return {
    /** How many rows to render, from the top. */
    shown,
    /** How many are left unmounted. */
    hidden: total - shown,
    more: () => setLimit(shown + ROW_PAGE),
  }
}
