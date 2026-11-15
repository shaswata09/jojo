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
import { fetchPairingResponse, pullChunk, readCapped, sendChunk } from '@/lib/handoff-client'
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
