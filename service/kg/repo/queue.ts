/**
 * L2 — the write-behind queue: drain, coalescing, backoff, PersistenceHealth.
 *
 * Nothing awaits this. `commit` is synchronous because the alternative is a
 * route transition gated on a disk write — `onPromote` in `routes/JobScout.tsx` navigates to an
 * application the moment it is created, and awaiting the write would put a
 * spinner between clicking a card and seeing it.
 *
 * The exposure that buys is exactly one undrained batch: the drain is scheduled
 * on a microtask, which runs before the browser can paint, let alone close the
 * tab. What it does NOT buy is a rollback. When a write fails the UI has already
 * moved on — the record is on screen, the toast has been dismissed, the user has
 * navigated — so unwinding it would mean un-navigating and un-writing. The queue
 * keeps its ops instead, retries with backoff, and if that keeps failing the
 * honest answer is a persistent banner naming the time changes stopped being
 * saved, not a toast that scrolls away.
 *
 * Pulled forward from Wave 2 (the build order lists it there) because Wave 1's
 * repository has to enqueue somewhere. Without it the memory driver is never
 * written to, which would make Wave 2 a rewrite of the durability seam rather
 * than the driver swap it is supposed to be.
 */

import { kgWarn } from '../log'
import type { Driver, DriverFailure, DriverResult, DurableOp } from '../storage/driver'
import { classify } from '../storage/idb-errors'

/**
 * Why the queue stopped. Every arm is a sentence `StorageBanner` has to be able
 * to write, which is why `corrupt` is spelled out rather than folded into
 * `blocked` — the remedy is different and so is the truth.
 */
export type PersistenceOffReason = 'blocked' | 'quota' | 'corrupt'

export type PersistenceHealth =
  | { state: 'idle' }
  | { state: 'writing'; pending: number }
  | {
      state: 'degraded'
      pending: number
      /** User actions stranded, not rows. See `unsavedIn`. */
      unsaved: number
      attempts: number
      lastError: string
    }
  | { state: 'off'; reason: PersistenceOffReason; pending: number; unsaved: number }

/**
 * Whether a flush actually emptied the queue, or gave up with ops still in hand.
 *
 * `flush()` settles on a FAILED attempt by design, so its resolution says
 * nothing about whether anything reached disk — and `replaceAll` in
 * `repository.ts` wipes the store on the strength of it. The audit drove that:
 * a write failing at the moment the user pressed Settings → Empty left the
 * stale batch queued, the replace went ahead, and the next successful retry put
 * the deleted record back on disk under an on-screen graph that was empty. This
 * union is what lets a caller that cannot afford that tell the two apart.
 */
export type FlushOutcome = 'drained' | 'stranded'

/**
 * How many of the user's ACTIONS are stranded, as opposed to how many rows are.
 *
 * `pending` counts durable ops, and one action is several of them — a stage
 * change writes the node, an edge or two and a journal row. A banner reading
 * "4 changes could not be saved" over a single drag is not a small inaccuracy
 * here: it is the number the user checks against their own memory of what they
 * did, and it must match. Every commit enqueues exactly one journal row
 * (`repository.ts`'s `opsFor`), so counting those counts actions.
 */
export const unsavedIn = (ops: readonly DurableOp[]): number =>
  ops.reduce((n, op) => (op.kind === 'put' && op.store === 'ops' ? n + 1 : n), 0)

/**
 * 250 ms, 1 s, 4 s, then 4 s forever.
 *
 * It stops growing on purpose. A doubling backoff reaches minutes within a
 * dozen attempts, and the failure this recovers from — a locked database while
 * another tab upgrades, a transient quota blip — clears on a human timescale.
 * Backing off past that only means the user's work sits unsaved long after the
 * disk would have taken it.
 */
const BACKOFF_MS = [250, 1_000, 4_000] as const

/**
 * The three failures no amount of retrying fixes.
 *
 * 'blocked' means another tab holds an older version of the database and we are
 * not getting it back without a reload; 'quota' means the disk is full. Both go
 * to `off`, because a queue that kept retrying either one would spin forever
 * behind a banner that said "retrying" and meant "never".
 *
 * 'corrupt' is the third because it was missing, and the audit measured the
 * cost: eleven commits against a store answering `storage/corrupt` produced 31
 * attempts, ZERO rows on disk, eleven applications on screen, and a banner
 * promising a recovery that could not arrive. The trigger was one unreadable
 * `organisation` row that boot dropped, re-minted under the same slug, and
 * collided with on the next `put` — from which moment nothing the user did was
 * ever written and everything was lost on reload.
 *
 * The three DOMExceptions behind this code — ConstraintError, DataError,
 * DataCloneError (`classify` in `storage/idb-errors.ts`) — are decided by the
 * bytes of the batch, and a failed batch is replayed verbatim at the front of
 * the queue. Attempt 31 therefore fails exactly the way attempt 1 did. Retrying
 * a deterministic failure is not caution; it is a promise that cannot be kept.
 *
 * An attempt ceiling was the alternative and was rejected, because it answers
 * the wrong question. `off` is not recoverable inside a session — nothing
 * clears it — so a ceiling that also caught `storage/unavailable`, the one code
 * that genuinely is transient (a momentary lock, a quota blip that clears),
 * would turn a ten-second outage into a permanently dead queue. What separates
 * the two is determinism, not how many times we have tried.
 */
