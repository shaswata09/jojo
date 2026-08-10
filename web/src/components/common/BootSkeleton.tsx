import { useEffect, useState } from 'react'

/**
 * What is on screen between mount and "IndexedDB has answered".
 *
 * Shapes, and no content. Not one number, no zeros, no empty state and no
 * spinner: while the store is being read the app does not yet know how many
 * applications the user has, and every honest way of saying that is silence.
 * The previous store was compiled into memory synchronously and this moment did
 * not exist; with records on disk it does, and the failure it replaces is the
 * one where the dashboard paints "0 applications" for 80 ms over a database
 * holding forty of them.
 *
 * It mirrors the real shell's geometry — sidebar rail, topbar, panels, the same
 * gaps and radii — so the app does not jump when the graph arrives. It is
 * deliberately NOT the real `Sidebar` and `Topbar` with skeleton props: both of
 * them read the graph for badge counts and spotlight results, so mounting them
 * here would mean mounting graph consumers before there is a graph, which is the
 * exact invariant the gate exists to hold.
 *
 * Nothing escalates before 600 ms, and the escalation is one line. An interface
 * that starts reassuring you at 200 ms creates the anxiety it means to relieve.
 */

/** Long enough that a warm open never reaches it; short enough to beat impatience. */
const SAY_SOMETHING_MS = 600

/**
 * The driver gives up on a blocked upgrade at exactly 5 s (`idb-driver.ts:84`),
 * so anything still here past that is not a slow disk. It still does not become
 * the recovery panel: boot is about to resolve on its own with a real reason,
 * and a panel offering to delete the database while the read that would have
 * succeeded is still in flight is the one mistake in this file that costs data.
 */
const TAKING_LONG_MS = 5_000

function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-well ${className}`} />
}

export function BootSkeleton() {
  const [elapsed, setElapsed] = useState<0 | typeof SAY_SOMETHING_MS | typeof TAKING_LONG_MS>(0)

  useEffect(() => {
    const first = setTimeout(() => setElapsed(SAY_SOMETHING_MS), SAY_SOMETHING_MS)
    const second = setTimeout(() => setElapsed(TAKING_LONG_MS), TAKING_LONG_MS)
    return () => {
      clearTimeout(first)
      clearTimeout(second)
    }
  }, [])

  return (
    <div className="relative mx-auto flex min-h-dvh max-w-[1440px] flex-col gap-4 p-3 sm:gap-5 sm:p-5 lg:flex-row">
      {/* The rail is desktop-only, exactly as the real one is: below `lg` the
          sidebar is a closed drawer, and a grey column standing in for it would
          have been a layout the app never has. */}
      <div className="surface hidden w-[232px] shrink-0 flex-col gap-2 rounded-lg px-3.5 py-5 lg:flex">
        <Block className="h-8 w-32" />
        <div className="mt-4 flex flex-col gap-2.5">
          {[0, 1, 2, 3, 4, 5, 6].map((row) => (
            <Block key={row} className="h-4 w-full" />
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 sm:gap-5">
        <div className="surface flex items-center gap-3 rounded-lg px-3 py-3 sm:px-5">
          <Block className="size-8 shrink-0 rounded-md" />
          <Block className="h-8 flex-1" />
          <Block className="size-8 shrink-0 rounded-md" />
        </div>

        <div className="flex flex-col gap-4 sm:gap-5">
          <div className="surface rounded-lg px-4 py-4 sm:px-5 sm:py-5">
            <Block className="h-5 w-40" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((tile) => (
                <Block key={tile} className="h-20 w-full" />
              ))}
            </div>
          </div>
          <div className="surface rounded-lg px-4 py-4 sm:px-5 sm:py-5">
            <Block className="h-5 w-32" />
            <div className="mt-4 flex flex-col gap-2.5">
              {[0, 1, 2, 3, 4].map((row) => (
                <Block key={row} className="h-8 w-full" />
              ))}
            </div>
          </div>
        </div>

        {/*
         * One live region for both lines, so the second replaces the first
         * rather than being announced as a new arrival on top of it. `polite`
         * because nothing here needs to interrupt what a screen reader is
         * already saying — the page is not going anywhere.
         */}
        <p aria-live="polite" className="min-h-5 px-1 text-sm text-text-3">
          {elapsed === TAKING_LONG_MS
            ? 'Your local database is taking longer than usual to open. Another jojo tab may be holding it — closing the others usually frees it.'
            : elapsed === SAY_SOMETHING_MS
              ? 'Opening your local database…'
              : null}
        </p>
      </div>
    </div>
  )
}
