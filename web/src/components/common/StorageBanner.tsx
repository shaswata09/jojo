import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStoreStatus } from '@/kg/react/status-context'
import { estimateStorage } from '@/kg/storage/probe'
import { sessionOf, useBoot } from '@/lib/boot-context'

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
 *
 *
 * WHICH ARMS GET A RELOAD BUTTON, AND WHY THE QUOTA ARM DOES NOT
 *
 * A reload discards everything the write queue is still holding. On the two
 * arms where the tab is shut out of the database — `interrupted`, and
 * `unavailable` — that is not a cost, because nothing this tab does can ever
 * reach disk and reloading is the only way forward; the button is the whole
 * remedy.
 *
 * On `health.state === 'off'` it is the opposite. `queue.ts` deliberately keeps
 * the failed ops and warns persistently rather than rolling the UI back, so the
 * user's unsaved changes are sitting in that queue — and the banner explaining
 * that was, until now, handing them a one-click button that threw the changes
 * away with no confirmation and no count. So this arm offers no reload. It says
 * what to do instead, and Export is a real answer here: the records are on
 * screen, and an export reads the graph in memory rather than the disk.
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

/**
 * The share of the origin's quota in use, or null if the browser will not say.
 *
 * `estimateStorage` had exactly one consumer before this — Diagnostics, which
 * prints "10.0 MB of 10.0 MB" and nothing else. So the number was measured,
 * displayed to whoever went looking for it, and never acted on: the first a
 * user heard that the disk was full was a write failing, by which point the
 * queue is `off` and the change they just made is stranded. A figure that is
 * already in hand and predicts the one unrecoverable failure in this app should
 * be read out before the failure, not after.
 *
 * Re-checked when the queue starts writing rather than on a timer. Usage only
 * moves when we write, an idle tab has nothing to re-measure, and the check
 * costs a promise. The floor between checks keeps a burst of edits from
 * measuring once per drain.
 */
const RECHECK_MS = 30_000

/** Warn here rather than at 100%: it has to arrive while there is room to act. */
const NEARLY_FULL = 0.9

function useStoragePressure(writing: boolean): number | null {
  const [ratio, setRatio] = useState<number | null>(null)
  const checkedAt = useRef(0)

  useEffect(() => {
    const now = Date.now()
    if (checkedAt.current !== 0 && (!writing || now - checkedAt.current < RECHECK_MS)) return
    checkedAt.current = now

    let live = true
    void estimateStorage().then((estimate) => {
      if (!live) return
      const { usage, quota } = estimate ?? { usage: null, quota: null }
      setRatio(usage !== null && quota !== null && quota > 0 ? usage / quota : null)
    })
    return () => {
      live = false
    }
  }, [writing])

  return ratio
}

export function StorageBanner() {
  const { state, interrupted } = useBoot()
  const { health } = useStoreStatus()
  const pressure = useStoragePressure(health.state === 'writing')

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
             *
             * The second sentence is the one that was missing. This tab is
             * running on an empty stand-in (`boot.ts`'s `bootStandIn`), and a
             * user looking at an empty Applications page after a deploy needs
             * to be told their records are still there before they conclude
             * jojo has eaten them.
             */}
            jojo could not open its database — another jojo tab is open on a different version of
            the app. <strong className="font-medium">Your records are still on disk</strong>, but
            this tab could not read them, so it is showing nothing rather than guessing. Close the
            other tabs and reload to get them back.
          </>
        ) : (
          <>
            This browser is not letting jojo open its storage, so this tab is a blank workspace:
            anything already saved on this device is not being shown, and anything you type here
            goes when you close the tab. Private windows and some managed browsers do this. Export
            from Settings before you leave if you add anything worth keeping.
          </>
        )}
      </Banner>
    )
  }

  if (health.state === 'off') {
    /*
     * `unsaved` counts the user's ACTIONS; `pending` counts rows, and one stage
     * change is three of them. The number here is the one someone checks
     * against their own memory of what they did — and it now keeps counting
     * after the queue stops, because `enqueue` refreshes it on every action
     * rather than only on the way into `writing`. It used to freeze at whatever
     * it read the moment saving stopped, so a user who carried on working for
     * ten minutes was told one change was at risk.
     */
    const atRisk =
      health.unsaved === 0
        ? null
        : `${health.unsaved} change${health.unsaved === 1 ? '' : 's'} ${health.unsaved === 1 ? 'is' : 'are'} on screen but not saved — export from Settings to keep ${health.unsaved === 1 ? 'it' : 'them'}, because reloading or closing this tab will lose ${health.unsaved === 1 ? 'it' : 'them'}.`

    /*
     * The arm that used to be a retry loop.
     *
     * `storage/corrupt` was retried on a flat four-second backoff with no
     * ceiling, so a single unreadable row on disk — one collision the write can
     * never win — left the user working into a queue that would never drain,
     * under a banner that said "still retrying" and meant "never". It is
     * terminal now (`TERMINAL` in `kg/repo/queue.ts`), and this is what
     * terminal has to say: the work on screen is not on disk, no amount of
     * waiting changes that, and the export is the only thing that saves it.
     */
    if (health.reason === 'corrupt') {
      return (
        <Banner tone="danger">
          jojo has stopped saving: this browser refused a change to your records and retrying will
          not help. {atRisk ?? 'Everything you changed before that is on disk.'} Export from
          Settings now — Settings → Diagnostics has the details, and reloading before you export
          loses whatever is only on screen.
        </Banner>
      )
    }

    return (
      <Banner tone="danger">
        {health.reason === 'quota' ? (
          <>
            This browser has no room left, so jojo has stopped saving.{' '}
            {atRisk ?? 'Everything you changed before that is on disk.'} Free some space, then
            reload.
          </>
        ) : (
          <>
            jojo has stopped saving because another tab has the database. Close the other tabs, then
            export from Settings if anything on screen has not been saved — reloading this tab loses
            it.
          </>
        )}
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
        {health.unsaved === 1 ? '1 change' : `${health.unsaved} changes`} could not be saved and
        jojo is still retrying. Export from Settings if you need a copy now. ({health.lastError})
      </Banner>
    )
  }

  /*
   * Records that were read and NOT shown.
   *
   * `boot.ts` calls a silently skipped node "lost work with no server backup
   * and no undo", counts every one and logs its id — and then the only place
   * that said so was Settings → Diagnostics. On screen, an application that
   * failed validation between two reloads simply stopped existing: the list
   * read "11 applications, all on this machine" with no asterisk, so the one
   * person who could notice was someone already counting.
   *
   * A banner rather than a toast, for the same reason as everything else here:
   * it describes a condition that persists until the rows are fixed or dropped,
   * and it points at the panel that names them.
   */
  const skipped = sessionOf(state)?.skipped ?? []
  if (skipped.length > 0) {
    return (
      <Banner tone="warning">
        {skipped.length === 1 ? '1 record' : `${skipped.length} records`} on this device could not
        be read and {skipped.length === 1 ? 'is' : 'are'} not being shown. Nothing has been deleted
        — Settings → Diagnostics lists what they are, and an export from there includes everything
        jojo could read.
      </Banner>
    )
  }

  // Last, because it is the only one describing something that has not happened
  // yet. Any of the failures above is already the thing this warns about.
  if (pressure !== null && pressure >= NEARLY_FULL) {
    return (
      <Banner tone="warning">
        This browser is nearly out of room for jojo — about {Math.round(pressure * 100)}% of what it
        allows is in use. Saving stops working when it fills, so it is worth exporting from Settings
        and clearing space now, while your records can still be written.
      </Banner>
    )
  }

  return null
}
