import { snoozeAnchor } from '@/components/common/snooze'
import type { TimelineItem } from '@/data/timeline'

/**
 * How long the row you just acted on stays put before it collapses.
 *
 * Ticking a reminder used to unmount its row in the same commit as the click:
 * the thing you pressed was gone before the pointer left it, and on a mis-click
 * there was nothing on screen to tell you which row had vanished. The hold
 * paints the outcome on the row itself — box ticked, title struck, or the new
 * date already showing — and only then takes it away.
 */
export const HOLD_MS = 400
export const COLLAPSE_MS = 220

/**
 * A row mid-flight, with the outcome of the click painted on it before the
 * store has been written.
 *
 * `held` shows `preview` merged over the record and does not move. `leaving`
 * collapses it to nothing. `arriving` is the same row re-inserted wherever the
 * write put it, expanding from nothing — so the two halves read as one journey
 * rather than a disappearance followed by an unrelated appearance.
 */
export type Transit = {
  phase: 'held' | 'leaving' | 'arriving'
  preview?: Partial<TimelineItem>
}

/**
 * Where a snooze counts from, over a whole item.
 *
 * The rule itself is `snoozeAnchor` in `components/common/snooze.ts` — this
 * file, `OwedThisWeek` and `PriorityActions` each used to carry their own copy,
 * and the note that said "change one and change the other" had three targets
 * and named two. `SNOOZE_STEPS` moved there with it.
 */
export const anchorOf = (item: TimelineItem) => snoozeAnchor(item.date)

export type RowActions = {
  toggle: (item: TimelineItem) => void
  edit: (item: TimelineItem) => void
  duplicate: (item: TimelineItem) => void
  remove: (item: TimelineItem) => void
  snooze: (item: TimelineItem, days: number) => void
  moveTo: (item: TimelineItem, iso: string) => void
  draft: (item: TimelineItem) => void
}
