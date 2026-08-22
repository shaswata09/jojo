import type { Application } from '@splinetool/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POSE_MS } from '@/lib/mascot-context'
import { createSplineRig } from '@/lib/spline-rig'

/** The one object every gesture drives; see JOINTS in spline-rig.ts. */
const BOT = '95b11be5-c203-4914-a8b9-7a05fa62a46c'

/** Rest values are arbitrary and non-zero on purpose: gestures are offsets
 *  from whatever the scene happened to be showing, so a rig that confused an
 *  offset with an absolute would pass against zeros. */
const REST = { py: 25.677, rx: 0 }

function fakeScene() {
  const bot = {
    position: { x: -2.755, y: REST.py, z: 0 },
    rotation: { x: REST.rx, y: 0, z: 0 },
    scale: { x: 0.8, y: 0.8, z: 0.8 },
  }
  const app = {
    findObjectById: (id: string) => (id === BOT ? bot : undefined),
  } as unknown as Application
  return { app, bot }
}

let now = 0
let frames: Map<number, FrameRequestCallback>
let nextFrameId = 1

/** Runs every frame due in the window, the way a display would. */
const advance = (ms: number) => {
  now += ms
  const due = [...frames.values()]
  frames.clear()
  for (const cb of due) cb(now)
}

beforeEach(() => {
  now = 0
  frames = new Map()
  nextFrameId = 1
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrameId++
    frames.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => void frames.delete(id))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createSplineRig', () => {
  it('does not amputate a gesture when idle arrives before it has landed', () => {
    const { app, bot } = fakeScene()
    const rig = createSplineRig(app)

    rig.play('bow')
    advance(16)
    advance(POSE_MS.bow * 0.8 - 16)

    // Mid-return: still pitched forward and still sunk.
    const pitched = bot.rotation.x
    const sunk = bot.position.y
    expect(pitched).toBeGreaterThan(0.1)
    expect(sunk).toBeLessThan(REST.py - 1)

    // MascotProvider's scheduled end, arriving early because its timer started
    // at the call and the rig's started at the effect. This must not move the
    // robot — that jump is the reported glitch.
    rig.play('idle')
    expect(bot.rotation.x).toBe(pitched)
    expect(bot.position.y).toBe(sunk)

    // The curve still gets to finish, and lands exactly on rest.
    advance(POSE_MS.bow * 0.25)
    expect(bot.rotation.x).toBe(REST.rx)
    expect(bot.position.y).toBe(REST.py)
    expect(frames.size).toBe(0)
  })

  it('still settles when a different gesture interrupts one in flight', () => {
    const { app, bot } = fakeScene()
    const rig = createSplineRig(app)

    rig.play('bow')
    advance(POSE_MS.bow * 0.5)
    expect(bot.position.y).toBeLessThan(REST.py - 1)

    // A real interrupt resets first, or the two gestures would compound and
    // leanIn would be measured from a bowed pose.
    rig.play('leanIn')
    advance(POSE_MS.leanIn)
    expect(bot.rotation.x).toBe(REST.rx)
    expect(bot.position.y).toBe(REST.py)
    expect(bot.position.z).toBe(0)
  })

  it('leaves nothing running once a gesture has landed', () => {
    const { app, bot } = fakeScene()
    const rig = createSplineRig(app)

    rig.play('bow')
    advance(POSE_MS.bow + 16)
    expect(frames.size).toBe(0)

    // Idle with nothing in flight is a no-op, not a re-settle.
    rig.play('idle')
    expect(frames.size).toBe(0)
    expect(bot.position.y).toBe(REST.py)
  })

  it('dispose stops a gesture where it stands and restores rest', () => {
    const { app, bot } = fakeScene()
    const rig = createSplineRig(app)

    rig.play('bow')
    advance(POSE_MS.bow * 0.5)
    rig.dispose()

    expect(bot.rotation.x).toBe(REST.rx)
    expect(bot.position.y).toBe(REST.py)
    expect(frames.size).toBe(0)
  })
})

