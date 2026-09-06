/**
 * How wide the content may be, and where the gutters fall — as arithmetic.
 *
 * ## Why this is not in `use-layout.ts`
 *
 * That file is a hook: it reads `useWindowDimensions` and the safe-area insets,
 * neither of which exists outside a rendered React Native tree, and nothing in
 * this project mounts a component in a test. So the part that can be WRONG —
 * the arithmetic — lives here, where a test can state a device and check the
 * answer, and the hook above is left with nothing but the two readings it takes.
 *
 * ## The bug this file exists to fix
 *
 * `columns` used to mean two different things at once: how many columns the
 * SCREEN can carry, and how many the DEVICE is wide enough for. They are not the
 * same, and conflating them was measured breaking every screen that renders a
 * single column of content on a tablet.
 *
 * On a 1066dp tablet the old code decided `columns: 2` from the width alone,
 * then capped the content at `MAX_WIDTH[2]` = 1200. 1066 is less than 1200, so
 * the centring was negative, the gutter fell back to the safe-area minimum, and
 * a list of applications was drawn 1042dp wide — each row a near-empty band with
 * the title pinned to one edge and the date to the other, 800dp of nothing
 * between them. Ten of the app's fifteen screens looked like that.
 *
 * So `maxColumns` is now an input: what THIS screen renders. The device width
 * decides whether it gets what it asked for, and never asks for more.
 */

/**
 * Where a tablet stops being a big phone.
 *
 * 900dp is a landscape 10" tablet and up; a portrait one is ~800dp and a phone
 * on its side ~850dp, so both stay on the single-column layout — which is right,
 * since neither has the width to run two useful columns of panels.
 */
export const TWO_COLUMN = 900

/**
 * How wide the content is allowed to get, by how many columns are drawn.
 *
 * One column stops at 720 because past that a line of text is longer than the
 * eye can track back to the start of the next one. Two columns may go to 1200,
 * because the constraint is the width of a SINGLE column — 1200 split in two is
 * ~590 each, inside the same readable range. The web app makes the same trade
 * with a 1440px shell and `lg:grid-cols-2` inside it.
 */
export const MAX_WIDTH = { 1: 720, 2: 1200 } as const

/**
 * Below this height, vertical space is the scarce resource rather than width.
 *
 * A phone on its side is ~390-411dp tall and a tablet on its side is 800, so
 * this separates the one case that genuinely needs a tighter frame from every
 * other orientation. 500 rather than 450 because a small phone in landscape
 * (iPhone SE, 320dp) and a large one (Pixel, 411dp) should behave the same, and
 * because nothing sits between 411 and 800 in practice.
 */
export const SHORT_VIEWPORT = 500

export type LayoutInput = {
  width: number
  height: number
  /** Safe-area insets. Zero in portrait; non-zero on the notch side in landscape. */
  insetLeft: number
  insetRight: number
  /** The minimum side padding, before centring is considered. */
  basePadding: number
  /** The most columns THIS screen draws. A screen that never splits passes 1. */
  maxColumns: 1 | 2
}

export type LayoutResult = {
  width: number
  height: number
  landscape: boolean
  /**
   * Vertical space is tight — in practice, a phone held sideways.
   *
   * Measured on a 411dp-tall landscape phone: the status bar, the page header
   * and the tab bar together took ~165dp, leaving 60% of the screen for the
   * thing the person opened the app to read. The header is the only part of
   * that the app controls, so `Screen` draws a shorter one when this is set —
   * smaller title, no subtitle, tighter padding.
   *
   * Keyed off HEIGHT, not `landscape`. A tablet on its side is landscape and has
   * 800dp to spend; compacting there would solve a problem it does not have.
   */
  short: boolean
  /** How many columns to actually draw: what was asked for, if it fits. */
  columns: 1 | 2
  /** Horizontal padding: safe area, then centring, whichever is larger. */
  gutter: number
}

export function layoutFor(input: LayoutInput): LayoutResult {
  const { width, height, insetLeft, insetRight, basePadding, maxColumns } = input

  const landscape = width > height
  // What the screen asked for, but only if the device is wide enough for it.
  const columns: 1 | 2 = maxColumns === 2 && width >= TWO_COLUMN ? 2 : 1

  /*
   * The larger inset is used on BOTH sides. The notch is on one side only, so
   * matching the hardware exactly would pad a row unevenly — more distracting
   * than the few points it saves.
   */
  const safe = basePadding + Math.max(insetLeft, insetRight)
  const centring = (width - MAX_WIDTH[columns]) / 2

  return {
    width,
    height,
    landscape,
    short: height < SHORT_VIEWPORT,
    columns,
    gutter: Math.max(safe, centring),
  }
}
