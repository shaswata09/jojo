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
 *
 * The timer checks the address bar before it clears. Leaving a page does not
 * always unmount it at once: the router renders the next route in a
 * transition, and a lazy route keeps the old one on screen until its chunk
 * arrives. A timer firing in that gap cleared `focus` through the OLD page's
 * `setSearchParams`, which resolves against the old route — so picking a
 * Calendar result in ⌘K within 2.6 s of arriving at a highlighted reminder
 * navigated straight back to the Vault. The address bar has already moved by
 * then; that is the check.
 */
export function useArrivalHighlight(
  focus: string | undefined,
  clear: () => void,
  /** Restarts the timer for a second arrival at the same `focus` — see `useFocusParam`. */
  arrival?: string,
) {
  // Held in a ref so a call site can pass an inline arrow without restarting
  // the timer on every render — which would mean the highlight never expired.
  const latest = useRef(clear)
  useEffect(() => {
    latest.current = clear
  })

  useEffect(() => {
    if (!focus) return
    const armedOn = window.location.pathname
    const timer = window.setTimeout(() => {
      // A page being left must not clear its own focus (see above).
      if (window.location.pathname === armedOn) latest.current()
    }, ARRIVAL_HIGHLIGHT_MS)
    return () => window.clearTimeout(timer)
  }, [focus, arrival])
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

/**
 * How long a `focus` that names nothing on the page waits before it settles for
 * its fallback — the panel a conditional field lives in.
 *
 * A field can be absent for a reason the link could not know: the API key row
 * only exists for a provider that takes a key, the bridge's steps only once it
 * is switched on. Landing on the panel that would hold it is the next best
 * answer; landing nowhere is not one. The wait is what keeps a row that is
 * merely LATE (a panel finishing its first read) from losing to its panel.
 */
export const ARRIVAL_FALLBACK_MS = 600

/** The longest a `focus` is looked for. A lazy route's chunk is the slow case. */
export const ARRIVAL_WAIT_MS = 4000

/** The CSS selector for a `data-focus-id`, quoted so any id is a safe one. */
export function focusSelector(id: string): string {
  return `[data-focus-id="${id.replace(/["\\]/g, '\\$&')}"]`
}

/**
 * Which element an arrival lands on, given how long it has looked.
 *
 * The pure half of `useFocusArrival`: the exact element whenever it exists,
 * the fallback only once `ARRIVAL_FALLBACK_MS` has passed without it, and
 * nothing at all otherwise — which tells the caller to look again next frame.
 */
export function arrivalTarget<T>(
  find: (id: string) => T | null,
  id: string,
  fallback: string | undefined,
  waited: number,
): T | null {
  const exact = find(id)
  if (exact) return exact
  if (fallback && fallback !== id && waited >= ARRIVAL_FALLBACK_MS) return find(fallback)
  return null
}

const byFocusId = (id: string) => document.querySelector<HTMLElement>(focusSelector(id))
const noFallback = () => undefined

/**
 * Scrolls to whatever `?focus=` names and lights it — by `data-focus-id`, so a
 * page needs no ref per row.
 *
 * For the pages whose rows are many and drawn by many components — Settings,
 * Profile, Statistics, the scout's panels — where threading a ref to each
 * would be a prop through every panel for a cue that lasts 2.6 seconds. The
 * element is looked for each frame until it exists (a panel can render after
 * the page, and a lazy route after the link), then centred like
 * `useArrivalScroll` does and given the same `arrival-highlight` class the
 * Vault's rows wear. The class is taken off again on the same beat the
 * parameter is cleared (`useArrivalHighlight`, which the page still owns).
 *
 * `find` and `fallbackOf` must be stable — module functions, not inline
 * arrows — or every render restarts the search.
 */
export function useFocusArrival(
  focus: string | undefined,
  {
    fallbackOf = noFallback,
    find = byFocusId,
    arrival,
  }: {
    fallbackOf?: (id: string) => string | undefined
    find?: (id: string) => HTMLElement | null
    /** The navigation that brought `focus`, so picking the same place twice lights it twice. */
    arrival?: string
  } = {},
) {
  const reduced = useReducedMotion()

  useEffect(() => {
    if (!focus) return
    const started = performance.now()
    let frame = 0
    let fade = 0
    let lit: HTMLElement | null = null

    const look = () => {
      const waited = performance.now() - started
      const element = arrivalTarget(find, focus, fallbackOf(focus), waited)
      if (element) {
        element.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
        element.classList.add('arrival-highlight')
        lit = element
        fade = window.setTimeout(() => {
          element.classList.remove('arrival-highlight')
        }, ARRIVAL_HIGHLIGHT_MS)
        return
      }
      if (waited < ARRIVAL_WAIT_MS) frame = requestAnimationFrame(look)
    }
    frame = requestAnimationFrame(look)

    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(fade)
      lit?.classList.remove('arrival-highlight')
    }
  }, [focus, find, fallbackOf, reduced, arrival])
}
