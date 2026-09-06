import { describe, expect, it } from 'vitest'
import { layoutFor, MAX_WIDTH, SHORT_VIEWPORT, TWO_COLUMN } from './layout-math'

/** A device, with the defaults the app actually passes. */
const at = (width: number, height: number, over: Partial<Parameters<typeof layoutFor>[0]> = {}) =>
  layoutFor({ width, height, insetLeft: 0, insetRight: 0, basePadding: 12, maxColumns: 1, ...over })

/** What the content actually measures once both gutters are taken off. */
const contentWidth = (r: ReturnType<typeof layoutFor>) => r.width - r.gutter * 2

describe('a single-column screen on a tablet', () => {
  it('caps at the readable width instead of spanning the device', () => {
    /*
     * THE REGRESSION TEST. Measured on a 1066dp tablet: a list of applications
     * was drawn 1042dp wide, each row a near-empty band with the title at one
     * edge and the date at the other. The cause was `columns` meaning "the
     * device is wide" rather than "this screen draws two", so the cap came from
     * MAX_WIDTH[2] = 1200, the centring went negative, and the gutter collapsed
     * to the safe-area minimum.
     */
    const tablet = at(1066, 1706)
    expect(tablet.columns).toBe(1)
    expect(contentWidth(tablet)).toBe(MAX_WIDTH[1])
    expect(tablet.gutter).toBe((1066 - 720) / 2)
  })

  it('never widens past 720, however large the screen', () => {
    for (const width of [900, 1024, 1280, 1600, 2560]) {
      expect(contentWidth(at(width, 1800)), `${String(width)}dp`).toBe(MAX_WIDTH[1])
    }
  })
})

describe('a two-column screen', () => {
  it('gets two columns once the device is wide enough', () => {
    expect(at(1066, 1706, { maxColumns: 2 }).columns).toBe(2)
    expect(at(TWO_COLUMN, 1400, { maxColumns: 2 }).columns).toBe(2)
  })

  it('is still one column on anything narrower, including a phone on its side', () => {
    // A phone in landscape is ~850dp and a portrait tablet ~800dp. Neither has
    // the width to run two useful columns of panels.
    for (const width of [TWO_COLUMN - 1, 850, 800, 430, 375]) {
      expect(at(width, 400, { maxColumns: 2 }).columns, `${String(width)}dp`).toBe(1)
    }
  })

  it('caps at 1200, so each column stays inside the readable range', () => {
    const big = at(1600, 2560, { maxColumns: 2 })
    expect(contentWidth(big)).toBe(MAX_WIDTH[2])
    // ~590 per column once the gap is taken out, which is why 1200 is allowed
    // here and 720 is the limit for one.
    expect(contentWidth(big) / 2).toBeLessThan(MAX_WIDTH[1])
  })
})

describe('phones', () => {
  it('uses the safe-area padding rather than centring, on every size', () => {
    // Centring is negative on a phone — the device is narrower than the cap — so
    // the gutter must fall back to the padding, not go negative.
    for (const [w, h] of [
      [375, 667],
      [390, 844],
      [430, 932],
    ]) {
      const r = at(w!, h!)
      expect(r.gutter, `${String(w)}dp`).toBe(12)
      expect(r.columns).toBe(1)
    }
  })

  it('never returns a negative gutter', () => {
    for (let w = 200; w <= 2600; w += 37) {
      expect(at(w, 800).gutter, `${String(w)}dp`).toBeGreaterThanOrEqual(0)
      expect(at(w, 800, { maxColumns: 2 }).gutter, `${String(w)}dp`).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('the notch, in landscape', () => {
  it('adds the larger inset to both sides', () => {
    const r = at(852, 393, { insetLeft: 59, insetRight: 0 })
    // The larger of the two, on both sides, so the row is not padded unevenly.
    expect(r.gutter).toBe(12 + 59)
  })

  it('lets centring win when it is the larger of the two', () => {
    // A big tablet: centring (173) beats safe area (12 + 20).
    const r = at(1066, 1706, { insetLeft: 20, insetRight: 0 })
    expect(r.gutter).toBe((1066 - 720) / 2)
  })
})

describe('orientation', () => {
  it('reports landscape from the dimensions rather than a stored flag', () => {
    expect(at(852, 393).landscape).toBe(true)
    expect(at(393, 852).landscape).toBe(false)
    // Square is not landscape: the comparison is strict, so a fold in its
    // half-open state does not flip layouts on a rounding error.
    expect(at(800, 800).landscape).toBe(false)
  })
})

describe('a short viewport — a phone held sideways', () => {
  it('is short on every phone in landscape, and on no phone upright', () => {
    // Real devices, both ways up. The pair matters: the same phone must switch.
    for (const [w, h] of [
      [852, 393], // iPhone 15 Pro
      [914, 411], // Pixel
      [667, 375], // iPhone SE
    ]) {
      expect(at(w!, h!).short, `${String(w)}x${String(h)}`).toBe(true)
      expect(at(h!, w!).short, `${String(h)}x${String(w)} upright`).toBe(false)
    }
  })

  it('is NOT short on a tablet, in either orientation', () => {
    /*
     * The distinction this flag exists to make. A tablet on its side IS
     * landscape, and has 800dp of height — compacting there would shrink the
     * title to solve a problem that device does not have. Keying off `landscape`
     * instead of height would have done exactly that.
     */
    const tabletLandscape = at(1280, 800, { maxColumns: 2 })
    expect(tabletLandscape.landscape).toBe(true)
    expect(tabletLandscape.short).toBe(false)

    expect(at(800, 1280, { maxColumns: 2 }).short).toBe(false)
  })

  it('turns over exactly at the threshold', () => {
    expect(at(900, SHORT_VIEWPORT - 1).short).toBe(true)
    expect(at(900, SHORT_VIEWPORT).short).toBe(false)
  })
})

describe('the Pixel Tablet, measured from its own AVD profile', () => {
  // 2560x1600 at 320dpi. Taken from the hardware profile rather than invented,
  // because the whole point of these two cases is that they are a real device.
  const LANDSCAPE = { w: 1280, h: 800 }
  const PORTRAIT = { w: 800, h: 1280 }

  it('runs two columns on its side and one upright', () => {
    expect(at(LANDSCAPE.w, LANDSCAPE.h, { maxColumns: 2 }).columns).toBe(2)
    /*
     * Upright it is 800dp, below the 900 threshold, so it stays on one column —
     * and that is deliberate rather than a miss. Two columns of 800dp would be
     * ~380 each, NARROWER than the 411dp phone the panels were designed for, so
     * the split would make every panel worse to read in exchange for using more
     * of the glass.
     */
    expect(at(PORTRAIT.w, PORTRAIT.h, { maxColumns: 2 }).columns).toBe(1)
  })

  it('never leaves content stretched, in either orientation', () => {
    // 1280 landscape caps at 1200; 800 portrait caps at 720. Both are inside
    // the readable range, which is what the fix was for.
    expect(contentWidth(at(LANDSCAPE.w, LANDSCAPE.h, { maxColumns: 2 }))).toBe(MAX_WIDTH[2])
    expect(contentWidth(at(PORTRAIT.w, PORTRAIT.h, { maxColumns: 2 }))).toBe(MAX_WIDTH[1])
  })

  it('keeps the full-size header in both orientations', () => {
    expect(at(LANDSCAPE.w, LANDSCAPE.h).short).toBe(false)
    expect(at(PORTRAIT.w, PORTRAIT.h).short).toBe(false)
  })
})
