import type { TimelineItem } from '@/data/timeline'
import { DEADLINE_DETAIL } from '@/kg/tools/support'

/**
 * Re-exported, not redeclared.
 *
 * This file used to spell `'Application deadline'` out a second time, beside a
 * near-identical copy of the comment below. It is a SENTINEL: the rule that
 * tells the form's own deadline apart from every other `kind: 'deadline'` on the
 * same application is `detail.startsWith(DEADLINE_DETAIL)`, and it is applied on
 * both sides of the tool boundary — `kg/tools/application-fields.ts` reads it
 * off the graph, this reads it off a projection. Two spellings of a sentinel do
 * not fail loudly when they drift; they simply stop matching, and the form
 * silently mints a second deadline on every edit instead of moving the first.
 */
export { DEADLINE_DETAIL }

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
const isApplicationDeadline = (item: TimelineItem) =>
  item.kind === 'deadline' && (item.detail ?? '').startsWith(DEADLINE_DETAIL)

export const applicationDeadlineOf = (items: TimelineItem[]) => items.find(isApplicationDeadline)
