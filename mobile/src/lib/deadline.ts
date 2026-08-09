import type { TimelineItem } from '@/data/timeline'

/** What the seed's application deadlines say, and what ApplicationDialog writes. */
export const DEADLINE_DETAIL = 'Application deadline'

/**
 * The one dated item the application form owns.
 *
 * Told apart from every other `kind: 'deadline'` on the same application by the
 * detail line. Baylor's only deadline is its offer-response date — matching on
 * kind alone would let the form's date field move, or clear, a decision
 * deadline nobody touched.
 *
 * It lives here rather than inside the dialog because two files now have to
 * agree on it: the dialog writes the item, and whoever opens the dialog in edit
 * mode has to prefill the date field from the very same item. Prefill it from a
 * different one and an untouched field reads as a change, which mints a second
 * deadline on every edit.
 */
export const isApplicationDeadline = (item: TimelineItem) =>
  item.kind === 'deadline' && (item.detail ?? '').startsWith(DEADLINE_DETAIL)

export const applicationDeadlineOf = (items: TimelineItem[]) => items.find(isApplicationDeadline)
