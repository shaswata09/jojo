/**
 * `nativeHost`, which had no test at all.
 *
 * The audit that asked for this file measured what that cost: deleting
 * `onSuspend` outright, and narrowing its state check to `'background'` alone,
 * both left the whole suite green. `onSuspend` is this platform's only
 * flush-before-kill path — the queue is write-behind and RN throttles the
 * timers its retry backoff runs on, so a batch the user watched land on screen
 * is exposed until the OS decides to kill a backgrounded app. Web's equivalent
 * has twelve cases; this had none.
 *
 * AppState is mocked rather than driven, for the reason `vitest.config.mts`
 * gives: neither of the tested directories needs a React Native runtime, and a
 * test that had to boot one would be evidence that property had been lost. The
 * mock is the smallest thing that is still AppState — a listener list and a
 * `remove` on the subscription — because `onSuspend` returns an unsubscribe and
 * a mock without `remove` cannot fail the case that checks it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (state: string) => void

const listeners = new Set<Listener>()

/** Every registered listener, in registration order. Drives the cases below. */
const emit = (state: string) => {
  for (const fn of [...listeners]) fn(state)
}

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (event: string, fn: Listener) => {
      if (event !== 'change') throw new Error(`unexpected AppState event: ${event}`)
      listeners.add(fn)
      return { remove: () => listeners.delete(fn) }
    },
  },
}))

const { nativeHost } = await import('./host')

beforeEach(() => {
  listeners.clear()
})

describe('onSuspend — the last moment before the OS may stop running us', () => {
  it('flushes when the app goes to the background', () => {
    const run = vi.fn(() => Promise.resolve())
    nativeHost.onSuspend(run)

    emit('background')

    expect(run).toHaveBeenCalledTimes(1)
  })

  /**
   * The case the comment in `host.ts` was written for and nothing checked.
   *
   * iOS passes through `'inactive'` on the way to the app switcher, and a user
   * who swipes up from there to kill the app never generates a `'background'`
   * we get to act on. Narrowing this check to `'background'` alone is a
   * one-word edit that loses the last batch on exactly that gesture.
   */
  it('flushes on inactive too, which is the iOS swipe-to-kill path', () => {
    const run = vi.fn(() => Promise.resolve())
    nativeHost.onSuspend(run)

    emit('inactive')

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not flush when the app merely becomes active', () => {
    const run = vi.fn(() => Promise.resolve())
    nativeHost.onSuspend(run)

    emit('active')

    expect(run).not.toHaveBeenCalled()
  })

  /**
   * The port says `run` must be idempotent because the web adapter listens to
   * two events that both fire on a tab close. This adapter reaches the same
   * place differently: iOS emits `'inactive'` and then `'background'` for one
   * suspension, so a single trip to the app switcher calls it twice.
   */
  it('calls run once per state change, so one iOS suspension calls it twice', () => {
    const run = vi.fn(() => Promise.resolve())
    nativeHost.onSuspend(run)

    emit('inactive')
    emit('background')

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('stops listening when the unsubscribe is called', () => {
    const run = vi.fn(() => Promise.resolve())
    const stop = nativeHost.onSuspend(run)

    stop()
    emit('background')

    expect(run).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })
})

describe('onResume — a re-read after a background the OS may have killed us in', () => {
  it('runs when the app becomes active', () => {
    const run = vi.fn()
    nativeHost.onResume?.(run)

    emit('active')

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not run on the way out', () => {
    const run = vi.fn()
    nativeHost.onResume?.(run)

    emit('background')
    emit('inactive')

    expect(run).not.toHaveBeenCalled()
  })

  /**
   * Supplied, not omitted — and that is a decision rather than an accident.
   * `repo/boot.ts` subscribes to this only when the store reports
   * `crossTab: false`, which the RN driver always does, so dropping the method
   * would leave a phone that was killed and restarted mid-background showing
   * whatever was in memory before it went away.
   */
  it('is supplied at all', () => {
    expect(nativeHost.onResume).toBeTypeOf('function')
  })

  it('stops listening when the unsubscribe is called', () => {
    const run = vi.fn()
    const stop = nativeHost.onResume?.(run)

    stop?.()
    emit('active')

    expect(run).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })
})

describe('onUndoRequest — deliberately nothing', () => {
  /**
   * There is no chord on a phone. This is pinned rather than left implicit
   * because the alternative someone reaches for — borrowing web's keydown
   * adapter — would compile, register nothing, and read as wired.
   */
  it('registers no listener and never calls back', () => {
    const run = vi.fn()
    const stop = nativeHost.onUndoRequest(run)

    emit('background')
    emit('active')

    expect(listeners.size).toBe(0)
    expect(run).not.toHaveBeenCalled()
    expect(() => stop()).not.toThrow()
  })
})

describe('the two subscriptions do not interfere', () => {
  it('keeps suspend and resume on separate listeners', () => {
    const suspend = vi.fn(() => Promise.resolve())
    const resume = vi.fn()
    const stopSuspend = nativeHost.onSuspend(suspend)
    nativeHost.onResume?.(resume)

    // Dropping one must not silence the other: both go through one AppState
    // event and an adapter that shared a listener would take both down.
    stopSuspend()
    emit('active')

    expect(suspend).not.toHaveBeenCalled()
    expect(resume).toHaveBeenCalledTimes(1)
  })
})
