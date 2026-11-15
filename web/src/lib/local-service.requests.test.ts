import { afterEach, describe, expect, it, vi } from 'vitest'
import { MODEL_TIMEOUT_MS, type ModelRequest } from '@jojo/service/core/model-server'
import { failed, sendStream, type Sent } from './local-service'

/**
 * Owner request Q191: building a profile from a long CV failed with "Nothing
 * answered … within 60 seconds" while the model was still producing.
 *
 * The fix was to read the answer as a stream and make the timeout IDLE rather
 * than total: every chunk resets the clock, so a model that keeps producing is
 * never cut off however long it runs, and one that goes quiet is still reported
 * after the same interval. Asserted on `sendStream` with fake timers and a
 * stubbed `fetch` whose body arrives one chunk every two-thirds of the timeout —
 * well past the old total budget by the end, never idle for a whole one.
 *
 * No jsdom (D20): `fetch` is a stubbed global, which is all this module reads.
 */

const request: ModelRequest = {
  url: 'http://localhost:8000/v1/chat/completions',
  method: 'POST',
  headers: {},
  body: '{}',
}
const ENDPOINT = 'http://localhost:8000/v1'
const GAP = Math.round((MODEL_TIMEOUT_MS * 2) / 3)

/** A response whose body yields `chunks` one at a time, `gap` ms apart, honouring abort. */
function slowStream(chunks: readonly string[], gaps: readonly number[]) {
  vi.stubGlobal('fetch', (_url: string, init: { signal: AbortSignal }) => {
    const encoder = new TextEncoder()
    let i = 0
    const reader = {
      read: () =>
        new Promise<{ done: boolean; value?: Uint8Array }>((resolve, reject) => {
          if (i >= chunks.length) {
            resolve({ done: true })
            return
          }
          const timer = setTimeout(() => {
            const value = encoder.encode(chunks[i] ?? '')
            i += 1
            resolve({ done: false, value })
          }, gaps[i] ?? 0)
          init.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            const error = new Error('The operation was aborted.')
            error.name = 'AbortError'
            reject(error)
          })
        }),
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: { getReader: () => reader },
      text: () => Promise.resolve(''),
    })
  })
}

const run = async (total: number): Promise<Sent> => {
  const sent = sendStream(request, ENDPOINT, () => {})
  await vi.advanceTimersByTimeAsync(total)
  return sent
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Q191 — a long answer read as it arrives', () => {
  it('is not cut off while the model keeps producing, however long it runs', async () => {
    vi.useFakeTimers()
    const parts = ['a', 'b', 'c', 'd']
    slowStream(parts, parts.map(() => GAP))
    // Four chunks two-thirds of the timeout apart: well past one whole timeout in total.
    expect(GAP * parts.length).toBeGreaterThan(MODEL_TIMEOUT_MS * 2)
    const sent = await run(GAP * parts.length + 1)
    expect(failed(sent)).toBe(false)
    expect(failed(sent) ? '' : sent.text).toBe('abcd')
  })

  it('still reports a stream that goes quiet for a whole timeout', async () => {
    vi.useFakeTimers()
    slowStream(['a', 'b'], [GAP, MODEL_TIMEOUT_MS + 1_000])
    const sent = await run(GAP + MODEL_TIMEOUT_MS + 1)
    expect(failed(sent)).toBe(true)
    expect(failed(sent) ? sent.failed.why : null).toBe('stalled')
  })
})
