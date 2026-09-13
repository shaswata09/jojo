import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { Onboarding } from '@/components/common/Onboarding'
import { RouteFailure } from '@/components/common/RouteFailure'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { StorageBanner } from '@/components/layout/StorageBanner'
import { ProfileUpdateOffer } from '@/components/profile/ProfileUpdateOffer'
import { DESKTOP_QUERY, useMediaQuery } from '@/lib/use-media-query'
import { isSamePage, pageKey } from '@/lib/links'
import { report } from '@/lib/analytics'
import { screenForPath } from '@jojo/service/core/analytics'

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false)
  const navButtonRef = useRef<HTMLButtonElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const { pathname } = useLocation()
  /** First render is a page load, where the browser already owns focus. */
  const landed = useRef(false)
  /**
   * The path the last render was on, for the scroll below — `null` until there
   * has been one. A path, not a flag, because the reset now turns on WHICH page
   * was left rather than only on whether any was; and the whole path rather
   * than its page, so that "nothing navigated" stays distinguishable from "the
   * record closed".
   */
  const lastPath = useRef<string | null>(null)

  /** Closes and returns focus to the trigger — for Escape, backdrop and the X. */
  const closeNav = useCallback(() => {
    setNavOpen(false)
    navButtonRef.current?.focus()
  }, [])

  // Navigating away should dismiss the drawer, but focus belongs with the new
  // page rather than back on the hamburger.
  useEffect(() => setNavOpen(false), [pathname])

  /*
   * Screen views, from the one component every route renders inside.
   *
   * `screenForPath` rather than `pathname`, and that is the whole safety story:
   * this app's URLs contain application ids and employer names, so reporting the
   * path would put records into an analytics console while looking exactly like
   * ordinary page tracking. See `core/analytics.ts`.
   *
   * `report` itself is a no-op unless the build allows analytics and the user
   * said yes, so with the default build this effect costs one function call per
   * navigation and sends nothing.
   */
  useEffect(() => {
    const screen = screenForPath(pathname)
    if (screen) report('screen_viewed', { screen })
  }, [pathname])

  /**
   * Move focus to the new page on navigation.
   *
   * A client-side route change swaps the content without moving focus, so a
   * keyboard user who activates a nav link is left with focus back in the
   * sidebar and has to tab through the whole shell again — eighteen stops
   * before the first thing on the page — while a screen reader announces
   * nothing at all, because as far as it is concerned nothing happened.
   *
   * Skipped on the first render: that is a page load, where the browser has
   * already put focus in the right place, and stealing it would scroll a
   * deep-linked record out of view the moment it arrived.
   */
  useEffect(() => {
    if (!landed.current) {
      landed.current = true
      return
    }
    // preventScroll because the page has just been put where it belongs by the
    // layout effect below, or by whichever row asked to be brought into view.
    // Focusing an element the browser thinks is off-screen scrolls it, and this
    // one is the whole page — so without it, focus is a third opinion about the
    // scroll position, arriving last and winning.
    mainRef.current?.focus({ preventScroll: true })
  }, [pathname])

  /**
   * Open every page at the top of itself.
   *
   * There is no scroll restoration in this app — no `ScrollRestoration`, no
   * reset anywhere — so a client-side navigation left the document at whatever
   * offset the previous page had been scrolled to. Read Statistics down to the
   * role table, click Applications, and the new page opened 442px in: its title
   * had already gone past the top of the window, and the first thing under the
   * topbar was the middle of a list. On a page only slightly taller than the
   * last one the offset is small, which is the version that reads as "the title
   * is hidden behind the navbar" rather than as a scroll position.
   *
   * A `useLayoutEffect`, and that is the whole reason this works. Two places
   * scroll something specific into view on arrival — `useArrivalScroll` for a
   * `?focus=` row and Applications' open record — and both do it in a passive
   * `useEffect`. Effects run child-before-parent, so a passive reset here would
   * land after theirs and undo them. Every layout effect in a commit runs before
   * every passive effect, so this one goes first and the targeted scroll still
   * wins.
   *
   * Skipped on the first render, for the same reason the focus above is: that
   * is a page load, where the browser restores its own scroll position on a
   * reload and a deep link has not asked for the top of anything.
   *
   * Skipped again when the PAGE has not changed, which is the part the pathname
   * could not tell us. Opening an application is a navigation —
   * '/applications' to '/applications/rice' — and closing it is the way back,
   * so both fired this, and a board read down to its last card was put back at
   * the top by the act of looking at one. `pageKey` is the rule; the boundary
   * below is keyed on the same one, and for the same reason.
   *
   * Nothing here touches scrolling itself — content still slides under the
   * topbar and dissolves into the scrim exactly as before.
   */
  useLayoutEffect(() => {
    const from = lastPath.current
    lastPath.current = pathname
    // The first render is a page load, per the paragraph above.
    if (from === null) return
    /*
     * Nothing navigated. `isDesktop` is in the dependency array below because
     * the decision reads it, so dragging a window across `lg` re-runs this —
     * and a resize is not an arrival at anything.
     */
    if (from === pathname) return
    /*
     * Opening a record over the list, or closing it: the page did not change,
     * and the position in it is the user's. See `pageKey`.
     *
     * `isDesktop` is the other half of that, and leaving it out would be a
     * regression rather than a missed nicety. Below `lg` the record does not
     * sit OVER the list — it replaces it, which is what `inlineDetail` in
     * Applications.tsx does — so the two paths that mean "a panel opened" on a
     * laptop mean "a different screen" on a phone. Without this, tapping a card
     * from halfway down a long list opened the record halfway down itself.
     */
    if (isDesktop && isSamePage(from, pathname)) return
    window.scrollTo(0, 0)
  }, [pathname, isDesktop])

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
      {/* Off-screen until focused, which is the whole point: it is the first
          tab stop in the document, and without it reaching page content from
          the address bar costs eighteen presses through the sidebar, topbar
          and utility icons on every single navigation. */}
      <a
        href="#main"
        onClick={(event) => {
          // The href is a real fragment so it survives with JS disabled, but
          // letting it navigate would push a history entry whose only content
          // is a hash — Back would then appear to do nothing.
          event.preventDefault()
          mainRef.current?.focus()
        }}
        className="sr-only rounded-md bg-panel px-3 py-2 text-sm text-text-1 shadow-[var(--shadow-raised)] ring-1 ring-hairline-strong focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60]"
      >
        Skip to main content
      </a>

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
          {/* Above the route rather than inside it, and above <main> rather than
              in it: "nothing you change is being saved" belongs to the app, not
              to whichever page happened to be open when saving stopped, and a
              banner rendered per route would have unmounted and re-announced
              itself on every navigation. It renders nothing at all in the
              healthy case, which is almost always. */}
          <StorageBanner />
          {/* Beside the storage banner and for the same reason: it has to be
              askable from wherever the person happened to file the document,
              and it must not be a modal — filing usually happens from inside
              another form, and the dialog host replaces rather than stacks.
              Renders nothing when there is nothing newly readable, which is
              almost always. */}
          <ProfileUpdateOffer />
          {/* flex-1 + min-h-0 so a page can hand a child the remaining
              viewport height (the kanban board does). Panels are unaffected:
              a column flex container stretches children across, not down. */}
          {/* tabIndex -1 so it can receive programmatic focus on navigation
              without becoming a tab stop of its own; outline-none because that
              focus is a scroll-and-announce, not something to draw a ring
              around — the ring belongs on controls the user aimed at. */}
          <main
            ref={mainRef}
            id="main"
            tabIndex={-1}
            className="flex min-h-0 flex-1 flex-col gap-4 outline-none sm:gap-5"
          >
            {/*
             * A boundary per ROUTE, inside the shell.
             *
             * The only other boundary is at the root, above the router — so any
             * render throw in any view replaced the whole app, navigation and
             * all, with a full-page error screen. Its "Try again" re-rendered
             * the same route, so a deterministic failure (one malformed record,
             * a NaN reaching a chart) trapped the user with nothing to press
             * and no way out but editing the URL.
             *
             * A key is what makes recovery real: React discards a boundary's
             * error state when its key changes, so navigating somewhere else
             * clears it. The sidebar stays up, which means there is somewhere
             * else to navigate TO.
             *
             * `pageKey(pathname)` rather than `pathname`, because React
             * discards the whole SUBTREE on a key change, not just the error —
             * and '/applications/rice' is not a different page from
             * '/applications', it is the same board with a record open over it.
             * Keyed on the raw path, opening a card rebuilt the board: six new
             * column scrollers, every one of them at the top, which is what was
             * reported as the board jumping back when a record was closed. It
             * had jumped on open, behind the sheet. What recovery loses is a
             * throw clearing itself when a record closes, which `RouteFailure`
             * never offered — it says go somewhere else and come back, and that
             * is a page change.
             */}
            <ErrorBoundary key={pageKey(pathname)} fallback={<RouteFailure />}>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      </div>

      {/* Inside the router on purpose. It links to the guide and to Profile,
          and a dialog mounted above the router can only reach them with a bare
          `<a href>` — which skips `basename` and 404s wherever the app is
          served from a subpath, and reloads the document, which kills any agent
          run still working. It renders nothing until there is something to ask. */}
      <Onboarding />
    </>
  )
}
