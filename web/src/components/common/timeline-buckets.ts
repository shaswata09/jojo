/**
 * The four buckets a dated item falls into, and the two things a screen says
 * about one: what it is called, and what colour it reads in.
 *
 * `BUCKETS` and `BUCKET_LABEL` were the reminders list's, under `vault/`, and
 * the colour map was written out twice — once there and once on the application
 * detail page's dates panel — because a panel in another feature could not
 * reasonably import from a sibling feature's folder. Both maps are annotated
 * `Record<TimelineBucket, string>` rather than cast, so a fifth bucket is a
 * compile error in both.
 */

import type { TimelineBucket } from '@/data/timeline'

/** Reading order: what is late, what is now, what is coming, what is finished. */
export const BUCKETS: TimelineBucket[] = ['overdue', 'today', 'upcoming', 'done']

export const BUCKET_LABEL: Record<TimelineBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  done: 'Completed',
}

/**
 * Red for late, amber for today, neutral for everything else.
 *
 * 'done' is deliberately the same neutral as 'upcoming' rather than a green:
 * green in this app means an outcome, and a ticked reminder is housekeeping.
 */
export const BUCKET_TEXT: Record<TimelineBucket, string> = {
  overdue: 'text-danger',
  today: 'text-warning',
  upcoming: 'text-text-3',
  done: 'text-text-3',
}