const TERMINAL: Partial<Record<DriverFailure['code'], PersistenceOffReason>> = {
  'storage/blocked': 'blocked',
  'storage/quota': 'quota',
  'storage/corrupt': 'corrupt',
}

export interface WriteQueue {
  /** Never throws, never awaited. Schedules a drain on a microtask. */
  enqueue(ops: readonly DurableOp[]): void
  /**
   * Awaited by export, by Settings' three data ops, and by pagehide.
   *
   * Resolves on a FAILED attempt as well as a successful one, on purpose — see
   * `flushAndReport`. A caller that needs to know which of the two it got must
   * ask for it.
   */
  flush(): Promise<void>
  /**
   * The same flush, reporting whether the queue actually reached empty.
   *
   * Separate from `flush()` rather than a widened return type, because
   * `Repository.flush()` is `Promise<void>` and every existing caller — the
   * `pagehide` handler above all — is written against a promise it can await
   * and ignore. Widening the one method would have made that a compile error at
   * every seam and taught callers to read a value most of them must not block
   * on.
   */
  flushAndReport(): Promise<FlushOutcome>
  readonly health: PersistenceHealth
  subscribe(fn: (h: PersistenceHealth) => void): () => void
  /** Stops the retry timer. Called when the driver closes under us. */
  stop(): void
}

/**
 * '<store>\0<key>' — a `put` and a `delete` of one row collapse onto each other.
 *
 * A journal row has no key yet: `ops` keys are allocated by the store itself so
 * that two tabs writing at once cannot land on the same integer, so its op
 * carries `key: null`. Every one of those would otherwise collapse onto the slot
 * `ops\0null` and a burst of edits would reach disk as its last journal entry
 * only — the audit log losing rows again, by a different route. The entry's own
 * id is the identity here, which keeps the collapse correct (the same entry
 * requeued after a failed drain is still one row) without merging distinct ones.
 */
const slotOf = (op: Exclude<DurableOp, { kind: 'clear' }>): string => {
  if (op.key !== null) return `${op.store}\0${String(op.key)}`
  const id = op.kind === 'put' ? op.value['id'] : undefined
  return `${op.store}\0#${typeof id === 'string' ? id : String(Math.random())}`
}

/**
 * Collapses a batch to the smallest sequence with the same end state.
 *
 * A drag across the board writes the same node on every frame, and a bulk file
 * add writes one row per file plus a journal row; without this the first drain
 * after a busy second carries hundreds of ops that all describe two or three
 * final rows. Key-wise last-write-wins is safe because the ops are independent
 * per key — a `clear` is the one that is not, so it discards everything queued
 * for its store ahead of it.
 */
export function coalesce(ops: readonly DurableOp[]): DurableOp[] {
  const bySlot = new Map<string, DurableOp>()
  const clears: DurableOp[] = []

  for (const op of ops) {
    if (op.kind === 'clear') {
      // A snapshot, not a copy: the loop body mutates the collection it is
      // walking, so it has to walk a list taken before the first change.
      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const slot of [...bySlot.keys()]) {
        if (slot.startsWith(`${op.store}\0`)) bySlot.delete(slot)
      }
      // A second clear of the same store is the same clear.
      if (!clears.some((c) => c.store === op.store)) clears.push(op)
      continue
    }
    bySlot.set(slotOf(op), op)
  }

  return [...clears, ...bySlot.values()]
}

