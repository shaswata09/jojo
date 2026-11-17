import type { Stage } from '@/data/seed'

/**
 * What moving an application to each stage asks you for.
 *
 * Keyed by `Stage` and rendered against `STAGES` rather than listed out here,
 * so the labels are the app's own — "Screen" was renamed "Screening call" after
 * this kind of list was first written, and a guide holding its own copy of the
 * six names is a guide that goes on calling it Screen forever. An empty string
 * is the honest answer for the two stages the transition dialog skips: it does
 * not ask, so there is nothing to list.
 *
 * Verified against `stageNeedsDetails` and `TransitionForm` in
 * `applications/StageTransitionDialog.tsx`, which is the one place in the app
 * allowed to write an offer.
 *
 * Read in two places — the rail draws a pill beside every stage this is
 * non-empty for, and the list beside it prints the text — so it sits in a file
 * of its own rather than in either of them.
 *
 * The value is the catalog key of the sentence, not the sentence: a table of
 * words built at import time would stay in whatever language was showing then.
 */
export const STAGE_ASKS: Record<Stage, string> = {
  draft: '',
  submitted: 'overview.track.asks.submitted',
  screen: '',
  interview: 'overview.track.asks.interview',
  offer: 'overview.track.asks.offer',
  closed: 'overview.track.asks.closed',
}
