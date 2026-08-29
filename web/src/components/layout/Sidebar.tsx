import { BrandCard } from '@/components/brand/BrandCard'
import { SidebarNav } from '@/components/layout/SidebarNav'
import { SidebarRuntime } from '@/components/layout/SidebarRuntime'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { DESKTOP_QUERY, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'

/**
 * Permanent column at `lg` and above; an off-canvas drawer below it.
 *
 * The drawer is a real modal dialog on small screens — focus moves into it on
 * open and the page behind is inert — but must NOT claim those semantics on
 * desktop, where it is just a navigation landmark. Hence the media query.
 */
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const closeRef = useRef<HTMLButtonElement>(null)
  const asideRef = useRef<HTMLElement>(null)

  /**
   * The drawer is off-screen: not on the page as far as anyone can tell.
   *
   * One predicate, because the three things below have to agree. They did not:
   * `aria-hidden` was on the <aside> while `tabIndex={-1}` was passed only to
   * the nav and the runtime strip, and a scan of what the <aside> actually
   * renders found three controls it never reached — the close button here, and
   * the theme toggle and "Poke jojo" inside `BrandCard`. All three sat in a
   * subtree declared hidden and all three took Tab, which lands focus on a
   * control that is translated a screen-width to the left: the ring is
   * invisible, Enter fires something the user cannot see, and a screen reader
   * says nothing because the element it is on is `aria-hidden`.
   */
  const offCanvas = !isDesktop && !open

  // Kept, and now a second line of defence rather than the only one: the nav
  // links and the runtime tiles take it themselves.
  const tabIndex = offCanvas ? -1 : undefined

  // aria-modal was a promise the drawer couldn't keep: Tab walked focus behind
  // the opaque backdrop, where nothing focused was visible.
  useFocusTrap(asideRef, open && !isDesktop)

  useEffect(() => {
    if (open && !isDesktop) closeRef.current?.focus()
  }, [open, isDesktop])

  return (
    <aside
      ref={asideRef}
      // Hidden from assistive tech when closed on mobile, so its links are not
      // reachable by screen reader while off-screen.
      aria-hidden={offCanvas}
      /*
       * `inert` is what makes that true of the KEYBOARD as well, and it is on
       * the container on purpose: per-child `tabIndex` has to be remembered by
       * whoever adds the next button, and three existing ones proved it is not.
       * The browser takes focus, clicks and find-in-page out of the whole
       * subtree in one attribute. It shipped in Chrome 102, Safari 15.5 and
       * Firefox 112; anywhere older the `tabIndex` above is what is left, which
       * is why that was kept rather than replaced.
       *
       * It comes off in the same render that puts the drawer back on screen, so
       * it can never outlive the transform, and React writes DOM attributes
       * before it runs effects — so the attribute is gone by the time the
       * effect above moves focus to the close button.
       */
      {...(offCanvas ? { inert: true } : {})}
      {...(!isDesktop ? { role: 'dialog', 'aria-modal': open, 'aria-label': 'Navigation' } : {})}
      className={cn(
        'surface z-50 flex w-[min(17rem,85vw)] flex-col gap-1.5 rounded-lg px-3.5 py-5',
        // Mobile: floating off-canvas drawer. Longhand insets rather than
        // `inset-y-*`, so the lg: overrides below don't depend on Tailwind's
        // shorthand-vs-longhand ordering.
        'fixed top-3 bottom-3 left-3 overflow-y-auto transition-transform duration-200 ease-out',
        open ? 'translate-x-0' : '-translate-x-[calc(100%+1rem)]',
        // Desktop: permanent sticky column.
        'lg:sticky lg:top-5 lg:bottom-auto lg:left-auto lg:h-[calc(100dvh-2.5rem)] lg:w-[232px]',
        'lg:shrink-0 lg:translate-x-0 lg:transition-none',
        'motion-reduce:transition-none',
      )}
    >
      <BrandCard
        className="mb-2 shrink-0"
        action={
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="grid size-8 place-items-center rounded-full border border-white/20 bg-black/25 text-white/80 backdrop-blur-sm hover:text-white lg:hidden"
          >
            <X className="size-4" strokeWidth={1.7} />
          </button>
        }
      />

      <SidebarNav tabIndex={tabIndex} />

      {/* The gesture bench that used to sit here — a <select> labelled "temp" in
          red — is gone. It was a tuning tool, and the same list is reachable for
          real in Settings → Appearance, beside the mascot it drives. `mt-auto`
          moved onto the runtime block, which is what should be pinned to the
          foot of the column. */}
      <SidebarRuntime tabIndex={tabIndex} />
    </aside>
  )
}
