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

type Posted = { type: string; id: number; read?: { url: string }; capture?: string }
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

const { readDocument, capturePage } = await import('./capture-bridge')
const { CAPTURE_REJECTION_MESSAGE } = await import('@jojo/service/core/capture')

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

/** Lets the page's next round trip get posted: `capturePage` awaits between the two. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('capturing a page by its address', () => {
  const url = 'https://job-boards.greenhouse.io/acme/jobs/4'
  const page = {
    url,
    title: 'Research Engineer — Acme',
    html: '<!doctype html><html><body><h1>Research Engineer</h1></body></html>',
    capturedAt: '2026-09-11T10:00:00.000Z',
    dropped: 0,
    shadowRoots: 0,
  }

  it('says the extension is ABSENT when nothing answers, so the caller may use the reader', async () => {
    vi.useFakeTimers()
    const read = capturePage(url)
    await vi.advanceTimersByTimeAsync(401)
    await expect(read).resolves.toMatchObject({ ok: false, absent: true })
    // Only the 400ms probe went out — not a 90-second capture into silence.
    expect(posted).toHaveLength(1)
    expect(posted[0]?.capture).toBeUndefined()
  })

  it('names a stale extension, and never hands it a verb it would misroute', async () => {
    const read = capturePage(url)
    reply({ count: 0 }) // a protocol-5 bridge: before capture-by-address existed
    await expect(read).resolves.toMatchObject({ ok: false, absent: false })
    expect((await read).ok === false && (await read)).toMatchObject({
      reason: expect.stringContaining('Reload'),
    })
    expect(posted).toHaveLength(1)
  })

  it('names a revision-7 extension stale, rather than letting it refuse a big page as too big', async () => {
    // Revision 7 can capture by address but refuses any page over the cap
    // outright, in a sentence that blames the page. A copy unzipped from the
    // Settings download before the fix did exactly that after every Reload.
    const read = capturePage(url)
    reply({ protocol: 7, count: 0 })
    const out = await read
    expect(out).toMatchObject({ ok: false, absent: false })
    expect(out.ok === false && out.reason).toContain('older than this page')
    expect(out.ok === false && out.reason).toContain('download it again')
    // Never asked: a stale worker is not handed the verb at all.
    expect(posted).toHaveLength(1)
  })

  it('asks for the address, and brings the page back through the inbox’s own gate', async () => {
    const read = capturePage(url)
    reply({ protocol: 8, count: 0 })
    await settle()
    expect(posted.at(-1)).toMatchObject({ capture: url })
    reply({ protocol: 8, ok: true, capture: page })
    await expect(read).resolves.toEqual({ ok: true, capture: page })
  })

  it('refuses a page that fails the checks every capture has to pass', async () => {
    const read = capturePage(url)
    reply({ protocol: 8 })
    await settle()
    reply({ protocol: 8, ok: true, capture: { ...page, html: '   ' } })
    await expect(read).resolves.toEqual({
      ok: false,
      absent: false,
      reason: CAPTURE_REJECTION_MESSAGE.empty,
    })
  })

  it('carries the worker’s own sentence when it could not save the page', async () => {
    const read = capturePage(url)
    reply({ protocol: 8 })
    await settle()
    const why =
      'That page sent us to www.linkedin.com to sign in. Open the posting in a tab and sign in, then try again.'
    reply({ protocol: 8, ok: false, error: why })
    await expect(read).resolves.toEqual({ ok: false, absent: false, reason: why })
  })

  it('stops waiting when the caller cancels, and blames nobody else for it', async () => {
    const stop = new AbortController()
    const read = capturePage(url, stop.signal)
    reply({ protocol: 8 })
    await settle()
    stop.abort()
    await expect(read).resolves.toEqual({
      ok: false,
      absent: false,
      reason: 'The read was cancelled.',
    })
    expect(listeners.size).toBe(0)
  })
})
