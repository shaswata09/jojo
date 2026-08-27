/**
 * The poll that lands a finished transfer, and the latch that has to outlive
 * the question it asks.
 *
 * The socket is driven by the other device — chunks arrive on the server's
 * callback, far from React — so there is no event to subscribe to and the panel
 * reads `progress()` on a timer. That part is unchanged. What moved here is the
 * "only once" rule, because leaving it in the component put it where anything on
 * screen could undo it.
 *
 * ## The failure this exists to prevent
 *
 * `core/convoy.ts` LATCHES completion: `done` is set by the final authenticated
 * chunk and never cleared, and `payload()` rebuilds the same bytes on every
 * call. So "have we finished" is true forever after, and the only thing standing
 * between the poll and a second restore is the flag saying one has already been
 * offered.
 *
 * The panel kept that flag in a ref and cleared it in the confirmation sheet's
 * `onClose`, so that declining did not wedge the screen. Two consequences, both
 * of them bad:
 *
 *  - Cancel could not cancel. The sheet closed, 250 ms later the poll saw
 *    `complete` with the flag cleared, and "Replace everything on this phone?"
 *    came back. There was no way out of it but leaving the screen.
 *  - `ui/ConfirmSheet.tsx` calls `onClose()` BEFORE `onConfirm()`, so agreeing
 *    cleared the flag too. The first `applyPlan` was still mid-write when the
 *    next tick re-offered the same plan, and a second tap ran `repo.replaceAll`
 *    concurrently over the store the first one was replacing.
 *
 * So the flag is a closure variable created with the landing, and the landing is
 * created per session. Nothing outside can reach it: declining is a UI event and
 * cannot reopen a transfer, and the only thing that makes this phone ask again
 * is a new pairing, which is a new session and therefore a new latch.
 */

import type { RestorePlan } from '@jojo/service/core/backup'
import type { ReceiveSession } from '@/lib/handoff-receive'
import { planReceived } from '@/lib/restore-received'

/**
 * The three things landing needs from a session — deliberately not the whole
 * `ReceiveSession`, so that the address and the agreed keys are out of reach of
 * something whose job is to read a byte count.
 */
export type LandingSource = Pick<ReceiveSession, 'progress' | 'payload' | 'stop'>

/** Where a tick's findings go. Every one of these is a `setState` in the panel. */
export type LandingReport = {
  /** Bytes accepted so far, on every tick, so the readout moves. */
  onBytes: (bytes: number) => void
  /** Authenticated, read, and waiting on the person. Fires at most once. */
  onPlan: (plan: RestorePlan) => void
  /** Authenticated bytes that were not a backup this build can read. */
  onFailure: (message: string) => void
}

/**
 * Returns the function to call on each poll tick, for one session only.
 *
 * `complete` is the only point any of this is safe to act on: `core/convoy.ts`
 * puts the final flag in the AAD precisely so a truncated transfer cannot
 * masquerade as a finished one, so acting earlier would mean replacing the
 * person's records with part of a backup.
 */
export function createLanding(session: LandingSource, report: LandingReport): () => void {
  /*
   * Set the instant the last chunk authenticates, and never cleared.
   *
   * Restoring is not idempotent — it replaces the whole store — so a second run
   * started by the next tick would replace what the first had just written.
   */
  let offered = false

  return () => {
    const at = session.progress()
    report.onBytes(at.bytes)
    if (!at.complete || offered) return
    offered = true

    const payload = session.payload()
    if (payload === null) return
    // Nothing more is coming, and a socket left listening after the transfer is
    // a port open on somebody's phone with nothing on screen about it.
    session.stop()

    /*
     * Read, then ASK. Applying used to start here, and `replaceAll` took every
     * record, every document and the journal off the phone with nothing on
     * screen having asked. Pairing is consent to receive; it is not consent to
     * destroy what is already here.
     */
    const read = planReceived(payload)
    if (!read.ok) {
      report.onFailure(read.message)
      return
    }
    report.onPlan(read.plan)
  }
}
