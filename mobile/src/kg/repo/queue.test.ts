/**
 * The write-behind queue, and R-5: persistence failing after the UI has moved on.
 *
 * Nothing here waits out a backoff timer. `flush` cancels the wait by design —
 * an explicit flush is a user action and must not sit out four seconds — which
 * makes the retry path assertable without a fake clock, and asserts the
 * cancellation at the same time.
 */

import { describe, expect, it } from 'vitest'
import { createMemoryDriver } from '../storage/memory-driver'
import type { Driver, DriverResult, DurableOp } from '../storage/driver'
import { coalesce, createWriteQueue } from './queue'
import type { PersistenceHealth } from './queue'

const put = (key: string, value: object): DurableOp => ({
  kind: 'put',
  store: 'nodes',
  key,
  value: value as Record<string, unknown>,
})

const del = (key: string): DurableOp => ({ kind: 'delete', store: 'nodes', key })

/** A journal row as the repository enqueues one: no key, the store allocates. */
const journal = (id: string): DurableOp => ({
  kind: 'put',
  store: 'ops',
  key: null,
  value: { id, label: id },
})

/**
 * A promise's value, or the fact that it did not produce one.
 *
 * Written for the driver-throws test below, where the defect's signature is a
 * `flush` that never settles. Awaiting that directly costs the suite the full
 * five-second timeout and reports it as "test timed out", which names the
 * symptom and not the cause; racing a short timer against it turns the same
 * failure into `expected 'never settled' to be 'stranded'` in 50 ms.
 */
const settledWithin = <T>(promise: Promise<T>): Promise<T | 'never settled'> =>
  Promise.race([
    promise,
    new Promise<'never settled'>((resolve) => setTimeout(() => resolve('never settled'), 50)),
  ])

describe('coalesce', () => {
  // A drag across the board writes the same node on every frame. Without this
  // the first drain after a busy second carries hundreds of ops describing two
  // or three final rows.
  it('keeps only the last write of each row', () => {
    expect(coalesce([put('a', { n: 1 }), put('a', { n: 2 }), put('b', { n: 3 })])).toEqual([
      put('a', { n: 2 }),
      put('b', { n: 3 }),
    ])
  })

  it('lets a delete win over the put it supersedes, and the reverse', () => {
    expect(coalesce([put('a', { n: 1 }), del('a')])).toEqual([del('a')])
    expect(coalesce([del('a'), put('a', { n: 1 })])).toEqual([put('a', { n: 1 })])
  })

  // The one op that is not independent per key: everything queued for that store
  // ahead of it describes rows the clear is about to remove. A store it does not
  // name is untouched — Settings' Empty clears records and keeps meta.
  it('drops what is queued for a store ahead of a clear, and nothing else', () => {
    const clear: DurableOp = { kind: 'clear', store: 'nodes' }
    const edge: DurableOp = { kind: 'put', store: 'edges', key: 'e', value: { id: 'e' } }

    expect(coalesce([put('a', { n: 1 }), edge, clear, put('b', { n: 2 })])).toEqual([
      clear,
      edge,
      put('b', { n: 2 }),
    ])
  })

  it('never repeats a clear, however many arrive', () => {
    const clear: DurableOp = { kind: 'clear', store: 'nodes' }
    expect(coalesce([clear, put('a', { n: 1 }), clear])).toEqual([clear])
  })

  it('leaves an empty batch empty', () => {
    expect(coalesce([])).toEqual([])
  })

  /**
   * The keyless journal rows, which have no slot to collide on and must not
   * borrow one.
   *
   * Keying them all as `ops\0null` would have collapsed a burst of edits into
   * its last entry — the audit log losing rows again, one layer up from the
   * two-tab overwrite that made the keys keyless in the first place.
   */
  it('never collapses two journal rows onto each other', () => {
    expect(coalesce([journal('j1'), journal('j2'), journal('j3')])).toHaveLength(3)
  })

  it('still collapses the SAME journal row requeued after a failed drain', () => {
    expect(coalesce([journal('j1'), journal('j1')])).toEqual([journal('j1')])
  })

  it('drops journal rows queued ahead of a clear of the ops store', () => {
    const clear: DurableOp = { kind: 'clear', store: 'ops' }
    expect(coalesce([journal('j1'), clear, journal('j2')])).toEqual([clear, journal('j2')])
  })
})

