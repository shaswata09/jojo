/**
 * One round trip to the extension, and what a cancel does to it.
 *
 * `ask` is the only thing on this side that WAITS, so it is the only place a
 * cancel can be honoured — and it did not take one. A relayed read therefore ran
 * to its full budget however long ago the user had closed the dialog, which is
 * how "New application from a link", cancelled at second two, saved a posting
 * and opened the create form at second forty over an unrelated screen.
 *
 * No jsdom — D20. `window` here is a stub with the four methods this module
 * actually uses, the same move `local-service.test.ts` makes with `fetch`: it
 * keeps the assertions on the message that was posted and the listener that was
 * taken off, rather than on a DOM nobody renders.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Posted = { type: string; id: number; read?: { url: string } }
type Listener = (event: { source: unknown; origin: string; data: unknown }) => void

const listeners = new Set<Listener>()
const posted: Posted[] = []

const fakeWindow = {
  location: { origin: 'https://jojo.test' },
  addEventListener: (type: string, fn: Listener) => {
    if (type === 'message') listeners.add(fn)
  },
  removeEventListener: (_type: string, fn: Listener) => {
    listeners.delete(fn)
  },
  postMessage: (message: Posted) => {
    posted.push(message)
  },
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number) => {
    clearTimeout(id)
  },
}

vi.stubGlobal('window', fakeWindow)

const { readDocument } = await import('./capture-bridge')

/** What the bridge would post back, correlated on the id the page chose. */
const reply = (extra: Record<string, unknown>) => {
  const last = posted.at(-1)
  for (const listener of [...listeners]) {
    listener({
      source: fakeWindow,
      origin: 'https://jojo.test',
      data: { type: 'jojo:capture-reply', id: last?.id, protocol: 5, ...extra },
    })
  }
}

const request = { url: 'http://127.0.0.1:3001/mcp', method: 'POST', headers: {}, body: '{}' }

beforeEach(() => {
  listeners.clear()
  posted.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a relayed read that is cancelled', () => {
  it('settles as soon as the caller aborts, rather than at the budget', async () => {
    const stop = new AbortController()
    const read = readDocument(request, stop.signal)
    // Posted, so the worker is genuinely mid-fetch — this is the case that used
    // to sit here for the whole relay budget.
    expect(posted.length).toBe(1)

    stop.abort()

    // Named as the caller's own doing. Reporting the extension for a cancel
    // sends somebody to reinstall a working one.
    await expect(read).resolves.toEqual({ failed: { reason: 'The read was cancelled.' } })
  })

  it('takes its message listener off, so a late answer resolves nothing', async () => {
    const stop = new AbortController()
    const read = readDocument(request, stop.signal)
    stop.abort()
    await read

    expect(listeners.size).toBe(0)
    // The worker's answer arrives anyway — its fetch was never called off — and
    // has to land on nothing rather than on a promise already settled.
    expect(() => {
      reply({ ok: true, status: 200, text: 'late' })
    }).not.toThrow()
  })

  it('does not send a request the caller has already cancelled', async () => {
    const stop = new AbortController()
    stop.abort()

    // `abort` never fires on a signal that was aborted before the listener was
    // added, so without the up-front check this waited out the full budget for
    // an answer nobody wanted.
    await expect(readDocument(request, stop.signal)).resolves.toEqual({
      failed: { reason: 'The read was cancelled.' },
    })
    expect(posted).toEqual([])
  })
})

describe('how long a relayed read waits', () => {
  /*
   * THE ORDER OF THESE FOUR IS THE TEST, and the file walks it forwards on
   * purpose. The long budget is EARNED: `answered` is module state, set by the
   * first round trip anything replies to, and there is no honest way back to
   * "nothing has ever answered" once one has. So the unproven case is asserted
   * first, the reply that proves the bridge is second, and the two budgets that
   * follow from it are third and fourth.
   *
   * The budgets disagreed with the worker's for a release: 40 seconds here
   * against 120 there, with nothing re-arming this one because reads do not
   * stream. A 55-second PDF conversion succeeded in the worker and was reported
   * to the user as "the extension did not answer".
   */
  it('gives up quickly while nothing has ever answered', async () => {
    vi.useFakeTimers()
    const read = readDocument(request)

    // The short budget, which is what somebody with no extension installed is
    // waiting through — including in Settings' "Test connection", since the
    // handshake goes down this same road.
    await vi.advanceTimersByTimeAsync(40000)

    const answer = await read
    expect('failed' in answer && answer.failed.reason).toContain(
      'The jojo browser extension did not answer',
    )
  })

  it('answers with what the bridge sent back', async () => {
    const read = readDocument(request)
    reply({ ok: true, status: 200, text: '{"result":{}}' })

    await expect(read).resolves.toEqual({ ok: true, status: 200, text: '{"result":{}}' })
    expect(listeners.size).toBe(0)
  })

  it('waits out a conversion that runs past the short budget', async () => {
    vi.useFakeTimers()
    const read = readDocument(request)

    // Sixty seconds is a real PDF, and the worker is still working on it: its
    // own budget is 120. This is the answer that used to be thrown away.
    await vi.advanceTimersByTimeAsync(60000)
    reply({ ok: true, status: 200, text: '# A CV' })

    await expect(read).resolves.toEqual({ ok: true, status: 200, text: '# A CV' })
  })

  it('still blames the extension once even the worker has given up', async () => {
    vi.useFakeTimers()
    const read = readDocument(request)
    await vi.advanceTimersByTimeAsync(125000)

    const answer = await read
    expect('failed' in answer && answer.failed.reason).toContain(
      'The jojo browser extension did not answer',
    )
  })
})
