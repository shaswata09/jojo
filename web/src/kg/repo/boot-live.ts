/**
 * L2 — a durable repository wrapped in the three things another tab can do to it.
 *
 * Split out of `boot.ts` because it is the only part of booting that keeps
 * running after boot has returned: every subscription made here lives until
 * `Session.dispose`, and every one of them is a way the graph changes without
 * this tab asking. Whatever is wrong with "the other tab's edit did not show up"
 * or "my undo stack vanished" is in this file.
 */

import { validateRows } from '../core/validate'
import type { Diagnostic } from '../core/validate'
import { kgWarn } from '../log'
import type { Driver, StoreEvent } from '../storage/driver'
import type { StoredRow } from '../storage/schema'
import type { DurableBootOptions, Session } from './boot'
import { readJournalRows } from './journal'
import { readMeta } from './meta'
import { onRemoteCommit } from './repository'
import type { Repository } from './repository'

/**
 * D23's 50 ms. Below what a person notices, above the gap between two drains.
 *
 * It lives here rather than in `storage/channel.ts`, where it reads like it
 * belongs, because `repo` may not import that file — see the note at the bottom
 * of it. Which is the right side of the seam anyway: the number is chosen for
 * the cost of the rehydrate, and the rehydrate is here.
 */
const REMOTE_DEBOUNCE_MS = 50

/**
 * Coalesces a burst of remote commits into one rehydrate.
 *
 * Another tab saving a form drains once, but a bulk file add or a drag across
 * the board drains repeatedly and each drain posts. Rehydrating per message
 * would rebuild the snapshot five times and — because a remote change clears the
 * undo stack — do it five times while the user is looking at the result.
 *
 * Trailing edge only. A leading edge would rehydrate on the first message of a
 * burst, and the first message is the one most likely to be describing a batch
 * that is still being written.
 */
function debounceEvents(fn: (event: StoreEvent) => void, ms: number): (event: StoreEvent) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let last: StoreEvent | null = null

  return (event) => {
    last = event
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const pending = last
      last = null
      if (pending) fn(pending)
    }, ms)
  }
}

/** The id of the newest journal row on disk, which is the store's high-water mark. */
function newestJournalId(rows: readonly StoredRow[]): string | null {
  const last = rows[rows.length - 1]
  const id = last?.['id']
  return typeof id === 'string' ? id : null
}

/**
 * Wraps a durable repository with the three things another tab can do to it.
 *
 * Every subscription here is dropped by `dispose`, and none is optional.
 * Ignoring `blocking` is R-4 — the deadlock that never shows up in development,
 * because you are only ever running one build — and ignoring a remote commit is
 * a tab that goes on showing records another tab deleted, with an undo stack
 * that would put them back.
 *
 *
 * THE THIRD ONE: WHAT HAPPENS WHEN THERE IS NO CHANNEL
 *
 * Every guarantee above rides on BroadcastChannel, and a browser can simply not
 * have one — Safari before 15.4, or any frame with an opaque origin, where
 * constructing one throws. `storage/channel.ts` falls back to a channel that
 * carries nothing, which used to be described as leaving you with "a single-tab
 * app". It does not. It leaves you with two tabs that overwrite each other's
 * records in silence, and a stale undo stack in each that will replay over the
 * other's work with before-images captured minutes ago.
 *
 * So when the store reports `crossTab: false`, the same adoption runs on tab
 * resume instead. Later than a channel and bounded rather than immediate, but it
 * closes both losses: the tab re-reads before it can write anything else, and
 * the undo stack goes with the rehydrate. On a browser WITH a channel this
 * subscription is never made, so nothing changes for anybody else.
 */
export function live(
  driver: Driver,
  repo: Repository,
  options: DurableBootOptions,
  parts: { problems: readonly string[]; skipped: readonly Diagnostic[]; crossTab: boolean },
): Session {
  /**
   * Re-reads the store and adopts it. Reports whether it actually rehydrated.
   *
   * `announce` is separate from the rehydrate because the two paths in want
   * different things from it. A channel message means another tab definitely
   * wrote, so the toast is always right. A resume means we are catching up
   * blind, and most catch-ups find nothing.
   */
  const adopt = async (announce: boolean): Promise<boolean> => {
    const again = await driver.readAll()
    if (!again.ok) {
      kgWarn('a remote change arrived but the store could not be re-read', {
        detail: again.error.message,
      })
      return false
    }
    const stored = readMeta(again.value.meta)
    if (stored === null || stored === 'corrupt') {
      // The other tab emptied or replaced the store and we caught it mid-write.
      // Leaving our own reading in place is the conservative answer: it is
      // stale, which a reload fixes, rather than empty, which looks like data
      // loss and would offer to reseed over it.
      kgWarn('a remote change arrived but the store has no readable meta row')
      return false
    }
    const validated = validateRows(again.value.nodes, again.value.edges)
    repo.rehydrate(
      { nodes: validated.nodes, edges: validated.edges },
      stored,
      readJournalRows(again.value.ops),
    )
    if (announce) options.onRemoteChange?.()
    return true
  }

  const unsubscribeRemote = driver.onRemoteCommit(
    debounceEvents((event) => {
      // flush -> rehydrate -> clear the undo stack, in that order (D23). Our own
      // queued ops are last-write-wins against theirs, so draining them after we
      // rehydrate would replay our stale rows over their fresh ones.
      void onRemoteCommit(repo, event, async () => {
        await adopt(true)
      })
    }, REMOTE_DEBOUNCE_MS),
  )

  const unsubscribeBlocking = driver.onBlocking(() => {
    kgWarn('another tab is upgrading the database; this one has closed its connection')
    options.onBlocking?.()
  })

  /**
   * The catch-up, for a browser that cannot be told.
   *
   * Runs the same flush -> rehydrate -> clear sequence a remote commit does, and
   * unconditionally: we have no way to know whether another tab wrote while we
   * were hidden, and guessing wrong in the "nothing happened" direction is the
   * loss this exists to prevent. Rehydrating when nothing changed is a ~5 ms
   * no-op on screen.
   *
   * The one thing held back is the TOAST. `onRemoteChange` announces that undo
   * history was cleared, and firing it every time the user alt-tabs back would
   * be a notification about nothing, several times an hour. So it is raised only
   * when the newest journal row on disk is not the one we already had — which is
   * a reliable "somebody else wrote" for every case except our own last write
   * being newest, and in that case there is nothing new to announce anyway.
   */
  const unsubscribeResume =
    parts.crossTab || !options.onResume
      ? () => {}
      : options.onResume(() => {
          void (async () => {
            // Same order as D23's, and for the same reason: our queued ops are
            // last-write-wins against theirs, so draining after the rehydrate
            // would replay our stale rows over their fresh ones.
            await repo.flush()
            const ours = repo.audit[0]?.id ?? null
            const seen = await driver.readAll()
            const changedElsewhere = seen.ok && newestJournalId(seen.value.ops) !== ours
            const rehydrated = await adopt(false)
            if (rehydrated) repo.clearHistory()
            if (rehydrated && changedElsewhere) options.onRemoteChange?.()
          })()
        })

  return {
    repo,
    // Delegated, never copied — see `bootInMemory`. On this path there is a
    // second writer too: a remote rehydrate adopts the other tab's meta row.
    get meta() {
      return repo.meta
    },
    problems: parts.problems,
    skipped: parts.skipped,
    durable: true,
    dispose() {
      unsubscribeRemote()
      unsubscribeBlocking()
      unsubscribeResume()
      repo.close()
    },
  }
}