describe('createWriteQueue', () => {
  it('drains on a microtask without being awaited', async () => {
    const driver = createMemoryDriver()
    const queue = createWriteQueue(driver)

    queue.enqueue([put('app:1', { id: 'app:1' })])
    // The exposure the design accepts: exactly one undrained batch, and only
    // until the microtask runs — which is before the browser can paint.
    expect(queue.health).toEqual({ state: 'writing', pending: 1 })

    await queue.flush()
    expect(queue.health).toEqual({ state: 'idle' })
    expect(driver.counts().nodes).toBe(1)
  })

  it('reports health to its subscribers and stops when they unsubscribe', async () => {
    const queue = createWriteQueue(createMemoryDriver())
    const seen: string[] = []
    const off = queue.subscribe((h) => seen.push(h.state))

    queue.enqueue([put('a', { id: 'a' })])
    await queue.flush()
    off()
    queue.enqueue([put('b', { id: 'b' })])
    await queue.flush()

    expect(seen).toEqual(['writing', 'idle'])
  })

  /**
   * A failed write is retried, never rolled back.
   *
   * By the time the disk answers, the record is on screen, the toast is gone and
   * the user has navigated. Unwinding would mean un-navigating and un-writing, so
   * the queue keeps its ops and the UI keeps its optimism — and the ops are still
   * there to land when the next attempt succeeds.
   */
  it('keeps the ops and goes degraded when a write fails', async () => {
    let broken = true
    // `storage/unavailable`, and it matters which code this is. This test and
    // the replay test below both used to fault with `storage/corrupt` and then
    // switch it off mid-test to assert recovery — which made a deterministic
    // corrupt untested by construction, and a corrupt is deterministic by
    // construction. `unavailable` is the only code the queue retries now, so it
    // is the only one that can stand in for a transient fault.
    const driver = createMemoryDriver({
      fault: (call) =>
        broken && call === 'commit'
          ? { code: 'storage/unavailable', message: 'the store rejected the write' }
          : null,
    })
    const queue = createWriteQueue(driver)

    queue.enqueue([put('app:1', { id: 'app:1' })])
    await queue.flush()

    expect(queue.health).toEqual({
      state: 'degraded',
      pending: 1,
      // No journal row in this batch, so no user action is stranded. `pending`
      // counts rows and `unsaved` counts actions; the banner says "3 changes"
      // and has to mean the second.
      unsaved: 0,
      attempts: 1,
      lastError: 'the store rejected the write',
    })
    expect(driver.counts().nodes).toBe(0)

    broken = false
    await queue.flush()

    expect(queue.health).toEqual({ state: 'idle' })
    expect(driver.counts().nodes).toBe(1)
  })

  /**
   * The number the banner shows the user, and what it has to be counting.
   *
   * `pending` is rows: one stage change is a node put, an edge put and a journal
   * row. Reporting that as "3 changes could not be saved" over a single drag is
   * the kind of wrong the user can check against their own memory.
   */
  it('counts stranded user actions, not stranded rows', async () => {
    const queue = createWriteQueue(
      createMemoryDriver({
        fault: (call) => (call === 'commit' ? { code: 'storage/quota', message: 'full' } : null),
      }),
    )

    queue.enqueue([put('app:1', { id: 'app:1' }), put('app:2', { id: 'app:2' }), journal('j1')])
    await queue.flush()

    expect(queue.health).toEqual({ state: 'off', reason: 'quota', pending: 3, unsaved: 1 })
  })

  // Retrying either of these forever would spin behind a banner that said
  // "retrying" and meant "never".
  it('gives up on quota and on blocked, and flush still resolves', async () => {
    for (const [code, reason] of [
      ['storage/quota', 'quota'],
      ['storage/blocked', 'blocked'],
    ] as const) {
      const queue = createWriteQueue(
        createMemoryDriver({
          fault: (call) => (call === 'commit' ? { code, message: code } : null),
        }),
      )
      queue.enqueue([put('a', { id: 'a' })])
      await queue.flush()

      expect(queue.health).toEqual({ state: 'off', reason, pending: 1, unsaved: 0 })
      // A pagehide handler awaiting a promise nobody resolves never returns.
      await queue.flush()
    }
  })

  /**
   * Put back at the FRONT and in order.
   *
   * A delete that overtook the put it supersedes would resurrect a record the
   * user deleted — silently, on the next successful drain.
   */
  it('replays a failed batch ahead of what was queued behind it', async () => {
    let broken = true
    const driver = createMemoryDriver({
      fault: (call) =>
        broken && call === 'commit' ? { code: 'storage/unavailable', message: 'x' } : null,
    })
    const queue = createWriteQueue(driver)

    queue.enqueue([put('a', { id: 'a', n: 1 })])
    await queue.flush()
    queue.enqueue([del('a')])
    broken = false
    await queue.flush()

    expect(driver.counts().nodes).toBe(0)
  })

  it('does nothing at all once stopped', async () => {
    const driver = createMemoryDriver()
    const queue = createWriteQueue(driver)

    queue.stop()
    queue.enqueue([put('a', { id: 'a' })])
    await queue.flush()

    expect(driver.counts().nodes).toBe(0)
  })

  /**
   * A DETERMINISTIC corrupt, which is the only kind there is.
   *
   * `storage/corrupt` was retried on a flat four-second backoff with no attempt
   * ceiling, and the three DOMExceptions behind it — ConstraintError, DataError,
   * DataCloneError — are all decided by the bytes of the batch, which is
   * replayed verbatim. One unreadable `organisation` row on disk, re-minted
   * under the same slug and colliding on the next `put`, was therefore enough to
   * stop every subsequent write for the life of the tab: the audit measured 31
   * attempts, zero rows on disk, eleven applications on screen, and a banner
   * that said "still retrying" and meant "never".
   *
   * Both of the tests above used to fault with this code and switch it off
   * mid-test, so the whole suite only ever asked what a corrupt that goes away
   * does. This is the one that asks what one that does not go away does.
   */
  it('stops for good on a corrupt write rather than retrying it forever', async () => {
    let attempts = 0
    const driver = createMemoryDriver({
      fault: (call) => {
        if (call !== 'commit') return null
        attempts += 1
        return { code: 'storage/corrupt', message: 'ConstraintError' }
      },
    })
    const queue = createWriteQueue(driver)

    queue.enqueue([put('org:1', { id: 'org:1' }), journal('j1')])
    await queue.flush()

    expect(queue.health).toEqual({ state: 'off', reason: 'corrupt', pending: 2, unsaved: 1 })

    // And it stays stopped. A retry that cannot succeed is not a recovery, it is
    // a banner promising one — so nothing is attempted again, however hard the
    // caller pushes.
    await queue.flush()
    await queue.flush()
    queue.enqueue([put('org:2', { id: 'org:2' })])
    await queue.flush()

    expect(attempts).toBe(1)
    expect(driver.counts().nodes).toBe(0)
  })

  /**
   * What the banner is about to tell the user they will lose, kept current.
   *
   * `enqueue` refreshed health only on the `idle -> writing` transition, so the
   * counts froze at whatever they read the moment saving stopped. The audit
   * drove ten actions past a full disk and found the banner still saying "1
   * change is on screen but not saved". Under `off` that staleness never
   * corrects itself: nothing clears `off`, and `status.tsx` copies health into
   * React state on the notification tick rather than reading it on every
   * render.
   */
  it('keeps counting the stranded actions after it has stopped saving', async () => {
    const queue = createWriteQueue(
      createMemoryDriver({
        fault: (call) => (call === 'commit' ? { code: 'storage/quota', message: 'full' } : null),
      }),
    )
    const seen: PersistenceHealth[] = []
    queue.subscribe((h) => seen.push(h))

    queue.enqueue([put('a', { id: 'a' }), journal('j1')])
    await queue.flush()
    expect(queue.health).toEqual({ state: 'off', reason: 'quota', pending: 2, unsaved: 1 })

    for (let i = 0; i < 10; i += 1) {
      queue.enqueue([put(`n${String(i)}`, { id: `n${String(i)}` }), journal(`j${String(i + 2)}`)])
    }

    expect(queue.health).toEqual({ state: 'off', reason: 'quota', pending: 22, unsaved: 11 })
    // Subscribers hear it too, because that is the only way the banner finds
    // out — it does not re-read health on an unrelated render.
    expect(seen.at(-1)).toEqual({ state: 'off', reason: 'quota', pending: 22, unsaved: 11 })
  })

  it('keeps counting while it is still retrying', async () => {
    const queue = createWriteQueue(
      createMemoryDriver({
        fault: (call) =>
          call === 'commit' ? { code: 'storage/unavailable', message: 'locked' } : null,
      }),
    )

    queue.enqueue([put('a', { id: 'a' }), journal('j1')])
    await queue.flush()
    expect(queue.health).toMatchObject({ state: 'degraded', pending: 2, unsaved: 1 })

    queue.enqueue([put('b', { id: 'b' }), journal('j2')])

    // Still degraded, still one attempt in — only the counts moved. A retry
    // scheduled on a backoff makes `schedule(0)` a no-op, which is how these
    // used to go stale for a whole backoff at a time.
    expect(queue.health).toMatchObject({
      state: 'degraded',
      pending: 4,
      unsaved: 2,
      attempts: 1,
    })
  })

  /**
   * The contract violation the other seam already guards against.
   *
   * `Driver` says every method RETURNS a `DriverResult`; neither shipped driver
   * rejects today, and `src/lib/store.tsx` still wraps `open()` because "this is
   * the backstop for the day one of them does". Here the same violation was
   * silent AND permanent: the rejection escaped between `pending = []` and
   * `draining = false`, so the batch was dropped, `draining` stayed true and
   * every later enqueue was ignored, health froze at `writing` so neither banner
   * fired, and `flush()` never settled. It is the day a second driver
   * (AsyncStorage, SQLite, OPFS) reports an error the ordinary way.
   */
  it('treats a driver that throws as a failed write instead of wedging', async () => {
    let broken = true
    const base = createMemoryDriver()
    const driver: Driver = {
      ...base,
      commit: (ops) => (broken ? Promise.reject(new Error('the driver threw')) : base.commit(ops)),
    }
    const queue = createWriteQueue(driver)

    queue.enqueue([put('a', { id: 'a' }), journal('j1')])

    expect(await settledWithin(queue.flushAndReport())).toBe('stranded')
    expect(queue.health).toMatchObject({ state: 'degraded', pending: 2, unsaved: 1, attempts: 1 })

    // The batch was kept and the queue still accepts work, so the write lands
    // the moment the driver behaves.
    broken = false
    queue.enqueue([put('b', { id: 'b' })])

    expect(await settledWithin(queue.flushAndReport())).toBe('drained')
    expect(base.counts().nodes).toBe(2)
    expect(base.counts().ops).toBe(1)
  })

  /**
   * Throwing is not the only way to break the contract, and the other way was
   * worse.
   *
   * `drain` reads `result.ok` one line outside the try that guards the call, so
   * a driver resolving to anything without an `ok` — `undefined` from a
   * forgotten `return`, a bare value from a hand-rolled adapter — reproduced
   * the entire throw symptom list a line later, plus one the throw never had:
   * `flushAndReport` came back `'drained'`. That is the signal `replaceAll`
   * trusts before it wipes the store, so a malformed return could resurrect the
   * records Settings -> Empty had just deleted, which is finding A1 arriving
   * through a second door. `driver-conformance.test.ts` already treats a
   * non-result as its own contract violation; nothing enforced it here.
   */
  it('treats a driver that returns a non-DriverResult as a failed write', async () => {
    let broken = true
    const base = createMemoryDriver()
    const driver: Driver = {
      ...base,
      // The forgotten `return`, which typechecks nowhere but ships anyway.
      commit: (ops) =>
        broken ? (Promise.resolve() as unknown as Promise<DriverResult<void>>) : base.commit(ops),
    }
    const queue = createWriteQueue(driver)

    queue.enqueue([put('a', { id: 'a' }), journal('j1')])

    // Not 'drained' — that is the whole point. Empty must not proceed on this.
    expect(await settledWithin(queue.flushAndReport())).toBe('stranded')
    expect(queue.health).toMatchObject({ state: 'degraded', pending: 2, unsaved: 1, attempts: 1 })

    broken = false
    queue.enqueue([put('b', { id: 'b' })])

    expect(await settledWithin(queue.flushAndReport())).toBe('drained')
    expect(base.counts().nodes).toBe(2)
  })

  /**
   * `flush()` settles on a failed attempt on purpose, and that is exactly the
   * problem it hands its callers.
   *
   * `replaceAll` awaits it before wiping the store, because draining the ops
   * afterwards would write a deleted record back into a store that had just
   * been emptied — and then proceeds on a promise that resolves whether or not
   * anything reached disk. The audit drove Settings -> Empty during a failing
   * write and watched the record come back on the next successful retry, under
   * a screen that stayed empty. `flushAndReport` is the difference, and
   * `flush()` keeps its `pagehide`-safe shape.
   */
  describe('flushAndReport', () => {
    it('reports a drain that emptied the queue', async () => {
      const queue = createWriteQueue(createMemoryDriver())
      queue.enqueue([put('a', { id: 'a' })])

      expect(await queue.flushAndReport()).toBe('drained')
      // Nothing queued is still "drained": there is nothing left to lose.
      expect(await queue.flushAndReport()).toBe('drained')
    })

    it('reports a flush that gave up with the ops still in hand', async () => {
      for (const code of ['storage/unavailable', 'storage/quota', 'storage/corrupt'] as const) {
        const queue = createWriteQueue(
          createMemoryDriver({
            fault: (call) => (call === 'commit' ? { code, message: code } : null),
          }),
        )
        queue.enqueue([put('a', { id: 'a' })])

        expect(await queue.flushAndReport()).toBe('stranded')
        // Asked again after the queue has given up entirely — the answer must
        // not improve just because there is no drain left to run.
        expect(await queue.flushAndReport()).toBe('stranded')
      }
    })

    it('reports stranded rather than hanging once the queue is stopped', async () => {
      const queue = createWriteQueue(
        createMemoryDriver({
          fault: (call) =>
            call === 'commit' ? { code: 'storage/unavailable', message: 'locked' } : null,
        }),
      )
      queue.enqueue([put('a', { id: 'a' })])
      await queue.flush()
      queue.stop()

      // A stopped queue never drains again, so a flush that waited for it would
      // hang the pagehide handler on the failure it exists to survive.
      expect(await settledWithin(queue.flushAndReport())).toBe('stranded')
    })
  })
})
