import type { TimelineBucket, TimelineItem } from '@/data/timeline'
import { TODAY } from '@/lib/today'

export const BUCKETS: TimelineBucket[] = ['overdue', 'today', 'upcoming', 'done']

export const BUCKET_LABEL: Record<TimelineBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  done: 'Completed',
}

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
 * Where a snooze counts from — a mirror of `useTimeline().snooze` in
 * store-context.ts, kept here only so the menu can print the date it is about
 * to write. Change one and change the other, or the label promises a Tuesday
 * and the store writes a Thursday.
 */
export const anchorOf = (item: TimelineItem) => (item.date < TODAY ? TODAY : item.date)

/**
 * The snooze steps, spelled two ways.
 *
 * The store counts from today only when an item is already overdue; for
 * anything dated ahead it counts from that date. So "Tomorrow" is a lie on a
 * reminder due next Friday — it would land on the Saturday. The `later`
 * spelling is used whenever the anchor is not today, which is the only way the
 * label can never claim a date the store is not going to write.
 */
export const SNOOZE_STEPS = [
  { days: 1, soon: 'Tomorrow', later: 'A day later' },
  { days: 3, soon: 'In 3 days', later: 'Three days later' },
  { days: 7, soon: 'In 7 days', later: 'A week later' },
]

export type RowActions = {
  toggle: (item: TimelineItem) => void
  edit: (item: TimelineItem) => void
  duplicate: (item: TimelineItem) => void
  remove: (item: TimelineItem) => void
  snooze: (item: TimelineItem, days: number) => void
  moveTo: (item: TimelineItem, iso: string) => void
  draft: (item: TimelineItem) => void
}
