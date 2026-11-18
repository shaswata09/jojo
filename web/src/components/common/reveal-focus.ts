import type { FocusEvent } from 'react'

/**
 * Scroll a keyboard-focused control fully into view inside a horizontal
 * scroller — an `onFocus` handler for the scroller (React's onFocus bubbles,
 * so it is the `focusin` of everything inside).
 *
 * Chrome's own focus scroll leaves a scroller alone when the target is even
 * partly visible. At 360px the board's second column was focused card by card
 * with `scrollLeft` still 0, its title links 19-23% visible, and the
 * dashboard deck's second card took focus at x=313 with the track unmoved
 * (finding a11y-5).
 *
 * `within`, when given, is the selector of the ancestor to reveal instead of
 * the control — the deck passes `li` so a whole card snaps in, not a sliver
 * of it the snap would then fight. Only for keyboard focus (`:focus-visible`):
 * a click or the start of a drag must not move what the pointer is on.
 */
export function revealFocused(within?: string) {
  return (event: FocusEvent<HTMLElement>) => {
    const target = event.target
    if (!(target instanceof Element) || !target.matches(':focus-visible')) return
    const box = (within ? target.closest(within) : null) ?? target
    box.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }
}
