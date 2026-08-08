import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { DESKTOP_QUERY, useMediaQuery } from '@/lib/use-media-query'

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false)
  const navButtonRef = useRef<HTMLButtonElement>(null)
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const { pathname } = useLocation()

  /** Closes and returns focus to the trigger — for Escape, backdrop and the X. */
  const closeNav = useCallback(() => {
    setNavOpen(false)
    navButtonRef.current?.focus()
  }, [])

  // Navigating away should dismiss the drawer, but focus belongs with the new
  // page rather than back on the hamburger.
  useEffect(() => setNavOpen(false), [pathname])

  // Escape to dismiss, and lock background scroll while the drawer covers it.
  useEffect(() => {
    if (!navOpen || isDesktop) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeNav()
    }
    document.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [navOpen, isDesktop, closeNav])

  return (
    <>
      {/* Backdrop: mobile only, and only while open. */}
      {navOpen && !isDesktop ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={closeNav}
          className="fixed inset-0 z-40 cursor-default bg-black/40 backdrop-blur-[2px] lg:hidden"
        />
      ) : null}

      {/* Scroll-edge scrim.
          The topbar floats at top-3/top-5, so content scrolling past it was
          reappearing in the sliver ABOVE it. This covers that sliver in solid
          page colour, then fades out just below the topbar's lower edge — so
          content dissolves as it slides under rather than cutting off against
          a hard line. Sits under the topbar (z-30) and the sidebar (z-50),
          over page content. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-20 h-20 sm:h-24"
        style={{
          background:
            'linear-gradient(to bottom, var(--page) 0%, var(--page) 74%, transparent 100%)',
        }}
      />

      {/* No z-index here on purpose. `z-[1]` made this a stacking context, which
          trapped the topbar (z-30) and sidebar (z-50) inside a layer sitting at
          z-1 — so the scrim at z-20 painted over both. Leaving it at `auto` lets
          those two participate in the root context and sit above the scrim. */}
      <div className="relative mx-auto flex min-h-dvh max-w-[1440px] flex-col gap-4 p-3 sm:gap-5 sm:p-5 lg:flex-row">
        <Sidebar open={navOpen} onClose={closeNav} />

        <div className="flex min-w-0 flex-1 flex-col gap-4 sm:gap-5">
          <Topbar onOpenNav={() => setNavOpen(true)} navButtonRef={navButtonRef} />
          {/* flex-1 + min-h-0 so a page can hand a child the remaining
              viewport height (the kanban board does). Panels are unaffected:
              a column flex container stretches children across, not down. */}
          <main className="flex min-h-0 flex-1 flex-col gap-4 sm:gap-5">
            <Outlet />
          </main>
        </div>
      </div>
    </>
  )
}
