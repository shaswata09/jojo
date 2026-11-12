import { describe, expect, it, vi } from 'vitest'
import { daySource, headlessHost } from './host'
import type { Host } from './host'

/**
 * The headless host is `KgProvider`'s default, which makes it the thing standing
 * between a renderer that supplies no platform and a crash at mount. Its whole
 * contract is "returns something React can call as a cleanup, and never calls
 * back" — so those are the two things asserted.
 */
describe('headlessHost', () => {
  it('returns a callable unsubscribe from every member', () => {
    const stop = [headlessHost.onUndoRequest(vi.fn()), headlessHost.onSuspend(vi.fn())]
    for (const fn of stop) {
      expect(typeof fn).toBe('function')
      expect(() => fn()).not.toThrow()
      // Unsubscribing twice is what React does across a StrictMode double-mount.
      expect(() => fn()).not.toThrow()
    }
  })

  it('never invokes the handler it was given', () => {
    const undo = vi.fn()
    const suspend = vi.fn()
    headlessHost.onUndoRequest(undo)
    headlessHost.onSuspend(suspend)
    expect(undo).not.toHaveBeenCalled()
    expect(suspend).not.toHaveBeenCalled()
  })

  it('is frozen, so nothing can quietly install a member on the shared default', () => {
    // It is a module const because KgProvider lists `host` in two dependency
    // arrays and a default minted per render would tear down and re-bind both
    // subscriptions on every render. Being shared is what makes freezing matter:
    // a test that patched a member would patch it for every other test too.
    expect(Object.isFrozen(headlessHost)).toBe(true)
  })
})

/**
 * The day `KgProvider` measures everything against, as an external store.
 *
 * It used to be `dayOf(now())` read only when the provider rendered, which is
 * rarely — a tab opened Monday measured everything against Monday all Tuesday.
 */
describe('daySource', () => {
  it('subscribes through the host’s day signal and reads the LOCAL day', () => {
    let fire: () => void = () => {}
    const stop = vi.fn()
    const host: Host = {
      ...headlessHost,
      onDayTurn: (run) => {
        fire = run
        return stop
      },
    }
    let clock = new Date(2026, 9, 12, 23, 59).toISOString()
    const day = daySource(host, () => clock)
    const notify = vi.fn()
    const unsubscribe = day.subscribe(notify)
    expect(day.getSnapshot()).toBe('2026-10-12')

    clock = new Date(2026, 9, 13, 0, 1).toISOString()
    fire()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(day.getSnapshot()).toBe('2026-10-13')
    // A string, so two reads of one day are `Object.is`-equal and React does
    // not loop.
    expect(day.getSnapshot()).toBe(day.getSnapshot())
    unsubscribe()
    expect(stop).toHaveBeenCalled()
  })

  it('subscribes to nothing on a host without the signal', () => {
    const unsubscribe = daySource(headlessHost, () => '2026-10-12T15:00:00.000Z').subscribe(vi.fn())
    expect(() => unsubscribe()).not.toThrow()
  })
})
