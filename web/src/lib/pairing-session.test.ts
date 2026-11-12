/**
 * The pairing screen's refresh timer, held without a tree.
 *
 * It used to keep running after `complete` had paired the devices, so the
 * offer was re-minted under a transfer in progress and the phase went back to
 * 'offering'. `armRefresh` is the timer with the guard on it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { armRefresh } from './pairing-session'

afterEach(() => {
  vi.useRealTimers()
})

describe('armRefresh', () => {
  it('re-mints the offer before it expires while nobody has paired', () => {
    vi.useFakeTimers()
    const refresh = vi.fn()
    armRefresh(refresh, () => false, 1000)
    vi.advanceTimersByTime(1000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does nothing once paired, even though it was armed before', () => {
    vi.useFakeTimers()
    const refresh = vi.fn()
    let paired = false
    armRefresh(refresh, () => paired, 1000)
    // Pairing lands between arming and firing — the case that broke.
    vi.advanceTimersByTime(500)
    paired = true
    vi.advanceTimersByTime(500)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('is cancelled by its cleanup', () => {
    vi.useFakeTimers()
    const refresh = vi.fn()
    armRefresh(refresh, () => false, 1000)()
    vi.advanceTimersByTime(1000)
    expect(refresh).not.toHaveBeenCalled()
  })
})
