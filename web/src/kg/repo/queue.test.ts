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
import type { DurableOp } from '../storage/driver'
import { coalesce, createWriteQueue } from './queue'

const put = (key: string, value: object): DurableOp => ({
  kind: 'put',
  store: 'nodes',
  key,
  value: value as Record<string, unknown>,
})

const del = (key: string): DurableOp => ({ kind: 'delete', store: 'nodes', key })

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
    const driver = createMemoryDriver({
      fault: (call) =>
        broken && call === 'commit'
          ? { code: 'storage/corrupt', message: 'the store rejected the write' }
          : null,
    })
    const queue = createWriteQueue(driver)

    queue.enqueue([put('app:1', { id: 'app:1' })])
    await queue.flush()

    expect(queue.health).toEqual({
      state: 'degraded',
      pending: 1,
      attempts: 1,
      lastError: 'the store rejected the write',
    })
    expect(driver.counts().nodes).toBe(0)

    broken = false
    await queue.flush()

    expect(queue.health).toEqual({ state: 'idle' })
    expect(driver.counts().nodes).toBe(1)
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

      expect(queue.health).toEqual({ state: 'off', reason })
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
        broken && call === 'commit' ? { code: 'storage/corrupt', message: 'x' } : null,
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
})
