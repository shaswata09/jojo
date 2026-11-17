/**
 * Watching a phone that is sending, from a timer — and closing its socket at
 * the right moment.
 *
 * The requests arrive on the socket's callback, far from React, so the panel
 * polls `progress()` the way `receive-landing.ts` does for the other direction.
 * This is that poll's tick, pure so its two decisions can be tested without a
 * phone (D20).
 *
 * ## When "finished" is said, and when it is acted on
 *
 * The last chunk being HANDED to the socket is not the computer having it. The
 * socket writes and then closes (`handoff-server.ts`'s `reply`), and `stop()`
 * destroys every open socket at once — so stopping the instant the last chunk
 * was handed over would cut off the very write that finishes the transfer. The
 * receiving phone gets away with stopping at once because its last response is
 * empty; this one's is up to 64 KiB.
 *
 * So the tick says "finished" at once — the screen changes — and keeps
 * listening. The computer still has to ask its person before it replaces
 * anything, and it tells this phone what they decided (`outcome`). Only
 * `applied` means the computer holds these records, so only that is a handover
 * worth stamping; once any answer has come, the socket closes after a short
 * grace for the reply. A computer that never answers is bounded by `waitMs`.
 * Leaving the screen stops it sooner, which is the panel's cleanup, not this.
 *
 * ## Said once
 *
 * Both reports fire at most once per session. The poll runs every 250 ms and a
 * handover stamped on every tick would be a store write four times a second.
 */

import type { HandoffOutcome } from '@jojo/service/core/handoff'
import type { PullServing } from '@jojo/service/core/handoff-pull'

export type ServeSource = {
  progress: () => PullServing
  outcome: () => HandoffOutcome
  stop: () => void
}

/** What the computer said, or `unknown` if it never did. */
export type ServeOutcome = Exclude<HandoffOutcome, 'pending'> | 'unknown'

export type ServeReport = {
  /** Chunks handed over so far, and how many there are once known. */
  onProgress: (served: number, chunks: number | null) => void
  /** The last chunk was handed over. Once. */
  onFinished: () => void
  /** What the computer's person did with the records, or `unknown`. Once. */
  onOutcome: (outcome: ServeOutcome) => void
  /** Gathering the backup failed. Once. */
  onFailed: () => void
}

/** Long enough for a 64 KiB write on a slow network; short enough not to linger. */
export const SERVE_GRACE_MS = 10_000

/** How long a finished send waits for the computer to say what its person did. */
export const SERVE_OUTCOME_WAIT_MS = 10 * 60_000

export function createServeWatch(
  session: ServeSource,
  report: ServeReport,
  now: () => number,
  graceMs: number = SERVE_GRACE_MS,
  waitMs: number = SERVE_OUTCOME_WAIT_MS,
): () => void {
  let finishedAt: number | null = null
  let failedAt: number | null = null
  let answeredAt: number | null = null
  let stopped = false

  return () => {
    if (stopped) return
    const at = session.progress()
    report.onProgress(at.served, at.chunks)

    // Failed: said at once, and the socket kept open for the same grace as a
    // finish, so the 409 telling the computer why reaches it. Closing at once
    // cut that reply off, and the computer blamed the network (transfer
    // audit, 2026-11-16).
    if (at.failed && failedAt === null) {
      failedAt = now()
      report.onFailed()
    }
    if (at.finished && finishedAt === null) {
      finishedAt = now()
      report.onFinished()
    }
    if (finishedAt !== null && answeredAt === null) {
      const told = session.outcome()
      if (told !== 'pending') {
        answeredAt = now()
        report.onOutcome(told)
      } else if (now() - finishedAt >= waitMs) {
        answeredAt = now()
        report.onOutcome('unknown')
      }
    }
    // A failure closes after the grace; a finish only once the computer has
    // answered (or stopped being waited for), then after the same grace.
    const since = failedAt ?? answeredAt
    if (since !== null && now() - since >= graceMs) {
      stopped = true
      session.stop()
    }
  }
}
