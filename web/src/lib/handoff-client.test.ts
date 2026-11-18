/**
 * That every way the wire can fail comes back as a `HandoffResult`, never as a
 * throw.
 *
 * The whole point of `call` is that its caller — `useHandoffSend` — can answer a
 * failure with a sentence on screen. A rejection escaping it is not a worse
 * error message, it is NO error message: `start` rejects into the `void` at the
 * call site, the stage never leaves 'connecting' or 'sending', and the panel
 * spins with its field disabled until the page is reloaded.
 *
 * No jsdom: `fetch` and `navigator` are stubbed globals, which is all this
 * module reads — D20.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canReachLocalNetwork,
  combined,
  fetchPairingResponse,
  pullChunk,
  readCapped,
  sendChunk,
} from '@/lib/handoff-client'
import type { DialAddress } from '@jojo/service/core/dial'

/** A private address, so `isPrivateAddress` lets the request past. */
const PHONE: DialAddress = { host: [192, 168, 1, 40], port: 8787 }

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A response whose HEADERS arrived and whose BODY then failed to. */
const bodyDiesMidStream = () => {
  vi.stubGlobal('fetch', () =>
    Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.reject(new TypeError('network error')),
    }),
  )
}

describe('a body that stops arriving after the headers did', () => {
  it('is reported as unreachable rather than thrown out of the pairing fetch', async () => {
    /*
     * The body is a SECOND network read, after `fetch` has already resolved — a
     * phone that sleeps or a wifi drop between the two rejects here and not
     * above. Only the `fetch` call was guarded, so this rejection went straight
     * through the result type.
     */
    bodyDiesMidStream()
    await expect(fetchPairingResponse(PHONE, 'tok')).resolves.toEqual({
      ok: false,
      error: 'handoff/unreachable',
    })
  })

  it('is reported the same way when a chunk is being delivered', async () => {
    // Mid-send is the worse half: the bar is moving, so a throw here reads as a
    // transfer that froze at some percentage rather than one that stopped.
    bodyDiesMidStream()
    await expect(sendChunk(PHONE, 'tok', new Uint8Array([1, 2, 3]))).resolves.toEqual({
      ok: false,
      error: 'handoff/unreachable',
    })
  })

  it('still hands back the bytes when the body does arrive', async () => {
    // The companion assertion: a catch wide enough to swallow the success path
    // would turn every transfer into 'unreachable' and this is what notices.
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new Uint8Array([7, 8]).buffer),
      }),
    )
    await expect(fetchPairingResponse(PHONE, 'tok')).resolves.toEqual({
      ok: true,
      value: new Uint8Array([7, 8]),
    })
  })
})

/*
 * Q129: the computer now READS the phone's backup, so the far end decides how
 * much arrives. Every answer is held to the size the phone's own parser holds a
 * request to, and the read stops there rather than buffering the rest.
 */
describe('an answer larger than any real one', () => {
  it('is refused as oversized, and the stream is cancelled rather than drained', async () => {
    let cancelled = false
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(64 * 1024))
      },
      cancel() {
        cancelled = true
      },
    })
    const out = await readCapped(new Response(body), 256 * 1024)
    expect(out).toEqual({ ok: false, error: 'handoff/oversized' })
    expect(cancelled).toBe(true)
    // Five pieces read to cross 256 KiB, then it stopped.
    expect(pulled).toBeLessThanOrEqual(6)
  })

  it('reads an answer within the limit whole', async () => {
    const out = await readCapped(new Response(new Uint8Array([1, 2, 3])), 3)
    expect(out).toEqual({ ok: true, value: new Uint8Array([1, 2, 3]) })
  })

  it('refuses an oversized chunk from the pull route through the real call', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/140' })
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(new Uint8Array(300 * 1024))))
    const out = await pullChunk(PHONE, 'token', new Uint8Array(36))
    expect(out).toEqual({ ok: false, error: 'handoff/oversized' })
  })
})

describe('which browsers can reach a phone on the local network', () => {
  const CHROME =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
  const SAFARI =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15'
  const FIREFOX =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0'
  const EDGE_IOS =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/131.0 Mobile/15E148 Safari/605.1.15'
  const CHROME_IOS =
    'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1'

  it('lets Chromium through, on the published site and off it', () => {
    expect(canReachLocalNetwork(CHROME, true)).toBe(true)
    expect(canReachLocalNetwork(CHROME, false)).toBe(true)
  })

  it('stops Safari and every browser on an iPhone or iPad, which are all WebKit', () => {
    expect(canReachLocalNetwork(SAFARI, false)).toBe(false)
    expect(canReachLocalNetwork(EDGE_IOS, false)).toBe(false)
    expect(canReachLocalNetwork(CHROME_IOS, false)).toBe(false)
  })

  it('stops Firefox only where its mixed-content rule bites: an https page', () => {
    expect(canReachLocalNetwork(FIREFOX, true)).toBe(false)
    expect(canReachLocalNetwork(FIREFOX, false)).toBe(true)
  })
})

/**
 * Counts the `abort` listeners on a signal: added minus taken off. (Node's
 * `getEventListeners` would do, but this project's types are the browser's.)
 */
function abortListeners(signal: AbortSignal): () => number {
  const live = new Set<unknown>()
  const add = signal.addEventListener.bind(signal)
  const remove = signal.removeEventListener.bind(signal)
  signal.addEventListener = ((type: string, fn: unknown, options?: unknown) => {
    if (type === 'abort') live.add(fn)
    add(type, fn as EventListener, options as AddEventListenerOptions)
  }) as typeof signal.addEventListener
  signal.removeEventListener = ((type: string, fn: unknown, options?: unknown) => {
    if (type === 'abort') live.delete(fn)
    remove(type, fn as EventListener, options as EventListenerOptions)
  }) as typeof signal.removeEventListener
  return () => live.size
}

describe('what a finished request leaves behind (review 3, leaks-1)', () => {
  it('neither a listener on the run’s signal nor an armed timer, chunk after chunk', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }))
      const run = new AbortController()
      const listening = abortListeners(run.signal)
      for (let i = 0; i < 100; i += 1) {
        await sendChunk(PHONE, 'tok', new Uint8Array(8), run.signal)
      }
      // Before the fix: 100 of each, one per 64 KiB chunk of a transfer.
      expect(listening()).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('still reaches the request on the caller’s cancel and on the deadline', async () => {
    vi.useFakeTimers()
    try {
      const run = new AbortController()
      const cancelled = combined(60_000, run.signal)
      run.abort()
      expect(cancelled.signal.aborted).toBe(true)
      expect(cancelled.timedOut()).toBe(false)

      const late = combined(1_000, new AbortController().signal)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(late.signal.aborted).toBe(true)
      expect(late.timedOut()).toBe(true)

      // A caller signal aborted before the request began aborts it at once.
      const before = new AbortController()
      before.abort()
      expect(combined(60_000, before.signal).signal.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
