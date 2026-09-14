/**
 * How wide the record sheet is, and what a drag on its edge means.
 *
 * The sheet was a fixed 520px. That is a good width for reading a note and a
 * poor one for a tailored CV beside the posting it was written for, so the edge
 * is now draggable — and 520 stays the floor, because it is the width every
 * panel inside it was laid out against.
 *
 * Pure, and separate from the component, because all of it is arithmetic with
 * an off-by-one at each end: the sheet is anchored to the RIGHT, so dragging
 * left makes it wider, and a clamp that reads the wrong way round produces a
 * panel that fights the pointer instead of following it.
 */

/** The width it has always opened at, and the narrowest it will go. */
export const MIN_SHEET_WIDTH = 520

/**
 * The widest it will go, whatever the screen.
 *
 * Not "as wide as you like". The board or table it covers is the thing you came
 * from, and a sheet that can eat the last of it turns a drag into a navigation
 * with no way back but Escape. 1100 is about where a two-column record stops
 * gaining from more room.
 */
export const MAX_SHEET_WIDTH = 1100

/**
 * Room left for the page behind it — the `calc(100vw - 3rem)` the sheet carries
 * in CSS, kept as a number so the clamp and the stylesheet cannot disagree.
 *
 * No longer what decides the maximum; see `MAX_SHARE`. Still exported because
 * the stylesheet's cap is the safety net between a window resize and the effect
 * that answers it.
 */
export const VIEWPORT_GUTTER = 48

/**
 * The most of the window the sheet may ever take.
 *
 * A share rather than `viewport - 48`, and the reason is the sidebar. It is
 * `position: sticky`, 232px wide, and `z-50` — one layer ABOVE the sheet — so a
 * sheet allowed to grow to `viewport - 48` slides underneath it. Measured in a
 * 1150px window: the sheet's left edge landed at 50px, the sidebar's right edge
 * is 252px, and `elementFromPoint` over the grip returned the sidebar. The
 * handle was not merely hard to hit, it was unreachable, and the left 200px of
 * the record was behind the navigation.
 *
 * Three tenths of the window is always more than the sidebar needs: it only
 * appears at Tailwind's `lg` (1024px), where 30% is 307px against its 252px
 * footprint, and the gap only widens from there. So this holds without this
 * module having to know the sidebar's measurements — which is the point, since
 * it cannot be told when they change.
 */
export const MAX_SHARE = 0.7

/** The widest this particular screen allows, which may be less than the max. */
export function maxWidthFor(viewport: number): number {
  // Never below the minimum: on a narrow screen the sheet is already capped by
  // its own `max-w`, and returning something smaller here would make every
  // clamp below snap it to a width the CSS then overrides anyway.
  if (!Number.isFinite(viewport)) return MIN_SHEET_WIDTH
  return Math.max(MIN_SHEET_WIDTH, Math.min(MAX_SHEET_WIDTH, Math.floor(viewport * MAX_SHARE)))
}

/** A width forced inside what this screen allows. */
export function clampSheetWidth(width: number, viewport: number): number {
  if (!Number.isFinite(width)) return MIN_SHEET_WIDTH
  return Math.round(Math.min(maxWidthFor(viewport), Math.max(MIN_SHEET_WIDTH, width)))
}

/**
 * The width implied by the pointer sitting at `clientX`.
 *
 * The sheet's left edge IS the pointer, so the width is everything from there
 * to the right of the window. Subtraction, not addition — the direction is the
 * thing this function exists to get right once.
 */
export function widthFromPointer(clientX: number, viewport: number): number {
  return clampSheetWidth(viewport - clientX, viewport)
}

/** One arrow press. Shift for a coarse step, the convention every slider uses. */
export const STEP = 16
export const COARSE_STEP = 64

/**
 * A keyboard nudge. `direction` is -1 for ArrowLeft, which WIDENS the sheet.
 *
 * Left-widens because the handle is on the left edge and moves with the edge —
 * the key moves the thing under the cursor, not the number. Getting this
 * backwards is the single most likely mistake here, so it is stated in the
 * signature and pinned by a test.
 */
export function nudgeWidth(
  width: number,
  direction: -1 | 1,
  viewport: number,
  coarse = false,
): number {
  return clampSheetWidth(width - direction * (coarse ? COARSE_STEP : STEP), viewport)
}

/** Whether dragging is worth offering at all on this screen. */
export const canResizeAt = (viewport: number): boolean => maxWidthFor(viewport) > MIN_SHEET_WIDTH

export const SHEET_WIDTH_KEY = 'jojo/detail-sheet-width/v1'

/**
 * A stored width, or null when there is nothing usable.
 *
 * Anything unparseable is treated as absent rather than repaired: a stored
 * width is a convenience, and a browser that returns nonsense for it should
 * cost the person their preference, not their layout.
 */
export function parseStoredWidth(raw: string | null): number | null {
  if (raw === null) return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return null
  // Not clamped here — the viewport at read time is the caller's business, and
  // a width stored on a wide monitor is still the right preference to restore
  // when that monitor comes back.
  return Math.round(value)
}
