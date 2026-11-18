/**
 * The phone's model transport leaves nothing behind on the signal it is given.
 *
 * A run hands one signal to every model call it makes, so a listener added per
 * call and never removed grew for the length of the run — the leak the web's
 * twin was fixed for in review 3 (leaks-4). And a signal already stopped is
 * answered before anything is armed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({ i18next: { t: (key: string) => key } }))

const { send } = await import('@/lib/local-service')

const request = { url: 'http://127.0.0.1:11434/v1/chat', method: 'POST', headers: {}, body: '{}' }

function countingSignal() {
  const controller = new AbortController()
  let live = 0
  const add = controller.signal.addEventListener.bind(controller.signal)
  const remove = controller.signal.removeEventListener.bind(controller.signal)
  controller.signal.addEventListener = ((...args: Parameters<typeof add>) => {
    live += 1
    add(...args)
  }) as typeof add
  controller.signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
    live -= 1
    remove(...args)
  }) as typeof remove
  return { controller, live: () => live }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('a model call on the phone (review 3, leaks-4)', () => {
  it('takes its listener off the run’s signal when the call is over', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    )
    const run = countingSignal()
    for (let i = 0; i < 5; i++)
      await send(request as never, 'http://127.0.0.1:11434', run.controller.signal)
    expect(run.live()).toBe(0)
  })

  it('arms no timer and adds no listener for a call stopped before it was sent', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const run = countingSignal()
    run.controller.abort()
    const sent = await send(request as never, 'http://127.0.0.1:11434', run.controller.signal)
    expect('failed' in sent).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(run.live()).toBe(0)
  })
})
