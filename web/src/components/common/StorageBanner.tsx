import type { ReactNode } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStoreStatus } from '@/kg/react/status-context'
import { useBoot } from '@/lib/boot-context'

/**
 * The three ways a session that booted can stop being able to save, said out
 * loud and left on screen.
 *
 * A banner rather than a toast, deliberately (R-5). A toast for "your changes
 * are not being saved" scrolls away after four seconds and the user keeps
 * typing into a store that is not recording any of it; the honest shape for a
 * condition that persists is a strip that persists with it. It sits above the
 * route rather than over it because none of these stop the app working — the
 * records on screen are real and can still be read, copied and exported.
 *
 * Ordered by which one supersedes which. A tab that has been shut out by
 * another tab's upgrade cannot save at all, so it is reported before a write
 * queue that is merely struggling, and a store that never opened is reported
 * before either — it is the reason the others cannot happen.
 */

function Banner({
  tone,
  children,
  action,
}: {
  tone: 'danger' | 'warning'
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div
      role="status"
      className={
        tone === 'danger'
          ? 'flex flex-wrap items-start gap-2.5 rounded-lg border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger'
          : 'flex flex-wrap items-start gap-2.5 rounded-lg border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning'
      }
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} aria-hidden />
      <p className="min-w-0 flex-1">{children}</p>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

const reload = () => window.location.reload()

const ReloadButton = () => (
  <Button variant="outline" size="sm" onClick={reload}>
    <RefreshCw className="size-3.5" strokeWidth={1.8} aria-hidden />
    Reload
  </Button>
)

export function StorageBanner() {
  const { state, interrupted } = useBoot()
  const { health } = useStoreStatus()

  if (interrupted) {
    return (
      <Banner tone="danger" action={<ReloadButton />}>
        jojo was updated in another tab, so this one closed its database to let that update through.
        Nothing you change here is being saved. Reload to continue.
      </Banner>
    )
  }

  if (state.phase === 'unavailable') {
    return (
      <Banner tone="danger" action={state.reason === 'blocked' ? <ReloadButton /> : undefined}>
        {state.reason === 'blocked' ? (
          <>
            {/*
             * Written to be true in both directions. `storage/blocked` covers
             * another tab holding an older version of the database AND this
             * build being older than the one that wrote the store — a deploy
             * with two tabs open produces the second, and the copy the driver
             * suggests for the first ("close the tab with the older version")
             * is exactly backwards for it. Naming the situation rather than
             * whose version is newer is right either way.
             */}
            jojo could not open its database — another jojo tab is open on a different version of
            the app. Close the other tabs and reload. Until then this tab works, but nothing you
            change is saved.
          </>
        ) : (
          <>
            This browser is not letting jojo store anything, so your records live in this tab only
            and go when you close it. Private windows and some managed browsers do this. Export from
            Settings before you leave.
          </>
        )}
      </Banner>
    )
  }

  if (health.state === 'off') {
    return (
      <Banner tone="danger" action={<ReloadButton />}>
        {health.reason === 'quota'
          ? 'This browser has no room left, so jojo has stopped saving. Free some space, then reload — your records are still on screen and can be exported from Settings.'
          : 'jojo has stopped saving because another tab has the database. Close the other tabs and reload — your records are still on screen and can be exported from Settings.'}
      </Banner>
    )
  }

  if (health.state === 'degraded') {
    return (
      <Banner tone="warning">
        {/* Names the count rather than "some changes". The queue keeps its ops
            and drains in order if a later retry succeeds, so this is a number
            that goes down on its own — which is the difference between a
            warning someone can wait out and one they can only guess at. */}
        {health.pending} change{health.pending === 1 ? '' : 's'} could not be saved and jojo is
        still retrying. Export from Settings if you need a copy now. ({health.lastError})
      </Banner>
    )
  }

  return null
}
