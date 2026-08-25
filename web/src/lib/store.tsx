import { reportError } from '@/lib/report-error'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { FirstRunChoice } from '@/components/common/FirstRunChoice'
import { StoreGate } from '@/components/common/StoreGate'
import { boot, bootInMemory, resetBoot } from '@jojo/service/repo/boot'
import type { BootResult, Session } from '@jojo/service/repo/boot'
import { kgWarn } from '@jojo/service/log'
import { KgProvider } from '@jojo/service/react/kg'
import { StoreStatusProvider } from '@jojo/service/react/status'
import type { StorePhase } from '@jojo/service/react/status-context'
import { createIdbDriver } from '@/kg/storage/idb-driver'
import { requestPersistentStorage } from '@/kg/storage/probe'
import { BootContext, sessionOf } from '@/lib/boot-context'
import type { BootState, BootValue } from '@/lib/boot-context'
import { applyDataSet } from '@/lib/data-set'
import type { DataSetChoice } from '@/lib/data-set'
import { webHost } from '@/lib/host'
import { now } from '@/lib/today'
import { useToast } from '@/lib/toast-context'

/**
 * The store, the one place the app's clock is chosen, and the one place a
 * platform driver is named.
 *
 * Everything the user creates, edits or deletes lives in the graph behind this
 * provider, and as of this wave it lives on disk behind that. A reload is no
 * longer the reset button — which is why every state this file can be in is
 * spelled out in `BootState` rather than assumed: between mount and "IndexedDB
 * has answered" something has to render, and the one thing it must not be is an
 * empty app, because an empty list in this codebase is not neutral. Settings
 * would read "Empty" and offer to load demo data over records that are on disk
 * and merely not read yet.
 *
 * `now` is the wall clock, injected here because no module under `service/kg` may
 * read one (D26) and `src/lib` is the layer allowed a platform API. Through
 * Waves 1–3 it was pinned to the seed's October instead — every relative label
 * in the app was measured against a fixture constant, and a store stamping real
 * timestamps beside October fixtures would have read as a demo where nothing was
 * ever due and everything was ten months old. Wave 2 made that pin the lie
 * instead: the records survive a reload now, so the fixtures move to meet the
 * clock (`repo/seed.ts` shifts every authored date by a whole number of days at
 * seed time) and the clock stopped needing to move to meet them.
 */

/**
 * The live session, held at module scope alongside `boot()`'s own cached promise.
 *
 * It is here rather than in a ref because the thing that has to be disposed
 * outlives any one mount of the component: `boot()` deliberately caches its
 * in-flight promise for the life of the process (R-11), so a second mount is
 * handed the SAME session, and a `dispose()` in a component cleanup would have
 * closed the driver out from under it.
 */
let live: Session | null = null

/**
 * Cleanup disposes on a macrotask, and a remount cancels it.
 *
 * StrictMode mounts, unmounts and mounts again in one commit. Disposing
 * synchronously in the cleanup closed the driver and stopped the write queue,
 * and the second mount then awaited `boot()`'s cached promise and got the
 * session it had just shut: the app rendered normally and every write went
 * nowhere, with no error anywhere, in development only. React's remount is
 * synchronous within the commit, so a zero-delay timer is always cancelled
 * before it fires — and a genuine unmount still disposes on the next tick.
 */
let pendingDispose: ReturnType<typeof setTimeout> | null = null

/**
 * How many `StoreProvider`s are mounted. Zero while a boot is still in flight
 * means the session that boot is about to produce has nobody to dispose it.
 */
let mounts = 0

/**
 * Whether the first-run fork has been answered in THIS process.
 *
 * At module scope for the same reason `live` is: `boot()` caches its promise for
 * the life of the process (R-11), so every later mount is handed the same
 * `outcome: 'first-run'` result — including StrictMode's second mount and every
 * HMR swap. A flag in component state resets with the component, and the modal
 * would come back over a store the user had already decided about, with both
 * buttons still live over the records they had just chosen.
 *
 * `disposeLive()` clears it, and that is the correct pairing rather than an
 * oversight: *Start fresh* deletes the database, so the next boot finds no meta
 * row and genuinely is a first run again — the fork has to be offered a second
 * time or the user is handed whatever the seed defaulted to.
 */
let dataSetChosen = false

