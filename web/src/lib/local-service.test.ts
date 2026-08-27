import { afterEach, describe, expect, it, vi } from 'vitest'
import { failed, send, type Sent } from './local-service'
import type { ModelRequest } from '@jojo/service/core/model-server'

/**
 * The transport's classification of a failure, which is what gets REPORTED.
 *
 * `kind` decides what the app does and stays coarse on purpose; `why` is the
 * finer label `reportFailure` in `llm.ts` sends, and it is the only thing that
 * can tell "nobody on this origin can reach that address" apart from "the
 * server is off". Nothing held it before, so the whole non-timeout branch was
 * labelled `unreachable` whatever had actually happened.
 *
 * No jsdom: `location` and `fetch` are stubbed globals, which is all this
 * module reads. Mounting nothing is the point — D20.
 */
const request = (url: string): ModelRequest => ({ url, method: 'GET', headers: {} })

const rejecting = (error: Error) => {
  vi.stubGlobal('fetch', () => Promise.reject(error))
}

const whyOf = (sent: Sent) => (failed(sent) ? sent.failed.why : undefined)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('what a thrown fetch is reported as', () => {
  it('calls a mixed-content refusal blocked, because the browser decided it by rule', async () => {
    /*
     * An https page may not call a plain http address, and the request never
     * leaves — so there is no "maybe the server is off" reading of this one. It
     * is the only case here the browser tells us about for certain, and before
     * this it was counted as one more unreachable server.
     */
    vi.stubGlobal('location', { protocol: 'https:' })
    rejecting(new TypeError('Failed to fetch'))
    // A routable http address. NOT localhost — see the test below.
    const sent = await send(request('http://10.0.0.7:8000/v1/models'), 'http://10.0.0.7:8000/v1')
    expect(whyOf(sent)).toBe('blocked')
    // Still coarse where it counts: there is no answer to read either way.
    expect(failed(sent) && sent.failed.kind).toBe('unreachable')
  })

  it('leaves an https-to-https failure unreachable, because it genuinely cannot know', async () => {
    /*
     * The tempting fix was to call the whole branch `blocked`. It is not: this
     * exception is what a dead server, a CORS-less error response and a refused
     * connection all arrive as. Guessing `blocked` here would trade one
     * confident lie for another, and the sentence the user sees already says so.
     */
    vi.stubGlobal('location', { protocol: 'https:' })
    rejecting(new TypeError('Failed to fetch'))
    const sent = await send(
      request('https://integrate.api.nvidia.com/v1/models'),
      'https://integrate.api.nvidia.com/v1',
    )
    expect(whyOf(sent)).toBe('unreachable')
  })

  it('leaves a plain http page unreachable, which is where a local model lives', async () => {
    // Most of what reaches this transport is a local server on loopback. Calling
    // every failure here `blocked` would bury the ordinary case under the rare.
    vi.stubGlobal('location', { protocol: 'http:' })
    rejecting(new TypeError('Failed to fetch'))
    const sent = await send(request('http://localhost:8000/v1/models'), 'http://localhost:8000/v1')
    expect(whyOf(sent)).toBe('unreachable')
  })

  it('keeps a timeout a timeout even on an https page', async () => {
    // Something was listening long enough to keep us waiting, so this is not
    // second-guessed — and a mixed-content request would never have got here.
    vi.stubGlobal('location', { protocol: 'https:' })
    const abort = new Error('The operation was aborted.')
    abort.name = 'AbortError'
    rejecting(abort)
    const sent = await send(request('http://localhost:8000/v1/models'), 'http://localhost:8000/v1')
    expect(whyOf(sent)).toBe('timeout')
  })
})

/**
 * Loopback is the exception, and it was the example this test file used.
 *
 * `localhost`, `127.0.0.0/8` and `[::1]` are *potentially trustworthy* origins,
 * so the Mixed Content algorithm ALLOWS an https page to reach them over plain
 * http. Reporting that as `blocked` sends somebody to fix a browser policy that
 * is not stopping them — for the single most common address this app talks to,
 * where the real cause is almost always that nothing is listening.
 */
describe('loopback over http from an https page', () => {
  for (const target of [
    'http://localhost:8000/v1/models',
    'http://127.0.0.1:11434/api/tags',
    'http://[::1]:8000/v1/models',
  ]) {
    it(`is not a mixed-content block: ${target}`, async () => {
      vi.stubGlobal('location', { protocol: 'https:' })
      rejecting(new TypeError('Failed to fetch'))
      const sent = await send(request(target), target)
      expect(whyOf(sent)).toBe('unreachable')
    })
  }
})
