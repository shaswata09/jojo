import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

/** Quantised, so a one-pixel reflow does not lay the whole picture out again. */
const STEP = 10

/**
 * The drawn box's size in CSS pixels, for the overview and the focus view.
 *
 * Unlike the free layout — which solves in a fixed 620-unit-high space and lets
 * the SVG scale — these two lay out in the box's own pixels, so a 12px label is
 * 12px on a phone too instead of shrinking with the picture.
 */
export function useBoxSize(
  ref: RefObject<HTMLElement | null>,
  fallback: { width: number; height: number },
) {
  const [size, setSize] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width < 1 || height < 1) return
      const next = {
        width: Math.max(200, Math.round(width / STEP) * STEP),
        height: Math.max(200, Math.round(height / STEP) * STEP),
      }
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      )
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}
