import { Suspense, lazy, useCallback, useEffect, useRef } from 'react'
import type { ComponentType } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { Loader } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel } from '@/components/common/Panel'
import { AppShell } from '@/components/layout/AppShell'
import { useDialogs } from '@/lib/dialogs-context'
import { applicationsPath, useTitle } from '@/lib/links'
import { ApplicationDetail } from '@/routes/ApplicationDetail'
import { Applications } from '@/routes/Applications'
import { Organisation } from '@/routes/Organisation'
import { Dashboard } from '@/routes/Dashboard'
import { Guide } from '@/routes/Guide'
import { Placeholder } from '@/routes/Placeholder'

/**
 * The two heavy routes, split out of the main bundle.
 *
 * Transfer reaches `three/webgpu` and a TSL node graph — megabytes of it, for a
 * screen most sessions never open — and Graph carries its own layout solver and
 * query builder. Static imports would put both in the chunk the dashboard waits
 * on. `lazy()` here rather than inside the routes because this is the only place
 * that knows a route is a navigation boundary, and the fallback below belongs
 * beside the path it stands in for.
 *
 * The default exports are adapters, not new components: both routes are named
 * exports, which is what the rest of the app imports them as, and `lazy` only
 * takes a module with a default.
 */
const Graph = lazy(async () => ({ default: (await import('@/routes/Graph')).Graph }))
const Transfer = lazy(async () => ({ default: (await import('@/routes/Transfer')).Transfer }))

/**
 * The pages nobody lands on first, split out too (review 2, performance-5).
 *
 * Statically imported, Settings, the Job scout, the Assistant, the profile,
 * Statistics, the Calendar and the Vault — every panel, the tool forms — were all in the
 * modules the dashboard waits on: 42 files, 2 MB minified, preloaded before the
 * first paint. Each is now its own chunk, fetched the first time it is opened.
 *
 * Wrapped where they are declared, so the route table below still reads
 * `element={<Settings />}` and each page keeps its own Suspense boundary (see
 * the note on the route table for why one shared boundary is wrong).
 */
function suspended(page: FallbackPage, Page: ComponentType): ComponentType {
  return function SuspendedPage() {
    return (
      <Suspense fallback={<RouteFallback page={page} />}>
        <Page />
      </Suspense>
    )
  }
}
const Settings = suspended(
  'settings',
  lazy(async () => ({ default: (await import('@/routes/Settings')).Settings })),
)
const JobScout = suspended(
  'jobScout',
  lazy(async () => ({ default: (await import('@/routes/JobScout')).JobScout })),
)
const Assistant = suspended(
  'assistant',
  lazy(async () => ({ default: (await import('@/routes/Assistant')).Assistant })),
)
const Profile = suspended(
  'profile',
  lazy(async () => ({ default: (await import('@/routes/Profile')).Profile })),
)
const Calendar = suspended(
  'calendar',
  lazy(async () => ({ default: (await import('@/routes/Calendar')).Calendar })),
)
const Vault = suspended(
  'vault',
  lazy(async () => ({ default: (await import('@/routes/Vault')).Vault })),
)
const Statistics = suspended(
  'statistics',
  lazy(async () => ({ default: (await import('@/routes/Statistics')).Statistics })),
)

/**
 * The guide's pages, split out the same way.
 *
 * The Tools page carries the agent benchmark — its report JSON and the
 * scripted conversations behind it, about a third of a megabyte gzipped — and
 * Control flow carries the build-time code graph. Imported statically, all of
 * it sat in the entry chunk that the dashboard waits on, for a section most
 * visits never open. The boundary these suspend into is round the guide's
 * `<Outlet />` (`routes/Guide.tsx`), so the rail and pager stay put while a
 * page's chunk arrives.
 */
const GuideOverview = lazy(async () => ({
  default: (await import('@/components/guide/GuideOverview')).GuideOverview,
}))
const GuideScreens = lazy(async () => ({
  default: (await import('@/components/guide/GuideScreens')).GuideScreens,
}))
const GuideGraph = lazy(async () => ({
  default: (await import('@/components/guide/GuideGraph')).GuideGraph,
}))
const GuideTools = lazy(async () => ({
  default: (await import('@/components/guide/GuideTools')).GuideTools,
}))
const GuideBuiltWith = lazy(async () => ({
  default: (await import('@/components/guide/GuideBuiltWith')).GuideBuiltWith,
}))
const GuideControlFlow = lazy(async () => ({
  default: (await import('@/components/guide/GuideControlFlow')).GuideControlFlow,
}))
const GuideLicence = lazy(async () => ({
  default: (await import('@/components/guide/GuideLicence')).GuideLicence,
}))

