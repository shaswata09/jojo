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
import { fetchPairingResponse, sendChunk } from '@/lib/handoff-client'
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
