import { describe, expect, it, vi } from 'vitest'
import { headlessHost } from './host'

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
