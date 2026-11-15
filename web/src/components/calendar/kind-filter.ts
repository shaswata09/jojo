import type { LegendItem } from '@/components/charts/ChartLegend'
import type { TimelineItem, TimelineKind } from '@jojo/service/core/model'
import { KIND_ICON, KIND_LABEL, TIMELINE_KINDS } from '@/lib/timeline-visuals'

/**
 * The Calendar's event-type legend: one entry per kind, each a switch.
 *
 * Every kind, always, in the domain's legend order — not just the kinds this
 * month happens to hold. The entries are controls rather than a description of
 * the grid, and the hidden set outlives a page turn, so a type you switched off
 * in October must still be there to switch back on in a November that has none
 * of it. Entries that come and go by month would also move under the pointer.
 *
 * Kinds carry an icon and no colour. That is the colour law, not an omission:
 * on this page colour means how close a date is and nothing else, which is what
 * the date key beside this legend explains.
 */
export const KIND_LEGEND: readonly LegendItem[] = TIMELINE_KINDS.map((kind) => ({
  key: kind,
  label: KIND_LABEL[kind],
  icon: KIND_ICON[kind],
}))

/** The items whose kind the legend leaves switched on, in the order given. */
export function shownKinds<T extends Pick<TimelineItem, 'kind'>>(
  items: readonly T[],
  hidden: ReadonlySet<TimelineKind>,
): T[] {
  return items.filter((item) => !hidden.has(item.kind))
}

/**
 * The kind to switch back on so a `?focus=` link lands on its item.
 *
 * A link from ⌘K, a reminder or the dashboard names one item and tints it. If
 * that item's type is switched off, the tint has nothing to land on and the
 * page looks as though the link went nowhere — so the link wins over the
 * legend for that one type. Null when there is nothing to reveal.
 */
export function kindToReveal(
  focused: TimelineKind | undefined,
  hidden: ReadonlySet<TimelineKind>,
): TimelineKind | null {
  return focused !== undefined && hidden.has(focused) ? focused : null
}
