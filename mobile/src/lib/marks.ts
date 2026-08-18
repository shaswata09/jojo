import type { TimelineItem } from '@jojo/service/data/timeline'
import { dateMarkOn, markOn } from '@jojo/service/core/timeline-view'
import type { DateMark, Mark } from '@jojo/service/core/timeline-view'
import { TODAY } from '@/lib/today'
import type { Palette } from '@/theme/tokens'
import type { Tone } from '@/components/ui/Text'

/**
 * How close a dated thing is — and the only reading in the app allowed to
 * spend colour on a date.
 *
 * The colour law, stated once: **red is past due and nothing else, amber is
 * inside 48 hours and nothing else.** Everything further out is neutral however
 * important it is, and a completed item is never past due whatever its date
 * says — which is why `done` is checked first and outranked by nothing.
 *
 * Derived on every read rather than stored. `TimelineItem.urgency` is a
 * priority somebody typed into the seed: it paints the UT Austin deadline red
 * three days before it falls, the same red as a follow-up missed a week ago,
 * and it drifts the moment anything is rescheduled. Three screens each grew
 * their own copy of this rule and promptly disagreed — the calendar called
 * Oct 15 overdue while the week strip called Oct 12 amber. One function now,
 * so they cannot.
 */
export type { Mark }

/**
 * Bound here rather than re-exported, because the shared functions take `today`
 * as an argument and every call site in this app asks about a date without
 * holding a clock. `TODAY` is this app's one wall-clock read and nothing under
 * `@jojo/service` may import it (D26), so the binding is what `src/lib` is for
 * — the same shape `web/src/lib/timeline-visuals.ts` uses for the same pair.
 *
 * The two thresholds themselves are NOT spelled here any more. They were, and
 * so were web's, and so was the tool layer's, which is the arrangement that let
 * the calendar call Oct 15 overdue while the week strip called Oct 12 amber.
 */
export const markOfDate = (iso: string, today: string = TODAY): DateMark => dateMarkOn(today, iso)

export const markOf = (item: TimelineItem, today: string = TODAY): Mark => markOn(today, item)

/** The text tone a mark maps to, for `Txt`. */
export const markTone: Record<Mark, Tone> = {
  done: 'muted',
  overdue: 'danger',
  soon: 'warning',
  none: 'muted',
}

/** The literal colour, for an icon or a dot that cannot take a tone name. */
export function markColor(mark: Mark, c: Palette) {
  if (mark === 'overdue') return c.danger
  if (mark === 'soon') return c.warning
  return c.text3
}

/**
 * Which mark ranks higher when a single day holds several items.
 *
 * `done` ranks below everything, so a day whose work is finished shows the
 * hollow marker and a day with one live item still shows that item's colour.
 */
const RANK: Record<Mark, number> = { overdue: 3, soon: 2, none: 1, done: 0 }

export const strongestMark = (marks: Mark[]): Mark | undefined =>
  marks.reduce<Mark | undefined>(
    (best, mark) => (best === undefined || RANK[mark] > RANK[best] ? mark : best),
    undefined,
  )
