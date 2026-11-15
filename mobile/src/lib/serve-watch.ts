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
 * So the tick says "finished" at once — the handover is stamped and the screen
 * changes — and stops listening only after a grace period. Leaving the screen
 * stops it sooner, which is the panel's cleanup, not this.
 *
 * ## Said once
 *
 * Both reports fire at most once per session. The poll runs every 250 ms and a
 * handover stamped on every tick would be a store write four times a second.
 */

import type { PullServing } from '@jojo/service/core/handoff-pull'

export type ServeSource = { progress: () => PullServing; stop: () => void }

export type ServeReport = {
  /** Chunks handed over so far, and how many there are once known. */
  onProgress: (served: number, chunks: number | null) => void
  /** The last chunk was handed over. Once. */
  onFinished: () => void
  /** Gathering the backup failed. Once. */
  onFailed: () => void
}

/** Long enough for a 64 KiB write on a slow network; short enough not to linger. */
export const SERVE_GRACE_MS = 10_000

export function createServeWatch(
  session: ServeSource,
  report: ServeReport,
  now: () => number,
  graceMs: number = SERVE_GRACE_MS,
): () => void {
  let finishedAt: number | null = null
  let failed = false
  let stopped = false

  return () => {
    if (stopped) return
    const at = session.progress()
    report.onProgress(at.served, at.chunks)

    if (at.failed && !failed) {
      failed = true
      // Nothing was handed over, and nothing will be: close now.
      stopped = true
      session.stop()
      report.onFailed()
      return
    }

    if (at.finished && finishedAt === null) {
      finishedAt = now()
      report.onFinished()
    }
    if (finishedAt !== null && now() - finishedAt >= graceMs) {
      stopped = true
      session.stop()
    }
  }
}
