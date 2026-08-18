import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { FirstRunChoice } from '@/components/common/FirstRunChoice'
import { Txt } from '@/components/ui/Text'
import { kgWarn } from '@jojo/service/log'
import { KgProvider } from '@jojo/service/react/kg'
import { StoreStatusProvider } from '@jojo/service/react/status'
import type { StorePhase } from '@jojo/service/react/status-context'
import { boot, bootInMemory } from '@jojo/service/repo/boot'
import type { Session } from '@jojo/service/repo/boot'
import { createRnDriver } from '@/kg/storage/rn-driver'
import { nativeHost } from '@/lib/host'
import { now } from '@/lib/today'
import { space } from '@/theme/tokens'

/**
 * The store, and the one place this platform's driver and host are named.
 *
 * Everything the user creates, edits or deletes lives in the graph behind this
 * provider, and it lives on the device behind that. A restart stopped being the
 * reset button here — which is the whole point of this wave, and also the reason
 * this file is not simply `<KgProvider>`: between mount and "AsyncStorage has
 * answered" something has to render, and the one thing it must not be is the app
 * with no records in it. An empty list is not neutral in this codebase. Settings
 * would read "Empty" and offer to load demo data over records that are on disk
 * and merely not read yet, and the Guide's checklist would un-tick itself.
 *
 * Three states, spelled out rather than assumed:
 *
 * - **loading** — the gate below. Deliberately almost nothing: a cold read is
 *   milliseconds, and a spinner that flashes for one frame is worse than a
 *   held frame.
 * - **ready** — the session from disk, seeded on first run.
 * - **degraded** — storage refused. The app still runs, on the in-memory
 *   session, and says so. `boot()` returns a working session even when the
 *   durable path failed precisely so this decision belongs here rather than
 *   being forced by a throw.
 *
 * `now` is the wall clock, injected because no module under `@jojo/service` may read
 * one. `src/lib` is the layer allowed a platform API — which is why the driver,
 * the host and the clock are all named in this file and nowhere else.
 */

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; session: Session }
  | { phase: 'degraded'; session: Session; why: string }

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  // Boot once per process. React 19 in dev mounts effects twice, and a second
  // boot would open a second driver over the same file.
  const started = useRef(false)
  const [firstRun, setFirstRun] = useState(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    let live = true

    void (async () => {
      try {
        const result = await boot({ now, driver: createRnDriver() })
        if (!live) return
        // 'corrupt' is the only outcome without a session: the rows on disk
        // failed validation and `boot` will not hand back a graph built from
        // them. The other three all carry one, working, and differ only in what
        // has to be said about it.
        if (result.outcome === 'corrupt') {
          setState({
            phase: 'degraded',
            session: bootInMemory({ now }),
            why: `the saved records could not be read (${result.detail}).`,
          })
          return
        }
        if (result.outcome === 'unavailable') {
          setState({
            phase: 'degraded',
            session: result.session,
            why:
              result.reason === 'blocked'
                ? 'storage is locked by something else on this device.'
                : 'this device has no storage this app can use.',
          })
          return
        }
        // Asked once, on the launch where the store was empty and the answer
        // is free. `boot` writes the meta row that stops it being asked again.
        if (result.outcome === 'first-run') setFirstRun(true)
        setState({ phase: 'ready', session: result.session })
      } catch (e) {
        // `boot` is supposed to return rather than throw. If it ever does throw,
        // running in memory beats showing nothing — the records are gone either
        // way, and one of the two outcomes still lets someone use the app.
        kgWarn('boot threw; falling back to an in-memory session', { error: String(e) })
        if (!live) return
        setState({
          phase: 'degraded',
          session: bootInMemory({ now }),
          why: 'the store could not be opened at all.',
        })
      }
    })()

    return () => {
      live = false
    }
  }, [])

  if (state.phase === 'loading') return <Gate />

  // The boot phase in the shape the status context wants. `degraded` here is
  // this file's word for two of its arms, so it maps rather than passes through.
  const phase: StorePhase =
    state.phase === 'degraded'
      ? { phase: 'unavailable', reason: 'unsupported' }
      : { phase: 'ready', dataSet: state.session.repo.meta.dataSet, hydratedAt: Date.now() }

  return (
    <KgProvider repo={state.session.repo} now={now} host={nativeHost}>
      <StoreStatusProvider repo={state.session.repo} boot={phase}>
        {state.phase === 'degraded' ? <DegradedBanner why={state.why} /> : null}
        {children}
        {/* Inside the provider, because answering it runs a tool. */}
        {firstRun ? <FirstRunChoice onDone={() => setFirstRun(false)} /> : null}
      </StoreStatusProvider>
    </KgProvider>
  )
}

/**
 * What a cold start shows.
 *
 * The page colour and nothing else. The theme provider is above this, but the
 * palette is not worth threading through for a frame — `#0a0a0a` is the dark
 * page colour and the app opens dark, which is the same constant `App.tsx`
 * paints while the fonts load.
 */
function Gate() {
  return <View style={{ flex: 1, backgroundColor: '#0a0a0a' }} />
}

/**
 * Said once, at the top, and never dismissed.
 *
 * A failure to persist is not a toast: a toast is for something that happened
 * and is over, and this is a condition that holds for the rest of the session.
 * Every record made from here is lost on close, and the user is entitled to
 * know that before they spend an evening typing into it.
 */
function DegradedBanner({ why }: { why: string }) {
  return (
    <View
      style={{
        backgroundColor: '#3a1d1d',
        paddingHorizontal: space[4],
        paddingVertical: space[2.5],
      }}
    >
      <Txt size="xs" color="#ffb4b4">
        Not saving to this device — {why}
      </Txt>
    </View>
  )
}
