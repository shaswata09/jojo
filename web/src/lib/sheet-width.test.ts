import { describe, expect, it } from 'vitest'
import {
  COARSE_STEP,
  MAX_SHARE,
  MAX_SHEET_WIDTH,
  MIN_SHEET_WIDTH,
  STEP,
  canResizeAt,
  clampSheetWidth,
  maxWidthFor,
  nudgeWidth,
  parseStoredWidth,
  widthFromPointer,
} from './sheet-width'

/** A desktop with room to spare, and a laptop where the screen is the limit. */
const WIDE = 1920
const NARROW = 900

describe('the widest this screen allows', () => {
  it('is the hard maximum on a screen with room for it', () => {
    expect(maxWidthFor(WIDE)).toBe(MAX_SHEET_WIDTH)
  })

  it('is a share of the screen when that is smaller than the hard cap', () => {
    expect(maxWidthFor(NARROW)).toBe(Math.floor(NARROW * MAX_SHARE))
  })

  it('always leaves room for the sidebar, which paints ABOVE the sheet', () => {
    /*
     * The bug this rule exists for, measured in a 1150px window before it: the
     * sheet's left edge landed at 50px against a sidebar whose right edge is
     * 252px, and `elementFromPoint` over the grip returned the sidebar — the
     * handle was unreachable and the record's left edge was behind the nav.
     *
     * The sidebar is 232px wide plus a 12px inset and only appears at Tailwind's
     * `lg`. So the property to hold is: from 1024px up, whatever is left of the
     * sheet clears it.
     */
    const SIDEBAR_FOOTPRINT = 252
    for (const viewport of [1024, 1100, 1150, 1280, 1440, 1600, 1920, 2560]) {
      const leftOver = viewport - maxWidthFor(viewport)
      expect(leftOver, `at ${viewport}px the sheet would reach ${leftOver}px`).toBeGreaterThan(
        SIDEBAR_FOOTPRINT,
      )
    }
  })

  it('never drops below the minimum, however small the screen', () => {
    /*
     * On a phone the sheet is already capped by its own `max-w`. Returning
     * something under the minimum here would make every clamp snap it to a
     * width the stylesheet then overrides anyway — the number and the pixels
     * would disagree, and `aria-valuenow` would report the wrong one.
     */
    expect(maxWidthFor(390)).toBe(MIN_SHEET_WIDTH)
    expect(maxWidthFor(0)).toBe(MIN_SHEET_WIDTH)
  })
})

describe('clamping a width', () => {
  it('leaves one that already fits', () => {
    expect(clampSheetWidth(700, WIDE)).toBe(700)
  })

  it('pulls a narrow one up to the minimum', () => {
    expect(clampSheetWidth(100, WIDE)).toBe(MIN_SHEET_WIDTH)
    expect(clampSheetWidth(-999, WIDE)).toBe(MIN_SHEET_WIDTH)
  })

  it('pulls a wide one down to what the screen allows', () => {
    expect(clampSheetWidth(5000, WIDE)).toBe(MAX_SHEET_WIDTH)
    expect(clampSheetWidth(5000, NARROW)).toBe(Math.floor(NARROW * MAX_SHARE))
  })

  it('returns whole pixels', () => {
    expect(clampSheetWidth(700.4, WIDE)).toBe(700)
    expect(Number.isInteger(clampSheetWidth(700.5, WIDE))).toBe(true)
  })

  it('falls back to the minimum for a number that is not one', () => {
    // A width read back from storage, or a pointer event with no coordinates.
    expect(clampSheetWidth(Number.NaN, WIDE)).toBe(MIN_SHEET_WIDTH)
    expect(clampSheetWidth(Number.POSITIVE_INFINITY, WIDE)).toBe(MIN_SHEET_WIDTH)
  })
})

describe('the width a pointer implies', () => {
  it('measures from the pointer to the right edge, because the sheet is anchored right', () => {
    // Pointer 700px from the left of a 1920 window: 1220px of sheet to its
    // right, clamped to the maximum.
    expect(widthFromPointer(1920 - 700, WIDE)).toBe(700)
    expect(widthFromPointer(1920 - 900, WIDE)).toBe(900)
  })

  it('gets wider as the pointer moves LEFT', () => {
    /*
     * The direction this module exists to get right once. Reversed, the panel
     * runs away from the pointer instead of following it.
     */
    const nearRight = widthFromPointer(1400, WIDE)
    const further = widthFromPointer(1000, WIDE)
    expect(further).toBeGreaterThan(nearRight)
  })

  it('stops at both ends instead of following the pointer off-screen', () => {
    expect(widthFromPointer(0, WIDE)).toBe(MAX_SHEET_WIDTH)
    expect(widthFromPointer(WIDE, WIDE)).toBe(MIN_SHEET_WIDTH)
    expect(widthFromPointer(-500, WIDE)).toBe(MAX_SHEET_WIDTH)
    expect(widthFromPointer(WIDE + 500, WIDE)).toBe(MIN_SHEET_WIDTH)
  })
})

describe('a keyboard nudge', () => {
  it('widens on ArrowLeft, because the handle moves left with the edge', () => {
    expect(nudgeWidth(700, -1, WIDE)).toBe(700 + STEP)
  })

  it('narrows on ArrowRight', () => {
    expect(nudgeWidth(700, 1, WIDE)).toBe(700 - STEP)
  })

  it('takes a bigger bite with Shift', () => {
    expect(nudgeWidth(700, -1, WIDE, true)).toBe(700 + COARSE_STEP)
    expect(nudgeWidth(700, 1, WIDE, true)).toBe(700 - COARSE_STEP)
  })

  it('stops at the ends rather than running past them', () => {
    expect(nudgeWidth(MIN_SHEET_WIDTH, 1, WIDE)).toBe(MIN_SHEET_WIDTH)
    expect(nudgeWidth(MAX_SHEET_WIDTH, -1, WIDE)).toBe(MAX_SHEET_WIDTH)
    expect(nudgeWidth(MAX_SHEET_WIDTH, -1, WIDE, true)).toBe(MAX_SHEET_WIDTH)
  })

  it('respects a screen narrower than the hard maximum', () => {
    const cap = maxWidthFor(NARROW)
    expect(nudgeWidth(cap, -1, NARROW)).toBe(cap)
  })
})

describe('whether to offer the drag at all', () => {
  it('is offered when the screen has room to widen', () => {
    expect(canResizeAt(WIDE)).toBe(true)
    expect(canResizeAt(NARROW)).toBe(true)
  })

  it('is not offered when the sheet already fills what it may', () => {
    // A phone: the min and the max are the same number, so a handle would be a
    // control that cannot do anything.
    expect(canResizeAt(390)).toBe(false)
    expect(canResizeAt(Math.floor(MIN_SHEET_WIDTH / MAX_SHARE))).toBe(false)
  })
})

describe('reading a stored width', () => {
  it('takes a plain number', () => {
    expect(parseStoredWidth('760')).toBe(760)
    expect(parseStoredWidth('760.6')).toBe(761)
  })

  it('treats anything unusable as no preference at all', () => {
    for (const raw of [null, '', 'wide', 'NaN', '0', '-1', 'Infinity']) {
      expect(parseStoredWidth(raw)).toBeNull()
    }
  })

  it('does not clamp, so a width from a bigger monitor survives', () => {
    /*
     * Restoring is the caller's job, with the viewport it has at the time.
     * Clamping on read would shrink a preference permanently the first time it
     * was opened on a laptop.
     */
    expect(parseStoredWidth('3000')).toBe(3000)
  })
})
