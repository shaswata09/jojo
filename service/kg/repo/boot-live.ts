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
import type { Driver, Rows, StoreEvent } from '../storage/driver'
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

/**
 * Whether the store holds a write this tab did not make.
 *
 * Only the resume path asks. A channel message is proof on its own; this is for
 * the browser that has no channel and has to work it out from the store.
 *
 * Called AFTER our own flush, so everything this tab has done is on disk and in
 * `repo.audit`, and the only question left is what ELSE is there.
 *
 * TWO CHEAPER SIGNALS, BOTH UNSOUND. Neither is a hypothetical: the first is
 * what this file used to compute, and it is still fine for the toast it gated.
 *
 * - "is the newest journal row the newest one of ours?" Our own flush appends to
 *   the same store, so a tab with queued writes ends up newest and the answer
 *   comes back "nothing changed" even when the other tab wrote a second earlier.
 *   It reports safe exactly when it is not, which is the one direction a signal
 *   guarding an undo stack may not fail in.
 * - the meta row. `lastOpenedAt` is stamped by every boot, so a second tab merely
 *   OPENING would read as a change; and nothing in meta moves when a tool edits a
 *   record, so the writes that matter would not read as one.
 *
 * So the journal is walked back from the newest row instead, and an id we have
 * never seen is another tab. Our own rows cannot mask it — they are in the very
 * ring being tested against — which is the whole difference from the first
 * signal above. The walk stops at the age of the oldest entry we hold rather
 * than at its id: `audit` is capped at 200, so on a long session the rows below
 * that are ones we dropped, not ones we missed, and an id-bounded walk would
 * have stopped at our oldest entry and never looked at the other tab's row
 * sitting one place below it.
 *
 * The row counts catch the write that leaves no journal row at all: `replaceAll`
 * — Settings → Empty, and import — clears `ops` on its way past, so a tab that
 * has committed nothing has no journal to compare. Counted raw first and
 * validated only when they disagree, because `validateRows` is what built the
 * snapshot: a store holding one unreadable row would otherwise be "changed" on
 * every single resume, forever.
 */
function changedElsewhere(rows: Rows, repo: Repository): boolean {
  const audit = repo.audit
  const known = new Set(audit.map((entry) => entry.id))
  // `Ring.entries` is newest first, so the last one is the oldest we hold.
  const horizon = audit[audit.length - 1]?.at ?? null

  const onDisk = readJournalRows(rows.ops)
  for (let i = onDisk.length - 1; i >= 0; i -= 1) {
    const entry = onDisk[i]
    if (!entry) continue
    if (horizon !== null && entry.at < horizon) break
    if (!known.has(entry.id)) return true
  }

  const graph = repo.getSnapshot()
  const nodes = graph.nodes().length
  const edges = graph.edges().length
  if (rows.nodes.length === nodes && rows.edges.length === edges) return false
  const validated = validateRows(rows.nodes, rows.edges)
  return validated.nodes.length !== nodes || validated.edges.length !== edges
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
   * Runs the same flush -> rehydrate -> clear sequence a remote commit does,
   * gated on `changedElsewhere` — the store itself holding a write we did not
   * make. Rehydrating is not the ~5 ms no-op it was once described as when
   * nothing changed: `repo.rehydrate` empties the undo and redo rings on its way
   * past (`rehydrate` in `repository.ts`; the `clearHistory` below is belt and
   * braces, not the thing that does it).
   *
   * This used to be unconditional, with only the TOAST held back — defended
   * there as the conservative choice, since we cannot know what happened while
   * we were hidden. It is not conservative on the browsers this path exists for.
   * `visibilitychange` fires on every alt-tab, so on Safari <= 15.3 or in an
   * opaque-origin frame the undo stack was emptied several times an hour, ⌘Z
   * was dead from the first tab switch on, and the one thing held back was the
   * sentence that would have explained it.
   *
   * What was right about the old stance is that the gate has to be a signal that
   * cannot say "nothing changed" when something did — see `changedElsewhere`,
   * which is also where the two signals that CAN are written down.
   *
   * There is one case it does not distinguish and one that never reaches it, and
   * they resolve OPPOSITE ways. A store holding rows we could not validate reads
   * as changed, and adopt-and-announce is right there: the graph on disk really
   * is out of step with ours and the recovery banner is already saying so. A
   * flush that settled with our own ops still pending — which `queue.flush` does
   * by design, it settles on a failed attempt — never gets this far: the health
   * check twelve lines below returns first, because `adopt` would take the disk
   * rows wholesale and overwrite the graph with a version missing exactly the
   * writes the queue could not save. This paragraph used to list that second case
   * beside the first as also resolving to adopt-and-announce, which is the
   * opposite of what the code does and of what the comment at the gate says.
   */
  const unsubscribeResume =
    parts.crossTab || !options.onResume
      ? () => {}
      : options.onResume(() => {
          void (async () => {
            // Same order as D23's, and for the same reason: our queued ops are
            // last-write-wins against theirs, so draining after the rehydrate
            // would replay our stale rows over their fresh ones. It also puts
            // our own writes on disk BEFORE we ask what is on disk, which is
            // what lets `changedElsewhere` treat anything it does not recognise
            // as somebody else's.
            await repo.flush()
            // `flush()` settles on a FAILED attempt, so reaching here does not
            // mean our rows are on disk. When our own queue is stranded they are
            // not, and then every comparison below reads our unsaved work as
            // somebody else's: row counts differ, `changedElsewhere` returns
            // true, and the user was told "Updated from another tab" when no
            // other tab existed.
            //
            // Skipping is the right answer rather than just a quieter toast.
            // `adopt` takes the rows on disk wholesale, so adopting here would
            // overwrite the in-memory graph with a version that is missing
            // precisely the writes the queue could not save — discarding the
            // user's unsaved work to resolve a conflict that was never with
            // anyone. The banner is already telling them writes are failing.
            if (repo.health.state === 'degraded' || repo.health.state === 'off') return
            const seen = await driver.readAll()
            if (!seen.ok) {
              kgWarn('the tab resumed but the store could not be re-read', {
                detail: seen.error.message,
              })
              return
            }
            if (!changedElsewhere(seen.value, repo)) return
            // Re-read rather than adopting the rows above: between the two there
            // is an await, and the rows we decided on are the older pair.
            const rehydrated = await adopt(false)
            if (rehydrated) {
              repo.clearHistory()
              // Said out loud, always. The gate means this fires only when
              // another tab really wrote, so it is no longer a notification
              // about nothing — and an undo stack that empties itself in
              // silence is most of what B2 cost the user.
              options.onRemoteChange?.()
            }
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
