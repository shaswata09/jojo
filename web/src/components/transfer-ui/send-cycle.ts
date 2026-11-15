/**
 * When the Transfer page replaces the code on screen, and when it shows it.
 *
 * The rule hangs on one fact: whether the phone's answer has been handed to
 * `pairing.complete` during the current run. Before that, the offer on screen
 * is still the live one the phone scanned, and the phone is still listening
 * under the path token derived from it — it answers `/pair` as often as it is
 * asked. A typo in the address, or a "No answer" while the wifi settles, is
 * fixed by typing again against the SAME offer. Minting a new one there
 * changed the token, so the corrected code reached the phone under a path it
 * had never seen and the person had to rescan.
 *
 * After it, the offer is spent either way. `complete` either agreed keys (and
 * the offer is single-use) or refused the answer, and a refused answer does not
 * get a second try against the same offer. So once that run is no longer
 * going, done, failed or abandoned, a new code goes up.
 *
 * Pure, so the rule is testable without mounting the page (D20).
 */
import type { SendStage } from '@/lib/handoff-send'
import type { PullStage } from '@/lib/handoff-pull'

/**
 * A run in either direction. Sending and receiving use the same offer the same
 * way — the phone reads it, the computer dials the phone — so one rule decides
 * when it is spent.
 */
export type RunStage = SendStage | PullStage

/**
 * The stages in which a run is still going and the offer it used is in use.
 *
 * Receiving adds two the person sits in: `confirming`, where what arrived waits
 * for a yes, and `restoring`. The offer was spent the moment the keys were
 * agreed, but a new code appearing behind the confirmation would invite a
 * second phone while the first one's records are still on screen.
 */
const IN_FLIGHT: ReadonlySet<RunStage> = new Set([
  'connecting',
  'packing',
  'sending',
  'receiving',
  'confirming',
  'restoring',
])

/**
 * Whether the page should replace the offer now.
 *
 * `answered` is true once the current run handed the phone's answer to
 * `complete`. A run that stopped before that — a code that did not parse, an
 * address that did not answer — leaves the offer the phone holds alone.
 */
export function replacesOffer(stage: RunStage, answered: boolean): boolean {
  return answered && !IN_FLIGHT.has(stage)
}

/**
 * Whether the stage card cycles the offer's frames.
 *
 * While waiting, and after a run that stopped: a failure before the answer
 * leaves the scanned offer live, and one after it has just put a new code up
 * that the person is told to scan. Never mid-run, when the offer is in use,
 * and not on the finished card, which has its own action for the next device.
 */
export function showsOffer(stage: RunStage): boolean {
  return stage === 'idle' || stage === 'failed'
}
