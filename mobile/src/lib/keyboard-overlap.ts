/**
 * How far a view's bottom edge reaches below the keyboard's top edge, in dp.
 *
 * Both arguments in window coordinates: the view as `measureInWindow` reports
 * it, the keyboard as its event's `endCoordinates.screenY`. Zero when the view
 * ends above the keyboard; whole numbers, so a sub-pixel wobble in either
 * measurement cannot re-render the padding on every layout.
 */
export function keyboardOverlap(viewY: number, viewHeight: number, keyboardTop: number): number {
  if (![viewY, viewHeight, keyboardTop].every(Number.isFinite)) return 0
  return Math.max(0, Math.round(viewY + viewHeight - keyboardTop))
}
