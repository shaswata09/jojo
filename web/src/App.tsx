import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { Loader } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel } from '@/components/common/Panel'
import { AppShell } from '@/components/layout/AppShell'
import { useDialogs } from '@/lib/dialogs-context'
import { useTitle } from '@/lib/links'
import { ApplicationDetail } from '@/routes/ApplicationDetail'
import { Applications } from '@/routes/Applications'
import { Assistant } from '@/routes/Assistant'
import { Calendar } from '@/routes/Calendar'
import { Dashboard } from '@/routes/Dashboard'
import { Guide } from '@/routes/Guide'
import { JobScout } from '@/routes/JobScout'
import { Placeholder } from '@/routes/Placeholder'
import { Profile } from '@/routes/Profile'
import { Vault } from '@/routes/Vault'
import { Settings } from '@/routes/Settings'
import { Statistics } from '@/routes/Statistics'

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
function RouteFallback({ title }: { title: string }) {
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
          Loading this page — it is fetched separately, so the rest of jojo starts without it.
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

  return (
    <ApplicationDetail
      onEdit={(id) => open('application', { mode: 'edit', id })}
      // 'event' rather than 'reminder': this button sits beside the record's
      // Upcoming list, so the date is the point. The dialog's own switch still
      // decides whether it also shows up as a reminder.
      onAddItem={(id) => open('timelineItem', { mode: 'event', initial: { applicationId: id } })}
    />
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          {/* The detail is a CHILD of the list, not a sibling: the board or
              table stays mounted beside it, so opening a record keeps the view,
              the stage filter and the search box exactly as they were, and Back
              closes the record rather than rebuilding the page behind it. */}
          <Route path="applications" element={<Applications />}>
            <Route path=":id" element={<ApplicationDetailRoute />} />
          </Route>
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
              <Suspense fallback={<RouteFallback title="Graph" />}>
                <Graph />
              </Suspense>
            }
          />
          <Route
            path="transfer"
            element={
              <Suspense fallback={<RouteFallback title="Transfer" />}>
                <Transfer />
              </Suspense>
            }
          />
          <Route path="profile" element={<Profile />} />
          <Route path="assistant" element={<Assistant />} />
          <Route path="settings" element={<Settings />} />
          <Route path="guide" element={<Guide />} />
          <Route
            path="*"
            element={<Placeholder title="Not found" subtitle="That page does not exist." />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
