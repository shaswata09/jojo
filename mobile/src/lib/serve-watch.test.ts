/**
 * Q129: when a sending phone says it is done, and when it stops listening.
 */

import { describe, expect, it, vi } from 'vitest'
import type { PullServing } from '@jojo/service/core/handoff-pull'
import { createServeWatch } from '@/lib/serve-watch'

const serving = (over: Partial<PullServing> = {}): PullServing => ({
  served: 0,
  chunks: null,
  size: null,
  finished: false,
  failed: false,
  ...over,
})

function rig(states: PullServing[]) {
  let i = 0
  let clock = 0
  const stop = vi.fn()
  const report = { onProgress: vi.fn(), onFinished: vi.fn(), onFailed: vi.fn() }
  const tick = createServeWatch(
    { progress: () => states[Math.min(i++, states.length - 1)]!, stop },
    report,
    () => clock,
    1000,
  )
  return { tick, stop, report, advance: (ms: number) => (clock += ms) }
}

describe('watching a phone that is sending', () => {
  it('says finished once, and keeps listening until the last write has had time to land', () => {
    const r = rig([serving({ served: 1, chunks: 2 }), serving({ served: 2, chunks: 2, finished: true })])
    r.tick()
    r.tick()
    r.tick()
    expect(r.report.onFinished).toHaveBeenCalledOnce()
    // Stopping now would destroy the socket still writing the last chunk.
    expect(r.stop).not.toHaveBeenCalled()
    r.advance(999)
    r.tick()
    expect(r.stop).not.toHaveBeenCalled()
    r.advance(1)
    r.tick()
    r.tick()
    expect(r.stop).toHaveBeenCalledOnce()
  })

  it('closes at once, and says so once, when the backup could not be gathered', () => {
    const r = rig([serving({ failed: true })])
    r.tick()
    r.tick()
    expect(r.stop).toHaveBeenCalledOnce()
    expect(r.report.onFailed).toHaveBeenCalledOnce()
    expect(r.report.onFinished).not.toHaveBeenCalled()
  })

  it('reports progress on every tick until it stops', () => {
    const r = rig([serving({ served: 1, chunks: 3 })])
    r.tick()
    expect(r.report.onProgress).toHaveBeenLastCalledWith(1, 3)
  })
})
