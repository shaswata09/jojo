import { Children, useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/use-media-query'

/**
 * Scroll-snap carousel.
 *
 * Built on native overflow scrolling rather than transform maths, so touch
 * swipe, momentum and trackpad gestures all work without handling them —
 * the buttons and dots just drive `scrollTo`.
 *
 * No autoplay by design: these are decisions the user needs to read, and
 * content that moves on its own fails WCAG 2.2.2 unless you add pause
 * controls nobody uses.
 */
export function Carousel({
  label,
  className,
  children,
}: {
  /** Accessible name for the whole carousel region. */
  label: string
  className?: string
  children: ReactNode
}) {
  const slides = Children.toArray(children)
  const trackRef = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  const goTo = useCallback(
    (next: number) => {
      const track = trackRef.current
      if (!track) return
      const clamped = Math.max(0, Math.min(next, slides.length - 1))
      track.scrollTo({
        left: clamped * track.clientWidth,
        behavior: reduceMotion ? 'auto' : 'smooth',
      })
    },
    [slides.length, reduceMotion],
  )

  // Derive the active slide from scroll position, so swipe and buttons stay
  // in agreement without tracking gestures separately.
  const onScroll = () => {
    const track = trackRef.current
    if (!track || track.clientWidth === 0) return
    setIndex(Math.round(track.scrollLeft / track.clientWidth))
  }

  if (slides.length === 0) return null

  return (
    <section
      aria-roledescription="carousel"
      aria-label={label}
      className={cn('flex flex-col', className)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          goTo(index + 1)
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          goTo(index - 1)
        }
      }}
    >
      <div
        ref={trackRef}
        onScroll={onScroll}
        tabIndex={0}
        aria-live="polite"
        className={cn(
          'flex flex-1 snap-x snap-mandatory items-stretch overflow-x-auto overscroll-x-contain',
          '[scrollbar-width:none] rounded-lg [&::-webkit-scrollbar]:hidden',
        )}
      >
        {slides.map((slide, i) => (
          <div
            key={i}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${slides.length}`}
            className="w-full shrink-0 snap-start"
          >
            {slide}
          </div>
        ))}
      </div>

      {slides.length > 1 ? (
        <div className="mt-3 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            aria-label="Previous"
            className="grid size-7 place-items-center rounded-full border border-hairline bg-well text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1 disabled:opacity-35 disabled:hover:border-hairline"
          >
            <ChevronLeft className="size-4" strokeWidth={1.8} />
          </button>

          <div className="flex items-center gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Go to ${i + 1} of ${slides.length}`}
                aria-current={i === index}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-200',
                  i === index ? 'w-5 bg-accent' : 'w-1.5 bg-hairline-strong hover:bg-text-3',
                )}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => goTo(index + 1)}
            disabled={index === slides.length - 1}
            aria-label="Next"
            className="grid size-7 place-items-center rounded-full border border-hairline bg-well text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1 disabled:opacity-35 disabled:hover:border-hairline"
          >
            <ChevronRight className="size-4" strokeWidth={1.8} />
          </button>
        </div>
      ) : null}
    </section>
  )
}