/**
 * What stands in while a route's chunk is in flight.
 *
 * The page's real title, so the h1 lands where it is going to land and the tab
 * is named before anything renders — a blank main area reads as a navigation
 * that failed. No subtitle: the route supplies its own, and repeating it here
 * would be the same sentence in two files drifting apart.
 *
 * The line says what is happening rather than spinning silently. On a cold
 * cache the transfer chunk is several hundred kilobytes and this is on screen
 * long enough to be read.
 */
type FallbackPage =
  | 'graph'
  | 'transfer'
  | 'settings'
  | 'jobScout'
  | 'assistant'
  | 'profile'
  | 'statistics'
  | 'calendar'
  | 'vault'

function RouteFallback({ page }: { page: FallbackPage }) {
  const { t } = useTranslation('pages')
  const title = t(`${page}.title`)
  useTitle(title)

  return (
    <>
      <PageHeader title={title} />
      <Panel>
        <p className="flex items-center gap-2.5 text-sm text-text-2">
          <Loader
            className="size-4 shrink-0 animate-spin text-text-3"
            strokeWidth={1.8}
            aria-hidden
          />
          {t('routeFallback.loading')}
        </p>
      </Panel>
    </>
  )
}

/**
 * The detail page takes its two dialogs as props rather than importing them, so
 * it stays testable and can honestly disable a button nothing is behind. The
 * route is where that gets connected — one place, next to the path it belongs
 * to, rather than inside a page that would then own the wiring for its child.
 */
function ApplicationDetailRoute() {
  const { open } = useDialogs()
  const navigate = useNavigate()
  const { search } = useLocation()

  /**
   * Closing the record keeps the query string, and that is the whole point of
   * supplying this at all.
   *
   * `ApplicationDetail` falls back to `navigate(applicationsPath())` when no
   * `onClose` arrives — a bare '/applications', with no params. So the two ways
   * out of an open record disagreed: Escape and the backdrop are the sheet's,
   * and `Applications.tsx`'s `closeDetail` carries `location.search` across, but
   * the X in the record's own header went through the fallback and dropped it.
   * Measured from '/applications/rice?view=table&stage=interview&q=rice': the
   * sheet returned to that URL, the X returned to '/applications' — the table,
   * the stage chip and the search box all reset by the button that says nothing
   * about filters.
   *
   * Wired here rather than in `Applications.tsx` because this route is the only
   * render site of the component, and it is the one that is missing the prop
   * three files' worth of comments say the container owns.
   */
  const onClose = useCallback(
    () => navigate({ pathname: applicationsPath(), search }),
    [navigate, search],
  )

  return (
    <ApplicationDetail
      onEdit={(id) => open('application', { mode: 'edit', id })}
      // 'event' rather than 'reminder': this button sits beside the record's
      // Upcoming list, so the date is the point. The dialog's own switch still
      // decides whether it also shows up as a reminder.
      onAddItem={(id) => open('timelineItem', { mode: 'event', initial: { applicationIds: [id] } })}
      onClose={onClose}
    />
  )
}

/**
 * Where the app is mounted, from Vite's `base`.
 *
 * '/' in dev and on a custom domain; '/jojo/' on GitHub Pages, where the site
 * lives under the repository name. The router has to be told, or every route it
 * builds is absolute from the domain root — the app would load at
 * `/jojo/applications` and then navigate to `/applications`, which is a 404
 * served by GitHub rather than a page.
 *
 * Read from `import.meta.env.BASE_URL` rather than hardcoded, so the value is
 * the SAME one Vite used to rewrite the asset URLs. Two copies of a base path
 * is the version of this bug that only shows up in production.
 */
const BASENAME = import.meta.env.BASE_URL