/**
 * How long *Start fresh* waits for a delete before saying who is holding it.
 *
 * The driver's own patience with a blocked upgrade (`BLOCKED_GRACE_MS` in
 * `kg/storage/idb-driver.ts`), for the
 * same reason and to the same number: this is the moment the UI has something
 * true to say, and two different waits would mean two different accounts of the
 * same locked database depending on which one the user hit first.
 */
const DESTROY_GRACE_MS = 5_000

function disposeLive(): void {
  live?.dispose()
  live = null
  // Paired, always. The session is gone, so the next boot must run for real
  // rather than being handed the settled promise that produced this one.
  resetBoot()
  dataSetChosen = false
}

/** BootResult -> the state the gate switches on. */
function stateOf(result: BootResult): BootState {
  const hydratedAt = Date.now()
  switch (result.outcome) {
    case 'ready':
      return { phase: 'ready', session: result.session, hydratedAt, firstRun: false }
    case 'first-run':
      return {
        phase: 'ready',
        session: result.session,
        hydratedAt,
        // `&& !dataSetChosen`, because this result is cached: a remount after the
        // choice was made re-reads the same settled `first-run` promise, and
        // without this it would put the fork back up over a decided store.
        firstRun: !dataSetChosen,
      }
    case 'unavailable':
      return {
        phase: 'unavailable',
        reason: result.reason,
        detail: result.detail,
        session: result.session,
        hydratedAt,
      }
    case 'corrupt':
      return { phase: 'corrupt', detail: result.detail, rescued: result.rescued }
  }
}

/**
 * The public reading, for `useStoreStatus()`.
 *
 * `unavailable` keeps its own `StorePhase` even though the app is mounted over a
 * working in-memory session: anything asking "is this store real" has to be able
 * to get "no" for an answer, and reporting `ready` because a repository happens
 * to exist is how a card ends up promising a save that cannot happen.
 */
