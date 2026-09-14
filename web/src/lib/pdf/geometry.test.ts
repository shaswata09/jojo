import { describe, expect, it } from 'vitest'
import {
  NOTE_SIZE,
  boundsOf,
  noteRect,
  normalise,
  quadFrom,
  usefulRects,
  viewRectFrom,
} from './geometry'
import type { Quad, ToPdfPoint, ViewRect } from './geometry'

/**
 * A page 800 CSS pixels tall drawn at 2x from a 400pt page, unrotated: the
 * y axis flips and both axes halve. Written out rather than taken from pdf.js
 * so the expected numbers below can be checked by hand.
 */
const at2x: ToPdfPoint = (x, y) => ({ x: x / 2, y: (800 - y) / 2 })
/** The same page turned a quarter turn: what was down the page is now across it. */
const turned: ToPdfPoint = (x, y) => ({ x: y / 2, y: x / 2 })

const RECT: ViewRect = { left: 100, top: 200, right: 300, bottom: 240 }

describe('a highlighted rectangle as QuadPoints', () => {
  it('is upper-left, upper-right, lower-left, lower-right', () => {
    /*
     * The Z, not the loop. The spec says counterclockwise and every viewer
     * disagrees; emitting the spec order draws the highlight as a bow-tie.
     */
    expect(quadFrom(RECT, at2x)).toEqual([50, 300, 150, 300, 50, 280, 150, 280])
  })

  it('puts the top of the selection at the HIGHER pdf y', () => {
    // The axis flip: further down the screen is a smaller number in PDF space.
    const [, ulY, , , , llY] = quadFrom(RECT, at2x) as unknown as number[]
    expect(ulY).toBeGreaterThan(llY as number)
  })

  it('comes out the same when the selection was dragged backwards', () => {
    const backwards: ViewRect = { left: 300, top: 240, right: 100, bottom: 200 }
    expect(quadFrom(backwards, at2x)).toEqual(quadFrom(RECT, at2x))
  })

  it('follows the page’s rotation, because the projection carries it', () => {
    expect(quadFrom(RECT, turned)).toEqual([100, 50, 100, 150, 120, 50, 120, 150])
  })

  it('is a degenerate quad for a zero-width rect rather than a throw', () => {
    const empty: ViewRect = { left: 10, top: 10, right: 10, bottom: 10 }
    expect(quadFrom(empty, at2x)).toEqual([5, 395, 5, 395, 5, 395, 5, 395])
  })
})

describe('normalising a rectangle', () => {
  it('puts the corners back in reading order', () => {
    expect(normalise({ left: 5, top: 9, right: 1, bottom: 2 })).toEqual({
      left: 1,
      top: 2,
      right: 5,
      bottom: 9,
    })
  })

  it('leaves one that is already in order alone', () => {
    expect(normalise(RECT)).toEqual(RECT)
  })
})

describe('the rect that encloses an annotation', () => {
  it('covers every quad, because a viewer may clip to it', () => {
    const first = quadFrom({ left: 100, top: 200, right: 300, bottom: 240 }, at2x)
    const second = quadFrom({ left: 100, top: 260, right: 200, bottom: 300 }, at2x)
    expect(boundsOf([first, second])).toEqual([50, 250, 150, 300])
  })

  it('covers a single quad exactly', () => {
    expect(boundsOf([quadFrom(RECT, at2x)])).toEqual([50, 280, 150, 300])
  })

  it('is empty for no quads rather than -Infinity', () => {
    // Math.min of nothing is Infinity, which would serialise into the PDF.
    expect(boundsOf([])).toEqual([0, 0, 0, 0])
    for (const n of boundsOf([])) expect(Number.isFinite(n)).toBe(true)
  })

  it('handles a quad whose corners are crossed', () => {
    const crossed = [10, 10, 0, 20, 30, 5, 20, 25] as unknown as Quad
    expect(boundsOf([crossed])).toEqual([0, 5, 30, 25])
  })
})

describe('painting a quad back onto the drawing', () => {
  /** The inverses of the two projections at the top of this file. */
  const at2xBack: ToPdfPoint = (x, y) => ({ x: x * 2, y: 800 - y * 2 })
  const turnedBack: ToPdfPoint = (x, y) => ({ x: y * 2, y: x * 2 })

  it('lands back where the selection was', () => {
    const quad = quadFrom(RECT, at2x)
    expect(viewRectFrom(quad, at2xBack)).toEqual(RECT)
  })

  it('takes the extremes of all four corners, not of two', () => {
    /*
     * Under a quarter turn the corner that was top-left is no longer the
     * smallest of anything, so projecting a pair and assuming the rest puts
     * the box on the wrong edge of the page.
     */
    const quad = quadFrom(RECT, turned)
    expect(viewRectFrom(quad, turnedBack)).toEqual(RECT)
  })

  it('is in order whichever way the projection flips', () => {
    const box = viewRectFrom(quadFrom(RECT, turned), turnedBack)
    expect(box.right).toBeGreaterThanOrEqual(box.left)
    expect(box.bottom).toBeGreaterThanOrEqual(box.top)
  })
})

describe('where a sticky note sits', () => {
  it('hangs below and right of the point, which is its top-left', () => {
    expect(noteRect({ x: 100, y: 500 })).toEqual([100, 500 - NOTE_SIZE, 100 + NOTE_SIZE, 500])
  })

  it('is square at whatever size is asked for', () => {
    const [x0, y0, x1, y1] = noteRect({ x: 0, y: 0 }, 10)
    expect(x1 - x0).toBe(10)
    expect(y1 - y0).toBe(10)
  })
})

describe('which selection rectangles are worth keeping', () => {
  it('drops the empty ones a line box leaves behind', () => {
    const rects: ViewRect[] = [
      { left: 0, top: 0, right: 100, bottom: 12 },
      { left: 100, top: 0, right: 100, bottom: 12 },
      { left: 0, top: 12, right: 80, bottom: 24 },
    ]
    expect(usefulRects(rects)).toHaveLength(2)
  })

  it('drops a hairline sliver that would highlight as a speck', () => {
    const sliver: ViewRect = { left: 0, top: 0, right: 0.4, bottom: 12 }
    expect(usefulRects([sliver])).toEqual([])
  })

  it('normalises what it keeps', () => {
    expect(usefulRects([{ left: 50, top: 30, right: 10, bottom: 10 }])).toEqual([
      { left: 10, top: 10, right: 50, bottom: 30 },
    ])
  })

  it('keeps everything when the threshold is zero-width text', () => {
    const thin: ViewRect = { left: 0, top: 0, right: 2, bottom: 2 }
    expect(usefulRects([thin], 2)).toHaveLength(1)
  })
})
