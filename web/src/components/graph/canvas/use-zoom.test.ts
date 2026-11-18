/**
 * The overview's gesture arithmetic, run rather than read: when a press becomes
 * a pan, how a pinch scales, that a finger lifting does not make the picture
 * jump, and that a pan is never also a click. `useZoom` is the wiring round
 * these; the regex guards in `overview.requests.test.ts` cover that wiring.
 */

import { describe, expect, it } from 'vitest'
import {
  DRAG_SLOP,
  MAX_ZOOM,
  dragLatch,
  gestureMove,
  gestureStart,
  revealView,
  startsGesture,
} from './use-zoom'
import type { ZoomView } from './use-zoom'

const box = { width: 800, height: 600 }
const FIT: ZoomView = { k: 1, x: 0, y: 0 }

describe('a press on the overview', () => {
  it('stays a click until it moves past the slop, then pans by the whole delta', () => {
    expect(DRAG_SLOP).toBe(4)
    const g = gestureStart({ k: 2, x: -100, y: -100 }, [{ x: 200, y: 200 }], null)
    expect(g).not.toBeNull()
    if (!g) return
    expect(gestureMove(g, [{ x: 203, y: 200 }], box)).toEqual({ view: null, moved: false })
    const step = gestureMove(g, [{ x: 205, y: 200 }], box)
    expect(step.moved).toBe(true)
    // Measured from the press, so the first pan step includes the slop it crossed.
    expect(step.view).toEqual({ k: 2, x: -95, y: -100 })
  })

  it('keeps panning once moved, even back inside the slop', () => {
    const g = gestureStart({ k: 2, x: -100, y: -100 }, [{ x: 200, y: 200 }], null)
    if (!g) throw new Error('no gesture')
    const moved = { ...g, moved: true }
    expect(gestureMove(moved, [{ x: 201, y: 200 }], box)).toEqual({
      view: { k: 2, x: -99, y: -100 },
      moved: true,
    })
  })

  it('cannot pan the picture off the box', () => {
    const g = gestureStart(FIT, [{ x: 100, y: 100 }], null)
    if (!g) throw new Error('no gesture')
    // At fit there is nowhere to go.
    expect(gestureMove(g, [{ x: 300, y: 300 }], box).view).toEqual(FIT)
  })

  it('ignores a mouse’s other buttons, never a touch or a pen', () => {
    expect(startsGesture('mouse', 0)).toBe(true)
    expect(startsGesture('mouse', 1)).toBe(false)
    expect(startsGesture('mouse', 2)).toBe(false)
    expect(startsGesture('touch', 0)).toBe(true)
    expect(startsGesture('pen', 0)).toBe(true)
  })
})

describe('a pinch on the overview', () => {
  it('doubles the scale when two fingers spread from 100 to 200 px, about their midpoint', () => {
    const g = gestureStart(
      FIT,
      [
        { x: 350, y: 300 },
        { x: 450, y: 300 },
      ],
      null,
    )
    if (!g) throw new Error('no gesture')
    expect(g.dist).toBe(100)
    const step = gestureMove(
      g,
      [
        { x: 300, y: 300 },
        { x: 500, y: 300 },
      ],
      box,
    )
    expect(step.moved).toBe(true)
    const view = step.view as ZoomView
    expect(view.k).toBe(2)
    // The midpoint (400, 300) stays under the fingers.
    expect(400 * view.k + view.x).toBe(400)
    expect(300 * view.k + view.y).toBe(300)
  })

  it('is a pinch at once, with no slop, and clamps between fit and the maximum', () => {
    const at = (spread: number) => [
      { x: 400 - spread / 2, y: 300 },
      { x: 400 + spread / 2, y: 300 },
    ]
    const g = gestureStart(FIT, at(100), null)
    if (!g) throw new Error('no gesture')
    expect(gestureMove(g, at(101), box).moved).toBe(true)
    expect(gestureMove(g, at(5000), box).view?.k).toBe(MAX_ZOOM)
    expect(gestureMove(g, at(10), box).view).toEqual(FIT)
  })

  it('does not jump when a finger lifts: the other is measured from where it is now', () => {
    const g = gestureStart(
      FIT,
      [
        { x: 350, y: 300 },
        { x: 450, y: 300 },
      ],
      null,
    )
    if (!g) throw new Error('no gesture')
    const pinched = gestureMove(
      g,
      [
        { x: 300, y: 300 },
        { x: 500, y: 300 },
      ],
      box,
    ).view as ZoomView
    // The finger at 500 lifts; the gesture restarts on the one at 300.
    const rest = gestureStart(pinched, [{ x: 300, y: 300 }], { ...g, moved: true })
    if (!rest) throw new Error('no gesture')
    expect(rest.moved).toBe(true)
    expect(rest.dist).toBe(0)
    // Not moving it changes nothing — without the re-anchor, the old midpoint
    // (400) against this finger (300) was a 100 px jump.
    expect(gestureMove(rest, [{ x: 300, y: 300 }], box).view).toEqual(pinched)
    expect(gestureMove(rest, [{ x: 290, y: 300 }], box).view).toEqual({
      ...pinched,
      x: pinched.x - 10,
    })
  })

  it('ends when the last finger lifts', () => {
    expect(gestureStart(FIT, [], null)).toBeNull()
  })
})

describe('after a press', () => {
  it('answers “it was a drag” once, so a pan is not also a click', () => {
    const latch = dragLatch()
    expect(latch.consume()).toBe(false)
    latch.mark()
    expect(latch.consume()).toBe(true)
    expect(latch.consume()).toBe(false)
    latch.mark()
    latch.reset()
    expect(latch.consume()).toBe(false)
  })
})

describe('bringing a record into view', () => {
  it('does nothing at fit, where everything is on screen', () => {
    expect(revealView(FIT, { x: 790, y: 590 }, box)).toBeNull()
  })

  it('does nothing when the record is already on screen with room round it', () => {
    expect(revealView({ k: 2, x: 0, y: 0 }, { x: 100, y: 100 }, box)).toBeNull()
  })

  it('centres a record that is off screen, at the same zoom, within the box', () => {
    const view = revealView({ k: 2, x: 0, y: 0 }, { x: 700, y: 500 }, box)
    expect(view).toEqual({ k: 2, x: -800, y: -600 })
    const mid = revealView({ k: 4, x: 0, y: 0 }, { x: 400, y: 300 }, box)
    expect(mid).toEqual({ k: 4, x: 400 - 1600, y: 300 - 1200 })
  })
})
