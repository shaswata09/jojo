/**
 * How a dated item LOOKS on the web — and the web import path for how it reads.
 *
 * The file used to hold both halves. The half that is a rule — what each kind
 * is called, how close a date is, and whether `done` outranks the date — moved
 * to `@jojo/service/core/timeline-view`, because none of it is web-only and
 * all of it was being kept in step with the phone by copying the file across.
 * What stayed is the half that names a renderer: `KIND_ICON` is lucide,
 * `MARK_TEXT` and `MARK_DOT` are Tailwind class names, and neither means
 * anything to a native view. That split is the whole point —
 * `kg/react/toast.ts` and `src/lib/toast-context.ts` are the same shape, the
 * interface below the seam and the pieces that name a DOM above it.
 *
 * `dateMark` and `markOf` are re-bound here rather than re-exported, because the
 * shared versions take `today` as an argument and these do not: thirteen call
 * sites ask about a date without holding a clock, and `TODAY` is the web app's
 * one wall-clock read. Nothing under `service/kg` may import it (D26), so the
 * binding is what `src/lib` is for.
 */

import { AlarmClock, CalendarClock, FileText, Plane, Users, Video } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TimelineItem, TimelineKind } from '@jojo/service/core/model'
import { dateMarkOn, markOn } from '@jojo/service/core/timeline-view'
import type { DateMark } from '@jojo/service/core/timeline-view'
import { TODAY } from '@/lib/today'

export { KIND_LABEL, TIMELINE_KINDS } from '@jojo/service/core/timeline-view'
export type { DateMark, Mark } from '@jojo/service/core/timeline-view'

/**
 * Which glyph each kind draws.
 *
 * Four surfaces render the same timeline item — the dashboard's week, the glance
 * calendar, the Calendar page and the Vault's reminders — and each used to carry
 * its own copy of this map against its own narrower kind union. A kind added to
 * `TimelineKind` then compiled everywhere and rendered `undefined` as an icon in
 * whichever copy had been missed.
 *
 * `TIMELINE_KINDS` used to be derived from this map's keys. It is derived from
 * `KIND_LABEL` now — the legend order is a fact about the domain and had no
 * business depending on a lucide import — and the exhaustive `Record` type here
 * is what still makes a missing icon a compile error rather than a blank.
 */
export const KIND_ICON: Record<TimelineKind, LucideIcon> = {
  deadline: CalendarClock,
  interview: Video,
  visit: Plane,
  call: Users,
  prep: FileText,
  admin: AlarmClock,
  'follow-up': Users,
}

/** `dateMarkOn`, measured against the app's today. */
export const dateMark = (iso: string) => dateMarkOn(TODAY, iso)

/** `markOn`, measured against the app's today. */
export const markOf = (item: Pick<TimelineItem, 'date' | 'completedOn'>) => markOn(TODAY, item)

/**
 * The three date colours, shared.
 *
 * Keyed on `DateMark` and not on `Mark`, because `done` is the one entry the
 * surfaces genuinely disagree about — the Calendar route paints a completed
 * item's kind icon `text-success`, the glance panel greys it, and the day-cell
 * dot goes hollow rather than filled. Each spreads these three in and adds its
 * own fourth, so a disagreement has to be written down deliberately.
 */
export const MARK_TEXT: Record<DateMark, string> = {
  overdue: 'text-danger',
  soon: 'text-warning',
  none: 'text-text-3',
}

export const MARK_DOT: Record<DateMark, string> = {
  overdue: 'bg-danger',
  soon: 'bg-warning',
  none: 'bg-text-3',
}
