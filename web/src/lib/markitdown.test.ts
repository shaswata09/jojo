/**
 * Cancelling a read, on the transport that is not the page's own.
 *
 * `convertUrl` has always taken an `AbortSignal`, and it reached `fetch` only on
 * the direct path — the relay through the extension took the request and left
 * the signal behind, and `handshake` never carried it at all. Neither is a
 * smaller version of working: closing "New application from a link" mid-read
 * left the read running, and up to the full relay budget later the posting was
 * saved and the create form opened over whatever the user had moved on to.
 *
 * Asserted on what this file HANDS the bridge, which is where the signal was
 * dropped. `capture-bridge.test.ts` takes it from there and checks that a bridge
 * given one actually stops waiting. No mounting — D20.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Every relayed call, with the signal it was given. */
const relayed: { url: string; body: string; signal: AbortSignal | undefined }[] = []

vi.mock('@/lib/capture-bridge', () => ({
  readDocument: (request: { url: string; body?: string }, signal?: AbortSignal) => {
    relayed.push({ url: request.url, body: request.body ?? '', signal })
    if ((request.body ?? '').includes('"initialize"')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: JSON.stringify({ result: { serverInfo: { name: 'markitdown' } } }),
      })
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      text: JSON.stringify({
        result: { content: [{ type: 'text', text: '# Staff Engineer at Acme' }] },
      }),
    })
  },
}))

const { convertUrl, testReader } = await import('./markitdown')

/** An address the page may not call itself, so `sendToReader` takes the relay. */
const RELAYED = 'http://127.0.0.1:3001/mcp'

beforeEach(async () => {
  relayed.length = 0
  // The handshake is remembered for the session, and a remembered one skips the
  // call this test is counting. `testReader` is the module's own way to forget.
  await testReader('')
})

describe('a cancel reaches the extension relay', () => {
  it('gives the signal to every hop of the read, handshake included', async () => {
    const stop = new AbortController()

    await convertUrl(RELAYED, 'https://example.com/jobs/1', stop.signal)

    // Three hops on a cold session: `initialize`, the `initialized` NOTIFICATION
    // — fire-and-forget, deliberately not cancellable, since nothing waits on it
    // and a server that never receives it is left mid-handshake — and the
    // `tools/call` that does the work. The first is the one that was never
    // given a signal at all, because `handshake` did not take one.
    const initialize = relayed.find((call) => call.body.includes('"initialize"'))
    const convert = relayed.find((call) => call.body.includes('"tools/call"'))
    expect(initialize?.signal).toBe(stop.signal)
    expect(convert?.signal).toBe(stop.signal)
  })

  it('relays the convert with no signal when the caller passed none', async () => {
    await convertUrl(RELAYED, 'https://example.com/jobs/1')

    // Not `null`, not a fresh controller: `exactOptionalPropertyTypes` is on and
    // an invented signal would abort nothing while looking like it could.
    expect(relayed.every((call) => call.signal === undefined)).toBe(true)
  })
})
