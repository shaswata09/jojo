import { isReportable, type AnalyticsEvent, type EventParams } from '@jojo/service/core/analytics'
import { CRASH_DEFAULTS, crashCapability, crashReportingOn } from '@jojo/service/core/crash-config'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { REPORTING } from '@/lib/reporting-config'

/**
 * Usage analytics on the phone, through Firebase Analytics.
 *
 * The web's twin is `web/src/lib/analytics.ts`, and both take their vocabulary
 * from `@jojo/service/core/analytics` — so an event means the same thing in the
 * console whichever app produced it, and neither can invent one.
 *
 * ## Automatic collection is turned OFF, and that is the load-bearing line
 *
 * Firebase Analytics collects on its own by default: screen views, session
 * starts, first opens, app updates. Left alone it would report a stream of
 * events nobody consented to and that jojo's own vocabulary does not describe —
 * and the setup dialog promises the opposite, in words, on screen. So collection
 * is disabled at startup and enabled only when somebody says yes, which is also
 * why `setUp` exists at all rather than this file being three functions.
 *
 * ## Every event still goes through the closed list
 *
 * `isReportable` is checked here, at the last point before the SDK, for the same
 * reason the web adapter checks it: a cast or a generic upstream is exactly how
 * a record would arrive. An event outside the vocabulary is dropped and
 * complained about rather than sent — the mistake is in the calling code, and
 * quietly sanitising it would hide the mistake while shipping the event.
 *
 * ## The SDK is optional at runtime
 *
 * Same bargain as `crash.ts`: a checkout without Firebase config files still
 * builds and runs, and this no-ops. `android/app/build.gradle` applies the
 * Google plugin only when `google-services.json` is there, so "installed but not
 * configured" is a real state a contributor will be in.
 */

const ENABLED_KEY = 'jojo/analytics/v1'

/**
 * What this build allows.
 *
 * `crashCapability` is reused because the question is identical — "does an
 * explicit yes appear in the config" — and two spellings of that would drift.
 * A separate flag from the crash one, because they are separate consents and a
 * build may reasonably ship one and not the other.
 */
export const ANALYTICS_CAPABILITY = crashCapability(REPORTING.analytics)

let resolved = false
let analytics: {
  logEvent: (name: string, params?: Record<string, unknown>) => Promise<void>
  setAnalyticsCollectionEnabled: (enabled: boolean) => Promise<void>
} | null = null

function nativeAnalytics() {
  if (resolved) return analytics
  resolved = true
  try {
    // `require`, not `import`: the point is that this may be absent, and a
    // static import is a build error where a runtime absence is wanted.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const mod = require('@react-native-firebase/analytics') as { default: () => unknown }
    analytics = mod.default() as typeof analytics
  } catch {
    analytics = null
  }
  return analytics
}

/** Whether usage reporting is on. Its own key: agreeing to crashes is not this. */
/*
 * UNSET MEANS ON, and the shape of this expression is the whole point.
 *
 * `=== 'on'` would make an unanswered question read as "no", which was the old
 * default. Now only an explicit 'off' turns it off, so somebody who has never
 * opened Settings gets the default from `CRASH_DEFAULTS` and somebody who said
 * no keeps saying no across restarts. Reading it as `!== 'off'` rather than
 * storing a default on first launch means there is no migration and no moment
 * where a fresh install and a cleared storage disagree.
 */
export async function analyticsEnabled(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(ENABLED_KEY)
    return stored === null ? CRASH_DEFAULTS.enabled : stored !== 'off'
  } catch {
    return false
  }
}

/**
 * Records the choice AND applies it to the SDK immediately.
 *
 * Both halves, because a stored preference the SDK has not been told about is a
 * switch that does nothing until the next launch — and the next launch is a long
 * time to keep collecting after somebody said stop.
 */
export async function setAnalyticsEnabled(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(ENABLED_KEY, on ? 'on' : 'off')
  } catch {
    /* a phone that cannot write its settings has a bigger problem */
  }
  await applyCollection(on)
}

/**
 * Called once at startup, before anything else can report.
 *
 * Turns Firebase's automatic collection OFF unless this build allows analytics
 * AND the user has already said yes. Ordering matters: the SDK starts collecting
 * as soon as it initialises, so this has to run early rather than when the first
 * event is sent.
 */
export async function setUp(): Promise<void> {
  await applyCollection(
    crashReportingOn(ANALYTICS_CAPABILITY, { enabled: await analyticsEnabled() }),
  )
}

async function applyCollection(on: boolean): Promise<void> {
  try {
    const native = nativeAnalytics()
    if (!native) return
    // Never enabled when the BUILD says no, whatever is stored.
    await native.setAnalyticsCollectionEnabled(ANALYTICS_CAPABILITY === 'allowed' && on)
  } catch {
    /* never let analytics break a launch */
  }
}

/**
 * Reports one thing that happened, if the user asked for that.
 *
 * NEVER THROWS and never rejects. Called from handlers and effects, where
 * analytics that can break a feature is worse than no analytics.
 */
export async function report<E extends AnalyticsEvent>(
  event: E,
  params: EventParams[E],
): Promise<void> {
  try {
    if (ANALYTICS_CAPABILITY !== 'allowed') return
    if (!(await analyticsEnabled())) return

    const payload = { event, params }
    if (!isReportable(payload)) {
      // Loud: this is a bug in the caller, and the vocabulary is the whole
      // safety story.
      console.warn('[jojo] refusing to report an event outside the vocabulary', event)
      return
    }
    await nativeAnalytics()?.logEvent(event, params)
  } catch {
    /* analytics must never take a feature down */
  }
}