/**
 * Carries out the navigation a dialog asked for with `closeAndGo`.
 *
 * Here because this is inside the router and the dialogs are not: `DialogHost`
 * mounts beside `<App />`, where `useNavigate` throws, so a dialog that needs
 * to go somewhere asks and this component goes. That is the "close and let the
 * route navigate" exit `DialogHost` documents, made available to every dialog
 * instead of only to whichever page happened to open it.
 *
 * `navigate()` rather than a document load, which is the point — a reload
 * would kill any agent run still working.
 */
function DialogNavigation() {
  const { pendingNavigation, settleNavigation } = useDialogs()
  const navigate = useNavigate()
  /*
   * The request this already acted on, by reference. React runs effects twice
   * in development, and without this the second run navigates again — two
   * history entries, so Back takes two presses to leave the record. A fresh
   * request is a fresh object, so a second ask for the same path still goes.
   */
  const handled = useRef<typeof pendingNavigation>(null)

  useEffect(() => {
    if (pendingNavigation === null || handled.current === pendingNavigation) return
    handled.current = pendingNavigation
    navigate(pendingNavigation.path)
    settleNavigation(pendingNavigation)
  }, [navigate, pendingNavigation, settleNavigation])

  return null
}

export default function App() {
  return (
    <BrowserRouter basename={BASENAME}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          {/* The detail is a CHILD of the list, not a sibling: the board or
              table stays mounted beside it, so opening a record keeps the view,
              the stage filter and the search box exactly as they were, and Back
              closes the record rather than rebuilding the page behind it. */}
          <Route path="applications" element={<Applications />}>
            {/* `:key`, not `:id`. The segment holds the record's slug —
                '/applications/rice' — and accepts an id only so links built
                before that still resolve. Naming it `id` is how the resolver
                came to be skipped at three sites in Applications.tsx that
                compared the raw segment against a NodeId. */}
            <Route path=":key" element={<ApplicationDetailRoute />} />
          </Route>
          {/* 'employers', not 'organisations'. The word in the interface is
              the employer's own — the model calls it an organisation because
              that is what the node is, and a URL a person may read should use
              the word they would say. */}
          <Route path="employers/:key" element={<Organisation />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="vault" element={<Vault />} />
          {/* Reminders became one tool inside the Vault. Kept as a redirect so
              bookmarks and anything still pointing here keep working. */}
          <Route path="reminders" element={<Navigate to="/vault" replace />} />
          <Route path="scout" element={<JobScout />} />
          <Route path="statistics" element={<Statistics />} />
          {/* Suspense per route rather than one boundary around the whole
              Routes block: a shared one would replace the page you are already
              on with a spinner the moment you clicked, so navigating away from
              Graph would blank Graph. Scoped here, the old page stays until the
              new chunk lands. */}
          <Route
            path="graph"
            element={
              <Suspense fallback={<RouteFallback page="graph" />}>
                <Graph />
              </Suspense>
            }
          />
          <Route
            path="transfer"
            element={
              <Suspense fallback={<RouteFallback page="transfer" />}>
                <Transfer />
              </Suspense>
            }
          />
          <Route path="profile" element={<Profile />} />
          <Route path="assistant" element={<Assistant />} />
          <Route path="settings" element={<Settings />} />
          {/* The guide is a section, not a page: a layout route holding the
              rail and the pager, with the six pages as children. The landing
              page is the index rather than '/guide/overview', so the topbar's
              help icon, the palette and every bookmark taken before the split
              still land on something. The segments are `links.ts`'s
              `GUIDE_PAGES`, in that order — this is the only place they are
              written out, and a path composed anywhere else is a bug. */}
          <Route path="guide" element={<Guide />}>
            <Route index element={<GuideOverview />} />
            <Route path="screens" element={<GuideScreens />} />
            <Route path="graph" element={<GuideGraph />} />
            <Route path="tools" element={<GuideTools />} />
            <Route path="built-with" element={<GuideBuiltWith />} />
            <Route path="control-flow" element={<GuideControlFlow />} />
            {/* The page was called FAQ first; a saved link still lands. */}
            <Route path="faq" element={<Navigate to="/guide/control-flow" replace />} />
            <Route path="licence" element={<GuideLicence />} />
          </Route>
          <Route path="*" element={<Placeholder />} />
        </Route>
      </Routes>
      <DialogNavigation />
    </BrowserRouter>
  )
}
