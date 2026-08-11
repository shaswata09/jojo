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
import type { Driver, DriverFailure, DurableOp } from '../storage/driver'

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
  | { state: 'off'; reason: 'blocked' | 'quota'; pending: number; unsaved: number }

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
 * The two failures no amount of retrying fixes.
 *
 * 'blocked' means another tab holds an older version of the database and we are
 * not getting it back without a reload; 'quota' means the disk is full. Both go
 * to `off`, because a queue that kept retrying either one would spin forever
 * behind a banner that said "retrying" and meant "never".
 */
const TERMINAL: Partial<Record<DriverFailure['code'], 'blocked' | 'quota'>> = {
  'storage/blocked': 'blocked',
  'storage/quota': 'quota',
}

export interface WriteQueue {
  /** Never throws, never awaited. Schedules a drain on a microtask. */
  enqueue(ops: readonly DurableOp[]): void
  /** Awaited by export, by Settings' three data ops, and by pagehide. */
  flush(): Promise<void>
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
  let draining = false
  let scheduled = false
  let attempts = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let health: PersistenceHealth = { state: 'idle' }
  const listeners = new Set<(h: PersistenceHealth) => void>()
  /** Resolved when the queue next reaches empty, so `flush` has something to await. */
  let idle: { promise: Promise<void>; resolve: () => void } | null = null

  function setHealth(next: PersistenceHealth) {
    health = next
    for (const fn of [...listeners]) fn(next)
  }

  function settleIdle() {
    idle?.resolve()
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

  async function drain(): Promise<void> {
    if (draining || stopped || health.state === 'off') return
    if (pending.length === 0) {
      setHealth({ state: 'idle' })
      settleIdle()
      return
    }

    draining = true
    // Taken before the await, so anything enqueued while the disk is busy lands
    // in the next batch instead of being lost to the splice that follows it.
    const batch = coalesce(pending)
    pending = []

    const result = await driver.commit(batch)
    draining = false

    if (result.ok) {
      attempts = 0
      if (pending.length > 0) {
        // More arrived while the disk was busy. Not settled yet — a `flush`
        // waiting on this must not return before the rest of it lands.
        setHealth({ state: 'writing', pending: pending.length })
        schedule(0)
        return
      }
      setHealth({ state: 'idle' })
      settleIdle()
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
        pending: pending.length,
        unsaved: unsavedIn(pending),
      })
      // Nothing is coming back for these, and a promise nobody resolves is a
      // pagehide handler that never returns.
      settleIdle()
      return
    }

    attempts += 1
    kgWarn('write failed, retrying', { attempts, message: result.error.message })
    setHealth({
      state: 'degraded',
      pending: pending.length,
      unsaved: unsavedIn(pending),
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
    settleIdle()
  }

  return {
    enqueue(ops) {
      if (ops.length === 0 || stopped) return
      pending.push(...ops)
      if (health.state === 'off') return
      if (health.state === 'idle') setHealth({ state: 'writing', pending: pending.length })
      schedule(0)
    },

    async flush() {
      if (pending.length === 0 && !draining) return
      if (health.state === 'off') return
      idle ??= (() => {
        let resolve!: () => void
        const promise = new Promise<void>((r) => {
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
    },

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
      settleIdle()
    },
  }
}
