import { useCallback, useEffect, useState } from 'react'

/** Never collapse past this, however little room is left. */
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
export function useFillViewport(bottomGap = 20) {
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
      setMaxHeight(Math.max(MIN_HEIGHT, window.innerHeight - top - bottomGap))
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
  }, [node, bottomGap])

  return { ref, maxHeight }
}
