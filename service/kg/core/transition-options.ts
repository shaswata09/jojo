/**
 * The choices the stage-transition dialog offers, and the words for them.
 *
 * Every lookup here is a `Record<K, string>` object literal with the key type
 * ANNOTATED, never `Object.fromEntries(…) as Record<K, string>`. The cast is the
 * difference between "a missing case is a compile error" and "a missing case
 * renders `undefined` in a dropdown" — this file had `OUTCOME_ACTION` written
 * the safe way and `OUTCOMES`/`OUTCOME_LABEL` written the unsafe way, six lines
 * apart, so a sixth outcome would have failed to compile at the bottom of the
 * file and passed silently at the top.
 */

import { OUTCOME_VALUES } from './model'
import type { Outcome } from './model'

export const FORMATS = [
  { value: 'phone', label: 'Phone' },
  { value: 'video', label: 'Video' },
  { value: 'onsite', label: 'Onsite' },
] as const

export type Format = (typeof FORMATS)[number]['value']

/**
 * The one cast left, and it cannot lie: `Format` is derived FROM `FORMATS`, so
 * the map is total by construction. The outcome maps below could not say that —
 * `Outcome` is declared in the model and the list here was a second copy of it.
 */
export const FORMAT_LABEL = Object.fromEntries(FORMATS.map((f) => [f.value, f.label])) as Record<
  Format,
  string
>

export const OUTCOME_LABEL: Record<Outcome, string> = {
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  accepted: 'Accepted',
  declined: 'Declined',
  ghosted: 'Ghosted — no reply',
}

/**
 * The dropdown's options, in the model's own order.
 *
 * Built from `OUTCOME_VALUES` rather than re-spelled, because the five strings
 * were previously written out here a second time under a plain type annotation
 * — which asserts every entry IS an `Outcome` and never that every `Outcome`
 * appears. A shorter list compiles.
 */
export const OUTCOMES: { value: Outcome; label: string }[] = OUTCOME_VALUES.map((value) => ({
  value,
  label: OUTCOME_LABEL[value],
}))

/** What the activity feed should say afterwards. */
export const OUTCOME_ACTION: Record<Outcome, string> = {
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  accepted: 'Offer accepted',
  declined: 'Offer declined',
  ghosted: 'Closed with no reply',
}
