import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { FirstRunChoice } from '@/components/common/FirstRunChoice'
import { Onboarding } from '@/components/common/Onboarding'
import { Txt } from '@/components/ui/Text'
import { kgWarn } from '@jojo/service/log'
import { KgProvider } from '@jojo/service/react/kg'
import { StoreStatusProvider } from '@jojo/service/react/status'
import { boot } from '@jojo/service/repo/boot'
import { stateFor, stateForThrow } from '@/lib/boot-state'
import type { StoreState } from '@/lib/boot-state'
import { createRnDriver } from '@/kg/storage/rn-driver'
import { nativeHost } from '@/lib/host'
import { now } from '@/lib/today'
import { space } from '@/theme/tokens'
import { ProfileUpdateOffer } from '@/components/profile/ProfileUpdateOffer'

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
 * - **degraded** — storage refused, or the rows on it could not be read. The app
 *   still runs, on an EMPTY in-memory session, and says so. `boot()` returns a
 *   working session even when the durable path failed precisely so this decision
 *   belongs here rather than being forced by a throw.
 *
 * Which of the two the last one is, and what the stand-in contains, is
 * `lib/boot-state.ts`. It went there because it was wrong here and unrunnable
 * here: the stand-in was `bootInMemory({ now })`, whose `dataSet` defaults to
 * 'demo', so a phone whose store could not be read opened on twelve fabricated
 * applications with nothing but a red line saying they would not be saved.
 *
 * `now` is the wall clock, injected because no module under `@jojo/service` may read
 * one. `src/lib` is the layer allowed a platform API — which is why the driver,
 * the host and the clock are all named in this file and nowhere else.
 */

/**
 * `why` carries the degraded arm; it is null exactly when the store opened.
 *
 * It used to be a third variant, and the two failing arms of it both handed back
 * `bootInMemory({ now })` — which SEEDS THE DEMO FIXTURES. See `lib/boot-state`
 * for what that put on screen and why the reading now lives there.
 */
type State = { phase: 'loading' } | ({ phase: 'open' } & StoreState)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  // Boot once per process. React 19 in dev mounts effects twice, and a second
  // boot would open a second driver over the same file.
  const started = useRef(false)
  const [firstRun, setFirstRun] = useState(false)
  /*
   * Whether this session STARTED with the fork, which is not the same as
   * `firstRun` and outlives it: `firstRun` flips false the moment the fork is
   * answered, and onboarding needs to know it was a first run for the rest of
   * the session. Without it the details sheet reads the seeded demo profile,
   * finds the seeded applicant's name in it, decides the user has already told us who they
   * are, and skips itself for exactly the person it exists for.
   */
  const [fresh, setFresh] = useState(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    let live = true

    void (async () => {
      try {
        const result = await boot({ now, driver: createRnDriver() })
        if (!live) return
        const next = stateFor(result, now)
        if (next.firstRun) setFirstRun(true)
        setState({ phase: 'open', ...next })
      } catch (e) {
        // `boot` is supposed to return rather than throw. If it ever does throw,
        // running in memory beats showing nothing — the records are gone either
        // way, and one of the two outcomes still lets someone use the app. The
        // error goes to the log and not to the banner: a stack trace is not a
        // sentence anybody can act on.
        kgWarn('boot threw; falling back to an in-memory session', { error: String(e) })
        if (!live) return
        setState({ phase: 'open', ...stateForThrow(now) })
      }
    })()

    return () => {
      live = false
    }
  }, [])

  if (state.phase === 'loading') return <Gate />

  return (
    <KgProvider repo={state.session.repo} now={now} host={nativeHost}>
      {/* `state.status` is the boot phase in the shape the status context wants,
          and it now has one arm per outcome. It used to be computed here and
          flattened: every failure was reported as `unavailable/unsupported`,
          including a corrupt store and a database another app had locked. */}
      <StoreStatusProvider repo={state.session.repo} boot={state.status}>
        {state.why === null ? null : <DegradedBanner why={state.why} />}
        {/* Beside the degraded banner and for the same reason: it has to be
            askable from wherever the person happened to file the document, and
            it must not be a sheet — filing usually happens from inside one, and
            two sheets at once on a phone means the second is invisible. Inside
            the provider, because answering it runs a tool. Renders nothing when
            there is nothing newly readable, which is almost always. */}
        <ProfileUpdateOffer />
        {children}
        {/* Inside the provider, because answering it runs a tool. */}
        {firstRun ? (
          <FirstRunChoice
            onDone={() => {
              setFirstRun(false)
              setFresh(true)
            }}
          />
        ) : (
          /* Only once the fork is answered: two sheets at once on a phone means
             the second one is simply invisible. See `Onboarding`'s header. */
          <Onboarding fresh={fresh} />
        )}
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
