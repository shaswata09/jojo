import { useState } from 'react'

/** Rows a long list mounts at first, and how many more each "Show more" adds. */
export const ROW_PAGE = 100

/**
 * How many of `total` rows to mount, given the current page `limit` and the
 * index of a row that must be mounted however far down it is (`keep`, -1 for
 * none). Pure, so the arithmetic has a test; `useRowCap` is the state around it.
 */
export function rowCap(total: number, limit: number, keep = -1) {
  const shown = Math.max(0, Math.min(total, Math.max(limit, keep + 1)))
  return { shown, hidden: total - shown }
}

/** Where `id` sits in `rows`, or -1 — the `keep` a focus arrival asks for. */
export function indexOfId(rows: readonly { id: string }[], id: string | undefined): number {
  return id ? rows.findIndex((r) => r.id === id) : -1
}

/**
 * How many rows of a long list to mount — the phone's copy of the web's
 * `use-row-cap.ts`.
 *
 * Every long list on the phone (Applications and the board's columns, the
 * Vault's tools, the Job scout's matches and postings) drew its whole
 * collection inside the screen's one ScrollView: 2,000 records were 2,000 rows
 * built, laid out and kept alive on a device with no JIT, on load and again on
 * each search keystroke. They keep their order and arrival behaviour; they stop
 * after a page, with a button for the next.
 *
 * Not a FlatList. Each of these lists sits inside `Screen`'s ScrollView, where a
 * same-direction VirtualizedList warns and renders everything anyway, and the
 * arrival from search (`FocusTarget`) has to MEASURE its row — a row a
 * virtualised list has not drawn yet cannot be measured or scrolled to. A cap
 * that always includes the arrival row keeps both.
 *
 * `keep` is the index of a row that must be mounted however far down it is —
 * the row a search result, the graph or a Filed panel arrived at — so a cap
 * never hides the one row the screen was opened to show.
 */
export function useRowCap(total: number, keep = -1) {
  const [limit, setLimit] = useState(ROW_PAGE)
  // Raised for good, not just while `keep` is set: the route's `focus` is
  // cleared the moment it is taken, and a cap that fell back then would unmount
  // the very row the screen had just scrolled to.
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

/**
 * The last non-empty `focus` a screen was handed, kept after the route clears it.
 *
 * A screen's `focus` param is one-shot — cleared the moment `Screen` takes it —
 * but a capped list needs the id for as long as it is mounted, or the cap would
 * close back over the row it had just opened for. Set during render, not in an
 * effect, so the first render that sees the arrival already mounts the row.
 */
export function useLatchedFocus(focus: string | undefined): string | undefined {
  const [latched, setLatched] = useState(focus)
  if (focus && focus !== latched) setLatched(focus)
  return focus || latched
}