export function createWriteQueue(driver: Driver): WriteQueue {
  let pending: DurableOp[] = []
  /**
   * The batch handed to the driver and not yet answered for.
   *
   * `pending` is emptied before the await so that anything enqueued while the
   * disk is busy lands in the next batch — which means `pending.length` alone
   * undercounts by a whole batch for the duration of every write. That was
   * invisible while the counts were only recomputed after a drain; refreshing
   * them on every enqueue (see `enqueue`) reads them mid-drain, and a banner
   * that said "1 change not saved" over a fifty-row batch in flight would be
   * exactly the lie the count exists to prevent.
   */
  let inflight: DurableOp[] = []
  let draining = false
  let scheduled = false
  let attempts = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let health: PersistenceHealth = { state: 'idle' }
  const listeners = new Set<(h: PersistenceHealth) => void>()
  /** Resolved when the queue next stops moving, so `flush` has something to await. */
  let idle: { promise: Promise<FlushOutcome>; resolve: (outcome: FlushOutcome) => void } | null =
    null

  /** Rows the queue is still holding — in flight plus queued behind it. */
  const heldRows = (): number => inflight.length + pending.length

  /** User actions the queue is still holding. See `unsavedIn`. */
  const heldActions = (): number => unsavedIn(inflight) + unsavedIn(pending)

  function setHealth(next: PersistenceHealth) {
    health = next
    // A snapshot, not a copy: the loop body mutates the collection it is
    // walking, so it has to walk a list taken before the first change.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const fn of [...listeners]) fn(next)
  }

  function settleIdle(outcome: FlushOutcome) {
    idle?.resolve(outcome)
    idle = null
  }

  function schedule(delayMs: number) {
    if (stopped || scheduled || draining) return
    scheduled = true
    if (delayMs === 0) {
      queueMicrotask(() => {
        scheduled = false
        void drain()
      })
    } else {
      timer = setTimeout(() => {
        timer = null
        scheduled = false
        void drain()
      }, delayMs)
    }
  }

  /**
   * `driver.commit`, with the contract violation caught rather than escaping.
   *
   * `Driver` says every method RETURNS a `DriverResult`, and neither shipped
   * driver has a reachable rejection path today. Without this `try` the day one
   * of them did was silent and permanent: the rejection escaped between
   * `pending = []` and `draining = false`, so the batch was discarded, `draining`
   * stayed `true` and every later enqueue was dropped, health froze at `writing`
   * so NEITHER banner fired, and `flush()` never settled. The same violation is
   * already backstopped at the other seam (`openGuarded` in `src/lib/store.tsx`);
   * this is the seam where it fails without a symptom.
   *
   * Routed through `classify` rather than blanket-coded, so a QuotaExceededError
   * that is thrown instead of returned still reaches the quota banner instead of
   * a retry loop over a disk that has no room.
   */
  async function commitGuarded(batch: readonly DurableOp[]): Promise<DriverResult<void>> {
    try {
      const returned = await driver.commit(batch)
      // A throw is not the only way to break the contract. `drain` reads
      // `result.ok` outside this try, so a driver resolving to anything without
      // an `ok` — `undefined` from a forgotten `return`, a bare value from a
      // hand-rolled adapter — used to reproduce the whole throw symptom list
      // one line later: TypeError, batch discarded, `draining` stuck true,
      // health frozen at `writing` so neither banner fires. Worse, `flush`
      // would then report `drained`, which is the signal `replaceAll` trusts
      // before it wipes the store — so a malformed return could resurrect the
      // records Empty had just deleted. `driver-conformance.test.ts` already
      // treats this as a distinct contract violation; this is where it lands.
      if (typeof returned !== 'object' || returned === null || !('ok' in returned)) {
        kgWarn('driver returned a non-DriverResult', { at: 'commit' })
        return classify<void>(
          new TypeError(
            `commit resolved to ${returned === undefined ? 'undefined' : typeof returned}`,
          ),
          'commit',
        )
      }
      return returned
    } catch (e) {
      kgWarn('driver threw instead of returning a DriverResult', { at: 'commit' })
      return classify<void>(e, 'commit')
    }
  }

  async function drain(): Promise<void> {
    // The `off` arm is a backstop, and worth knowing as one. Nothing can reach
    // this function while the queue is off: `enqueue` returns after refreshing
    // the counts without scheduling, `flushAndReport` answers 'stranded' without
    // scheduling, and the only writer of `off` is this function, which returns
    // straight after setting it — so there is never a timer outstanding when it
    // flips. It stays because "off" is the one state that must not attempt a
    // write: the ops behind it are a deterministic failure, and retrying one is
    // not caution but a banner promising a recovery that cannot arrive. It is
    // also unobservable from outside, so a test for it would pass either way.
    if (draining || stopped || health.state === 'off') return
    if (pending.length === 0) {
      setHealth({ state: 'idle' })
      settleIdle('drained')
      return
    }

    draining = true
    // Taken before the await, so anything enqueued while the disk is busy lands
    // in the next batch instead of being lost to the splice that follows it.
    // Held in `inflight` for the same span, so the health counts can still see it.
    const batch = coalesce(pending)
    inflight = batch
    pending = []

    const result = await commitGuarded(batch)
    inflight = []
    draining = false

    if (result.ok) {
      attempts = 0
      if (pending.length > 0) {
        // More arrived while the disk was busy. Not settled yet — a `flush`
        // waiting on this must not return before the rest of it lands.
        setHealth({ state: 'writing', pending: heldRows() })
        schedule(0)
        return
      }
      setHealth({ state: 'idle' })
      settleIdle('drained')
      return
    }

    // Put back at the FRONT and in order. The ops are a sequence of whole-row
    // writes, and a delete that overtook the put it supersedes would resurrect
    // a record the user deleted — silently, on the next successful drain.
    pending = [...batch, ...pending]

    const terminal = TERMINAL[result.error.code]
    if (terminal) {
      kgWarn('persistence off', { reason: terminal, message: result.error.message })
      // The counts go out with it. Nothing is coming back for these ops, so the
      // banner's job stops being "wait" and becomes "here is what you will lose
      // if you reload" — which it cannot say without knowing how much there is.
      setHealth({
        state: 'off',
        reason: terminal,
        pending: heldRows(),
        unsaved: heldActions(),
      })
      // Nothing is coming back for these, and a promise nobody resolves is a
      // pagehide handler that never returns.
      settleIdle('stranded')
      return
    }

    attempts += 1
    kgWarn('write failed, retrying', { attempts, message: result.error.message })
    setHealth({
      state: 'degraded',
      pending: heldRows(),
      unsaved: heldActions(),
      attempts,
      lastError: result.error.message,
    })
    schedule(BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? 4_000)
    // A failed attempt settles the flush.
    //
    // `flush` means "get what you can to disk now", not "block until this
    // succeeds". Holding the promise open across the retries would hang the one
    // caller that cannot wait — the `pagehide` handler — on the exact failure it
    // exists to survive, and would hang it forever if the disk never comes back.
    // The ops are still queued and the health is `degraded`, which is what the
    // banner reads; that is the honest answer, and it is available immediately.
    //
    // It settles as `stranded`, which is the part that was missing: the caller
    // that must not proceed on a failed flush — `replaceAll`, about to wipe the
    // store — had no way to tell this from a drain that emptied the queue.
    settleIdle('stranded')
  }

  async function flushAndReport(): Promise<FlushOutcome> {
    if (pending.length === 0 && !draining) return 'drained'
    // A stopped queue never drains again, and an `off` queue is not coming back
    // either. Awaiting a promise that only `drain` resolves would hang the
    // pagehide handler on exactly the failures it exists to survive.
    if (stopped || health.state === 'off') return 'stranded'
    idle ??= (() => {
      let resolve!: (outcome: FlushOutcome) => void
      const promise = new Promise<FlushOutcome>((r) => {
        resolve = r
      })
      return { promise, resolve }
    })()
    // Cancels the backoff wait: an explicit flush is a user action — export,
    // Empty, closing the tab — and making it sit out a 4-second timer would
    // mean pagehide returning before the write it was there to force.
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
      scheduled = false
    }
    schedule(0)
    return idle.promise
  }

  return {
    /**
     * Every enqueue refreshes the counts, not only the `idle -> writing` one.
     *
     * The old spelling refreshed health on that single transition and returned
     * early everywhere else, so the two states where the counts are the whole
     * message stopped moving the moment they mattered. The audit measured it:
     * ten actions taken after the disk filled left the banner still reading
     * "1 change is on screen but not saved… reloading or closing this tab will
     * lose it" while ten were stranded. Under `off` — and under a corrupt wedge
     * — that staleness is permanent, and `status.tsx` copies health into state
     * on the notification tick, so an unrelated re-render cannot correct it
     * either.
     */
    enqueue(ops) {
      if (ops.length === 0 || stopped) return
      pending.push(...ops)

      if (health.state === 'off') {
        setHealth({
          state: 'off',
          reason: health.reason,
          pending: heldRows(),
          unsaved: heldActions(),
        })
        return
      }

      if (health.state === 'degraded') {
        setHealth({ ...health, pending: heldRows(), unsaved: heldActions() })
      } else {
        setHealth({ state: 'writing', pending: heldRows() })
      }
      schedule(0)
    },

    flush: async () => {
      await flushAndReport()
    },

    flushAndReport,

    get health() {
      return health
    },

    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },

    stop() {
      stopped = true
      if (timer !== null) clearTimeout(timer)
      timer = null
      // Whatever was queued is not going anywhere now.
      settleIdle('stranded')
    },
  }
}
