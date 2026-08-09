import { useEffect, useRef } from 'react'
import { useReducedMotion } from '@/lib/use-media-query'

/**
 * How long a row stays lit after a link points at it.
 *
 * Mirrored by the `.arrival-highlight` keyframes in index.css — the tint fades
 * out over this window so the class is already invisible by the time the URL
 * drops the parameter and React removes it. Change one and change the other,
 * or the highlight will snap off a beat early.
 */
export const ARRIVAL_HIGHLIGHT_MS = 2600

/**
 * Lets a `?focus=` deep link fade out instead of burning in.
 *
 * The highlight answers one question — "which row did that link mean?" — and it
 * has answered it within a second or two of arrival. It used to stay lit for
 * the life of the tab, which turned a momentary orientation cue into a
 * permanent selected-looking state on a row nobody had selected; worse, the
 * parameter travelled with every copied URL and into every Back entry, so
 * returning to the Vault an hour later relit a reminder you had long since
 * dealt with.
 *
 * Clearing the parameter is the actual un-highlight — the render reads `focus`
 * straight from the URL — so this owns the timer and nothing else.
 */
export function useArrivalHighlight(focus: string | undefined, clear: () => void) {
  // Held in a ref so a call site can pass an inline arrow without restarting
  // the timer on every render — which would mean the highlight never expired.
  const latest = useRef(clear)
  useEffect(() => {
    latest.current = clear
  })

  useEffect(() => {
    if (!focus) return
    const timer = window.setTimeout(() => latest.current(), ARRIVAL_HIGHLIGHT_MS)
    return () => window.clearTimeout(timer)
  }, [focus])
}

/**
 * Puts the row a `?focus=` link named on screen.
 *
 * A highlight below the fold answers nothing. The vault lists were assumed to
 * be short enough that arriving at the top was arriving at the record — but ten
 * reminders across four groups put the completed ones ~900px down a 900px
 * viewport, so a reminder chosen in ⌘K lit up somewhere the user never saw and
 * had faded by the time they scrolled to it. The tint has to be visible for the
 * 2.6s it lives, which means bringing it into view first.
 *
 * Attach the returned ref to whichever row is focused and nothing else; a spare
 * ref left on every row would scroll to the last one rendered. Centred rather
 * than `nearest` because these lists have sticky group headings that would
 * otherwise sit on top of the row this exists to reveal.
 */
export function useArrivalScroll<T extends HTMLElement = HTMLElement>(focus: string | undefined) {
  const reduced = useReducedMotion()
  const row = useRef<T | null>(null)

  useEffect(() => {
    if (!focus) return
    row.current?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  }, [focus, reduced])

  return row
}
