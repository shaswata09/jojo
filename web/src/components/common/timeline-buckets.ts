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
import { i18next } from '@/i18n/i18n'

/** Reading order: what is late, what is now, what is coming, what is finished. */
export const BUCKETS: TimelineBucket[] = ['overdue', 'today', 'upcoming', 'done']

/*
 * Getters, so each read is looked up in the language jojo is shown in at that
 * moment rather than frozen at import.
 */
export const BUCKET_LABEL: Record<TimelineBucket, string> = {
  get overdue() {
    return i18next.t('common:buckets.overdue')
  },
  get today() {
    return i18next.t('common:buckets.today')
  },
  get upcoming() {
    return i18next.t('common:buckets.upcoming')
  },
  get done() {
    return i18next.t('common:buckets.done')
  },
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
