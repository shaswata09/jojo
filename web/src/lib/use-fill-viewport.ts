import { useCallback, useEffect, useState } from 'react'

/**
 * The least room worth capping into.
 *
 * NOT a floor to clamp to — a threshold to give up at, and the difference is
 * the whole behaviour. Clamping was what this did, and on a 390px-wide screen
 * the Assistant's panel was clamped to 220px while its thread bar and composer
 * wanted all 220 between them: the transcript came out ZERO pixels tall, a chat
 * with no chat in it, and the page scrolled anyway because the clamp had
 * stopped tracking the viewport.
 *
 * So below this, it does not cap at all. A panel that cannot fit the space left
 * should take its natural height and let the page scroll, which is the ordinary
 * reading behaviour and is honest: the content genuinely does not fit. Capping
 * to the viewport is the better answer only where there is a viewport's worth
 * of room to cap into.
 */
const MIN_HEIGHT = 220

/**
 * Caps an element at the height left below it on screen.
 *
 * The app shell is `min-h-dvh` — a *minimum*, not a definite height — so a
 * `flex-1 min-h-0` child fills the space when content is short but cannot cap
 * itself when content is tall: the flex chain has nothing definite to resolve
 * against and the panel simply grows, scrolling the page instead of itself.
 *
 * The obvious fix, `max-h-[calc(100dvh-15rem)]`, hardcodes everything above the
 * element — page padding, topbar, gaps, page header — and is wrong the moment
 * the header wraps to two lines, which is exactly what happens on the narrow
 * screens where the cap matters most. Measuring the element's own offset costs
 * one layout read per resize and cannot drift.
 */
/**
 * @param minHeight below this much free space, do not cap — see `MIN_HEIGHT`.
 *   A panel with chrome of its own (a toolbar above the scroller, a composer
 *   below it) should pass the height at which its SCROLLER stops being usable,
 *   not the height at which the panel does.
 */
export function useFillViewport(bottomGap = 20, minHeight = MIN_HEIGHT) {
  const [maxHeight, setMaxHeight] = useState<number>()

  const [node, setNode] = useState<HTMLElement | null>(null)
  const ref = useCallback((el: HTMLElement | null) => setNode(el), [])

  useEffect(() => {
    if (!node) return

    const measure = () => {
      // Offset from the top of the document, so a scrolled page still measures
      // the same distance. Once the cap applies the page stops scrolling, and
      // the reading settles.
      const top = node.getBoundingClientRect().top + window.scrollY
      const room = window.innerHeight - top - bottomGap
      // `undefined` removes the cap rather than shrinking it to nothing.
      setMaxHeight(room >= minHeight ? room : undefined)
    }

    measure()
    window.addEventListener('resize', measure)

    // Anything above the element changing height — the header wrapping, a
    // filter row appearing — moves it without firing a resize.
    const observer = new ResizeObserver(measure)
    observer.observe(document.body)

    return () => {
      window.removeEventListener('resize', measure)
      observer.disconnect()
    }
  }, [node, bottomGap, minHeight])

  return { ref, maxHeight }
}
