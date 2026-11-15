/**
 * Q114: a transfer only ever goes to a device on the same local network.
 *
 * `isPrivateAddress` is tested on its own in `service/kg/core/dial.test.ts`.
 * What is pinned here is that the wire actually asks it: both requests the
 * sending device makes — the handshake and every sealed chunk — are refused for
 * a routable address BEFORE anything is fetched. Deleting the guard in `call`
 * would leave every other test green, because they all dial a private address.
 *
 * `fetch` and `navigator` are stubbed globals, as in `handoff-client.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPairingResponse, sendChunk } from '@/lib/handoff-client'
import type { DialAddress } from '@jojo/service/core/dial'

const fetched = vi.fn()

beforeEach(() => {
  fetched.mockReset()
  fetched.mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })
  vi.stubGlobal('fetch', fetched)
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/151.0' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const PUBLIC: DialAddress[] = [
  { host: [8, 8, 8, 8], port: 8787 },
  { host: [100, 64, 0, 1], port: 8787 }, // carrier-grade NAT: looks private, is not
  { host: [172, 32, 0, 1], port: 8787 }, // just past 172.16/12
]

describe('the sending device dials only a local address (Q114)', () => {
  it.each(PUBLIC)('refuses the handshake to %j without touching the network', async (address) => {
    const result = await fetchPairingResponse(address, 'token')
    expect(result).toEqual({ ok: false, error: 'handoff/not-local' })
    expect(fetched).not.toHaveBeenCalled()
  })

  it.each(PUBLIC)('refuses to send a chunk to %j without touching the network', async (address) => {
    const result = await sendChunk(address, 'token', new Uint8Array([1, 2, 3]))
    expect(result).toEqual({ ok: false, error: 'handoff/not-local' })
    expect(fetched).not.toHaveBeenCalled()
  })

  it('still dials a private address, so the refusals above are the guard and not a broken stub', async () => {
    const result = await fetchPairingResponse({ host: [192, 168, 1, 40], port: 8787 }, 'token')
    expect(result.ok).toBe(true)
    expect(fetched).toHaveBeenCalledOnce()
  })
})
