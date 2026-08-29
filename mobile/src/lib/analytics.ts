import { isReportable, type AnalyticsEvent, type EventParams } from '@jojo/service/core/analytics'
import { CRASH_DEFAULTS, crashCapability, crashReportingOn } from '@jojo/service/core/crash-config'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { readOffered } from '@/lib/onboarding'
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
 * ## Half of that is not JavaScript's to decide, and lives in `firebase.json`
 *
 * `setAnalyticsCollectionEnabled(false)` below runs when Metro has evaluated
 * this module. The native SDK is initialised by a ContentProvider at PROCESS
 * start, well before that, and whatever it collects in the gap is collected
 * whatever this file later says. So the default has to be set where the SDK
 * reads it — at build time.
 *
 * `mobile/firebase.json` is that file, and there was none at all until this was
 * measured: `@react-native-firebase/app`'s `firebase-json.gradle` walks up from
 * `mobile/android` looking for it and, finding nothing, every dial below took
 * the SDK's own default of ON. A gradle run produced a build that collected by
 * default. What it now sets, and why — JSON takes no comments, so the reasons
 * are here:
 *
 *   analytics_auto_collection_enabled ....... false. The build-time twin of
 *       `setUp`; `setAnalyticsCollectionEnabled(true)` still turns it on when
 *       the user says yes, which is the whole point of using this key rather
 *       than `analytics_collection_deactivated` (that one is permanent and
 *       would make their yes do nothing — deliberately NOT set).
 *   app_data_collection_default_enabled ..... false. The SDK-wide version of the
 *       same question, which also covers Crashlytics and anything added later.
 *   google_analytics_automatic_screen_reporting_enabled ... false. A
 *       `screen_view` names a jojo screen, and `core/analytics.ts`'s list is
 *       supposed to be everything that can leave. This one cannot be changed at
 *       runtime, which is correct: jojo never wants it.
 *   google_analytics_adid_collection_enabled  false — the advertising id.
 *   google_analytics_ssaid_collection_enabled false — Settings.Secure.ANDROID_ID.
 *   analytics_idfv_collection_enabled ....... false — the iOS equivalent.
 *   analytics_default_allow_ad_storage,
 *   analytics_default_allow_ad_user_data,
 *   analytics_default_allow_ad_personalization_signals ... false. Three consent
 *       dials for advertising jojo does not do; `analytics_storage` is left
 *       alone, since denying it would disable the analytics the user agreed to.
 *
 * CHANGING THAT FILE NEEDS A REBUILD, not a reload: Android bakes it into
 * `BuildConfig.FIREBASE_JSON_RAW` at gradle time and iOS into `Info.plist` under
 * `firebase_json_raw` at `pod install` time. Metro never sees it.
 *
 * ## Nothing is on until the question has actually been ASKED
 *
 * `CRASH_DEFAULTS.enabled` is true, and it is the default for somebody who has
 * been asked and not answered — not for somebody who has never been asked.
 * Reading it as "unset means on" alone opted a fresh install in: measured on an
 * empty AsyncStorage, `analyticsEnabled()` returned true and `index.ts` sent
 * `app_opened` from a phone whose owner had not yet been shown `ReportingStep`.
 * `readOffered().reporting` is the missing half — the onboarding sequencer marks
 * that stage when the sheet is dismissed, however it is dismissed.
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
 * UNSET MEANS ON ONCE ASKED, and the two halves of that are the whole point.
 *
 * `=== 'on'` would make an unanswered question read as "no", which was the old
 * default. Only an explicit 'off' turns it off, so somebody who has never opened
 * Settings gets the default from `CRASH_DEFAULTS` and somebody who said no keeps
 * saying no across restarts. Reading it as `!== 'off'` rather than storing a
 * default on first launch means there is no migration and no moment where a
 * fresh install and a cleared storage disagree.
 *
 * The second half is newer and was a live defect. `CRASH_DEFAULTS.enabled` is
 * the answer to "they were asked and did not choose" — but on a fresh install
 * nobody has been asked yet, and this returned true anyway, which is reporting
 * before consent rather than a default. So an unset preference also needs the
 * reporting stage of onboarding to have been PUT to them.
 *
 * Deliberately not "onboarding finished": the stage is marked whenever
 * `ReportingStep` is dismissed, including by swiping it away, and the thing that
 * matters is that the question was on screen.
 */
export async function analyticsEnabled(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(ENABLED_KEY)
    if (stored !== null) return stored !== 'off'
    // The extra read only happens while there is no stored answer, which is
    // once per install: `ReportingStep` writes one on every exit path.
    return (await readOffered()).reporting && CRASH_DEFAULTS.enabled
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