function phaseOf(state: BootState): StorePhase {
  switch (state.phase) {
    case 'ready':
      return { phase: 'ready', dataSet: state.session.meta.dataSet, hydratedAt: state.hydratedAt }
    case 'unavailable':
      return { phase: 'unavailable', reason: state.reason }
    case 'corrupt':
      return { phase: 'corrupt', detail: state.detail, rescued: state.rescued !== null }
    case 'loading':
      return { phase: 'loading' }
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast()
  const [state, setState] = useState<BootState>({ phase: 'loading' })
  const [interrupted, setInterrupted] = useState(false)
  const [busy, setBusy] = useState(false)

  /**
   * Read through a ref inside the boot callbacks.
   *
   * `onBlocking` and `onRemoteChange` are handed to `boot()` once and then held
   * by the driver for the life of the session, so a callback closing over
   * `toast` from the first render would have gone on calling that render's
   * closure hours later. It is stable in practice — `ToastContext`'s value is
   * built once — and depending on that would be depending on another file's
   * implementation detail.
   */
  const toastRef = useRef(toast)
  toastRef.current = toast

  const open = useCallback(async () => {
    const result = await boot({
      now,
      driver: createIdbDriver(),
      // R-4, the half nobody sees in development: another tab has a newer build
      // and is upgrading the database, and we have closed our connection so it
      // is not deadlocked. Nothing this tab does from here on can be saved.
      onBlocking: () => setInterrupted(true),
      /*
       * Only ever called on a browser with no BroadcastChannel — `boot` checks
       * the store's `crossTab` before it subscribes. There, this is the whole of
       * the cross-tab safety net: without it, two tabs write whole records over
       * each other in silence and each keeps an undo stack that will replay over
       * the other's work.
       */
      onResume: webHost.onResume?.bind(webHost),
      onRemoteChange: () => {
        // Said out loud because the undo stack is gone with it (D23). A user who
        // pressed ⌘Z after this and got nothing would reasonably conclude undo
        // is broken rather than that another tab moved the ground.
        toastRef.current({
          title: 'Updated from another tab',
          description: 'Your records were reloaded, so undo history in this tab was cleared.',
        })
      },
    })
    const next = stateOf(result)
    if (mounts === 0) {
      // The provider went away while IndexedDB was still answering — an HMR
      // swap, or a teardown mid-boot. The cleanup below already ran and found
      // nothing to dispose, so without this the connection this boot just opened
      // is never closed by anyone: it goes on holding the database, and the next
      // build's upgrade blocks against a tab that looks idle. R-4, in
      // development, where it presents as a hang with no cause.
      sessionOf(next)?.dispose()
      resetBoot()
      return
    }
    live = sessionOf(next)
    setState(next)
  }, [])

  /**
   * `open()`, with the guarantee the gate depends on: it always settles the state.
   *
   * `BootState` starts at `loading` and `StoreGate` renders a skeleton for it, so
   * a boot that neither resolves nor is caught is a grey screen with no message
   * and no way out — the one outcome every failure path in this file was written
   * to prevent. `boot()` is supposed to return a `BootResult` rather than throw,
   * and the driver is supposed to return a `DriverResult` rather than throw; this
   * is the backstop for the day one of them does, and it degrades to exactly what
   * a genuinely unavailable store degrades to.
   */
  const openGuarded = useCallback(async () => {
    try {
      await open()
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      kgWarn('boot threw instead of reporting; running in memory', { detail })
      resetBoot()
      const session = bootInMemory({ now, dataSet: 'empty' })
      live = session
      setState({
        phase: 'unavailable',
        reason: 'unsupported',
        detail,
        session,
        hydratedAt: Date.now(),
      })
    }
  }, [open])

  useEffect(() => {
    mounts += 1
    if (pendingDispose !== null) {
      clearTimeout(pendingDispose)
      pendingDispose = null
    }
    void openGuarded()

    return () => {
      mounts -= 1
      pendingDispose = setTimeout(() => {
        pendingDispose = null
        disposeLive()
      }, 0)
    }
  }, [openGuarded])

  /**
   * R-6: ask the browser not to evict us, after the user's FIRST real record.
   *
   * Subscribed rather than checked on mount, and that is the whole point of the
   * timing. Chrome grants this on engagement heuristics and Firefox raises a
   * permission prompt; asked on a first visit before anything has been typed it
   * is the request most likely to be denied, and a denial is remembered. The
   * repository notifies on commit and nothing else, so the first callback here
   * is by definition after a write — and `dataSet` flipping to 'user' is the
   * store's own record that the write was the user's, not the seed's.
   */
  useEffect(() => {
    const session = sessionOf(state)
    if (!session?.durable) return
    let asked = false
    return session.repo.subscribe(() => {
      if (asked || session.meta.dataSet !== 'user') return
      asked = true
      void requestPersistentStorage()
    })
  }, [state])

  const retry = useCallback(() => {
    setBusy(true)
    // The failed boot closed its driver on the way out, and `open()` builds a
    // fresh one — this is only about the session, if there was one.
    disposeLive()
    setInterrupted(false)
    setState({ phase: 'loading' })
    void openGuarded().finally(() => setBusy(false))
  }, [openGuarded])

  const startFresh = useCallback(() => {
    setBusy(true)
    disposeLive()
    void (async () => {
      // Its own driver, because the one that failed is gone. `destroy` opens
      // nothing — it deletes by name — but it does mint a channel, so it is
      // closed rather than left holding a BroadcastChannel for the tab's life.
      const driver = createIdbDriver()
      /*
       * Raced, because `deleteDatabase` does not fail when it is blocked — it
       * waits. A second tab holding the database open makes the delete pending
       * rather than refused, and `destroy()` then resolves only once that tab
       * closes, which could be tomorrow. Unraced, the button on the recovery
       * panel read "Working…" for the rest of the session with nothing on screen
       * to say why. The delete stays queued and lands when the other tab goes;
       * this only stops us pretending to be busy while it does.
       */
      const destroyed = await Promise.race([
        driver.destroy(),
        new Promise<'held'>((resolve) => setTimeout(() => resolve('held'), DESTROY_GRACE_MS)),
      ])
      driver.close()
      if (destroyed === 'held') {
        toastRef.current({
          title: 'Another jojo tab has the database open',
          description:
            'It will be deleted as soon as that tab is closed. Close the other tabs, then try again.',
          tone: 'danger',
        })
        setBusy(false)
        return
      }
      if (!destroyed.ok) {
        toastRef.current({
          title: 'The database could not be deleted',
          description: `${destroyed.error.message}. Another tab may still have it open.`,
          tone: 'danger',
        })
        setBusy(false)
        return
      }
      setInterrupted(false)
      setState({ phase: 'loading' })
      await openGuarded()
      setBusy(false)
    })()
  }, [openGuarded])

  const closeStore = useCallback(() => {
    disposeLive()
  }, [])

  /**
   * The one write behind both the first-run fork and Settings' data buttons.
   *
   * Awaited to a boolean rather than fired and forgotten: `replaceAll` goes to
   * IndexedDB, and a quota error there has to keep the modal open rather than
   * closing it over a store that still holds what the user asked to be rid of.
   */
  const chooseDataSet = useCallback(
    async (choice: DataSetChoice): Promise<boolean> => {
      const session = sessionOf(state)
      if (!session) return false

      /*
       * The one case with nothing to write: boot seeded this store in the same
       * transaction as the meta row (D24), so on a first run the demo fixtures
       * are ALREADY the store and *Explore with demo data* is a decision, not a
       * change. Re-seeding here would be a full wholesale replace of a graph
       * with an identical one — new ids for every record the user is looking at,
       * every date re-shifted, and a second large transaction on the slowest
       * launch the app ever has. Reachable only while `firstRun` is still true,
       * so Settings can never take this branch.
       */
      const alreadyLoaded =
        state.phase === 'ready' && state.firstRun && session.meta.dataSet === choice

      setBusy(true)
      try {
        if (!alreadyLoaded) {
          const written = await applyDataSet(session.repo, choice, now())
          if (!written.ok) {
            // A store write that fails is the failure worth knowing about most:
            // it is the app's one job, the user has no server copy, and the two
            // usual causes — a quota wall and a browser blocking IndexedDB — are
            // invisible from the outside. The `code` is categorical, so it
            // travels; the message never does.
            reportError('storage', written.error)
            toastRef.current({
              title:
                choice === 'demo' ? 'The demo data was not loaded' : 'The records were not cleared',
              // `.userMessage`, not `.message`: KgError's constructor builds
              // `message` as `${code}: ${text}`, so this sentence rendered as
              // "storage/unavailable: Some of your changes have not reached the
              // disk yet. Try again once saving has caught up.. Your records are
              // unchanged." — the error code shown to the user and a doubled
              // full stop. The user message already ends in one, so nothing is
              // appended here either.
              description: `${written.error.userMessage} Your records are unchanged.`,
              tone: 'danger',
            })
            return false
          }
        }
        dataSetChosen = true
        setState((prev) => (prev.phase === 'ready' ? { ...prev, firstRun: false } : prev))
        return true
      } finally {
        setBusy(false)
      }
    },
    [state],
  )

  const value = useMemo<BootValue>(
    () => ({
      state,
      interrupted,
      busy,
      needsDataChoice: state.phase === 'ready' && state.firstRun,
      retry,
      startFresh,
      closeStore,
      chooseDataSet,
    }),
    [state, interrupted, busy, retry, startFresh, closeStore, chooseDataSet],
  )

  const session = sessionOf(state)
  const phase = useMemo(() => phaseOf(state), [state])

  return (
    <BootContext value={value}>
      {/* The boot invariant, enforced structurally rather than by thirty guards:
          the children below are not rendered at all until there is a graph to
          render them from, so `phase !== 'ready'` cannot mean "an empty app". */}
      <StoreGate>
        {session ? (
          <StoreStatusProvider repo={session.repo} boot={phase}>
            {/* The one place the platform is named. `KgProvider` defaults to a
                headless host so nothing under `service/kg` has to know a browser
                exists; this is the web app, so this is where the browser gets
                supplied — ⌘Z/⇧⌘Z and the flush on pagehide. */}
            <KgProvider repo={session.repo} now={now} host={webHost}>
              {children}
              {/* Mounted INSIDE the gate, which is what keeps it off the
                  skeleton: `StoreGate` renders nothing but shapes until boot has
                  answered, so there is no commit in which this could flash over
                  a hydrating app — and for a returning user `needsDataChoice` is
                  false in the first commit that renders anything at all. */}
              <FirstRunChoice />
              {/* `Onboarding` used to be here, beside this one, and moved into
                  `AppShell` — which is inside the router. It links to the guide
                  and to Profile, and out here those had to be bare `<a href>`s:
                  no router context, so no `basename`, so on GitHub Pages
                  "Start the tour" went to `github.io/guide` rather than
                  `github.io/jojo/guide` and 404ed.

                  The gate property this comment defends is unchanged: `AppShell`
                  is rendered by `{children}` above, inside this same gate, so it
                  still cannot flash over a hydrating app. */}
            </KgProvider>
          </StoreStatusProvider>
        ) : null}
      </StoreGate>
    </BootContext>
  )
}
