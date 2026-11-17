/**
 * Q129: when a sending phone says it is done, and when it stops listening.
 */

import { describe, expect, it, vi } from 'vitest'
import type { HandoffOutcome } from '@jojo/service/core/handoff'
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

function rig(states: PullServing[], told: () => HandoffOutcome = () => 'applied') {
  let i = 0
  let clock = 0
  const stop = vi.fn()
  const report = {
    onProgress: vi.fn(),
    onFinished: vi.fn(),
    onFailed: vi.fn(),
    onOutcome: vi.fn(),
  }
  const tick = createServeWatch(
    { progress: () => states[Math.min(i++, states.length - 1)]!, outcome: told, stop },
    report,
    () => clock,
    1000,
    60_000,
  )
  return { tick, stop, report, advance: (ms: number) => (clock += ms) }
}

describe('watching a phone that is sending', () => {
  it('says finished once, and keeps listening until the last write has had time to land', () => {
    const r = rig([
      serving({ served: 1, chunks: 2 }),
      serving({ served: 2, chunks: 2, finished: true }),
    ])
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

  it('says so once when the backup could not be gathered, and closes after the grace', () => {
    const r = rig([serving({ failed: true })])
    r.tick()
    r.tick()
    expect(r.report.onFailed).toHaveBeenCalledOnce()
    expect(r.report.onFinished).not.toHaveBeenCalled()
    // Still listening, so the 409 telling the computer why can reach it.
    expect(r.stop).not.toHaveBeenCalled()
    r.advance(1000)
    r.tick()
    r.tick()
    expect(r.stop).toHaveBeenCalledOnce()
  })

  it('reports progress on every tick until it stops', () => {
    const r = rig([serving({ served: 1, chunks: 3 })])
    r.tick()
    expect(r.report.onProgress).toHaveBeenLastCalledWith(1, 3)
  })
})

describe('waiting for the computer to say what its person did', () => {
  const done = [serving({ served: 2, chunks: 2, finished: true })]

  it('keeps listening while the computer has not answered, and reports nothing yet', () => {
    const r = rig(done, () => 'pending')
    r.tick()
    r.advance(30_000)
    r.tick()
    expect(r.report.onFinished).toHaveBeenCalledOnce()
    expect(r.report.onOutcome).not.toHaveBeenCalled()
    expect(r.stop).not.toHaveBeenCalled()
  })

  it('reports the answer once when it comes, then closes after the grace', () => {
    let answer: HandoffOutcome = 'pending'
    const r = rig(done, () => answer)
    r.tick()
    answer = 'declined'
    r.tick()
    r.tick()
    expect(r.report.onOutcome).toHaveBeenCalledOnce()
    expect(r.report.onOutcome).toHaveBeenCalledWith('declined')
    expect(r.stop).not.toHaveBeenCalled()
    r.advance(1000)
    r.tick()
    expect(r.stop).toHaveBeenCalledOnce()
  })

  it('gives up on a computer that never answers, as unknown, and closes', () => {
    const r = rig(done, () => 'pending')
    r.tick()
    r.advance(60_000)
    r.tick()
    expect(r.report.onOutcome).toHaveBeenCalledWith('unknown')
    r.advance(1000)
    r.tick()
    expect(r.stop).toHaveBeenCalledOnce()
  })
})
