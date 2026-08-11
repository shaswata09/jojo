import { timeLabel } from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'
import { MARK_DOT, MARK_TEXT } from '@/lib/timeline-visuals'
import type { Mark } from '@/lib/timeline-visuals'

/**
 * What the grid draws on an item — and the only thing the key under it has to
 * explain.
 *
 * `markOf` is derived from the date, not read off `item.urgency`. That field is
 * a hand-authored priority in the seed: it paints the UT Austin deadline red
 * three days before it falls, the same red as a follow-up missed a week ago,
 * and paints an already-overdue chase amber. Under the colour law red is past
 * due and nothing else and amber is inside 48 hours and nothing else — so a key
 * reading "Overdue / Due within 48 hours" beside those colours would have been
 * a second mismatch replacing the one it was sent to fix.
 *
 * The rule itself now lives in `lib/timeline-visuals.ts`, with the dashboard's
 * three copies of it. This route had the fourth.
 *
 * The chip body: only the two marks the key names carry a fill — everything
 * else is bare text, so a filled chip always means one of the two things
 * printed under the grid. `bg-well` on a `bg-well` cell was the same pixels
 * with none of that guarantee, and it turned into a visible box the moment the
 * cell changed colour under a drag.
 */
export const MARK_CHIP: Record<Mark, string> = {
  done: 'bg-transparent text-text-3',
  overdue: 'bg-danger-soft text-danger',
  soon: 'bg-warning-soft text-warning',
  none: 'bg-transparent text-text-2',
}

/** The dot the grid falls back to when a cell is too narrow for a chip. */
export const DAY_DOT: Record<Mark, string> = {
  ...MARK_DOT,
  done: 'border border-text-3 bg-transparent',
}

/** The kind icon in the day list. Green for done — the glance panel greys it. */
export const DAY_TEXT: Record<Mark, string> = {
  ...MARK_TEXT,
  done: 'text-success',
}

/**
 * '09:30' out of '09:30 – 10:15'.
 *
 * Sliced off the shared label rather than reformatted from `startMins`, so the
 * chip in the grid and the row in the day list cannot disagree about when
 * something starts. An item with no duration already reads as just the start,
 * and `split` hands that back whole.
 */
export const startLabel = (item: TimelineItem) => timeLabel(item)?.split(' – ')[0] ?? null
