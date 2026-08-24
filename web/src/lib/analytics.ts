import { isReportable, type AnalyticsEvent, type EventParams } from '@jojo/service/core/analytics'
import { CRASH_DEFAULTS, crashCapability, crashReportingOn } from '@jojo/service/core/crash-config'
import { readStored, writeStored } from '@/lib/storage'

/**
 * Usage analytics for the web app, through the Firebase JavaScript SDK.
 *
 * ## What is NOT here: Crashlytics
 *
 * Google ships Crashlytics for Apple platforms, Android, Flutter, Unity and the
 * Android NDK, and for nothing that runs in a page. `firebase/analytics` is the
 * only half of the pair a browser gets, so web crash reports stay on the device
 * — see `web/src/lib/crash-log.ts`, which is a separate file for that reason
 * rather than by accident.
 *
 * ## The SDK is loaded lazily, and that is load-bearing twice over
 *
 * `import('firebase/app')` inside a function rather than at the top. A static
 * import puts the whole SDK in the entry chunk of an app that boots offline and
 * is frequently used with no network at all; dynamic, it becomes its own chunk
 * fetched the first time an event is actually reported — so a build with no
 * Firebase config, or a person who has turned analytics off, downloads none of
 * it.
 *
 * The second reason is ordering: the request to Google's servers IS the thing
 * being consented to, so firing it before the answer is known would make the
 * answer cosmetic.
 *
 * This replaced a hand-rolled gtag loader. Firebase Analytics on the web is
 * gtag underneath either way, but the SDK brings `isSupported()` — see
 * `ensureLoaded` — and one less place for jojo to be wrong about Google's own
 * bootstrap.
 *
 * ## Nothing is sent that this app did not declare
 *
 * `core/analytics.ts` holds the whole vocabulary and `isReportable` is checked
 * again HERE, at the last point before the wire, because a cast or a generic
 * upstream is exactly how a record would arrive. An event that fails is dropped
 * and complained about on the console rather than sent — the mistake is in the
 * calling code, and sending a sanitised version would hide it.
 */

/**
 * The Firebase web config, from the build.
 *
 * These values are NOT secret, and Google documents them as such: every one of
 * them ships inside the JavaScript bundle of any Firebase web app, where anybody
 * can read them out. `apiKey` is an identifier for a Firebase project rather
 * than a credential — it authorises nothing on its own, and what guards a
 * Firebase BACKEND is its security rules, of which jojo has none because it has
 * no backend.
 *
 * They live in environment variables anyway, for a different reason: so that a
 * fork's deploy does not report ITS traffic into THIS project's console. Same
 * reasoning that keeps `google-services.json` out of the repository.
 */
const FIREBASE_CONFIG = {
  apiKey: env('VITE_FIREBASE_API_KEY'),
  authDomain: env('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: env('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: env('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: env('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: env('VITE_FIREBASE_APP_ID'),
  measurementId: env('VITE_ANALYTICS_ID'),
}

function env(name: string): string {
  return ((import.meta.env[name] as string | undefined) ?? '').trim()
}

/**
 * What this build allows, on the same terms as crash reporting.
 *
 * Three things must agree: the build flag, an app id, and a measurement id.
 * `measurementId` is the one people forget — Firebase initialises happily
 * without it and then reports nothing, which looks exactly like analytics
 * working and nobody using the app.
 *
 * `crashCapability` is reused because the question is identical — "does an
 * explicit yes appear in the config" — and two spellings of that would drift.
 */
export const ANALYTICS_CAPABILITY =
  FIREBASE_CONFIG.appId.length > 0 && FIREBASE_CONFIG.measurementId.length > 0
    ? crashCapability(import.meta.env['VITE_ANALYTICS'] as string | undefined)
    : ('off' as const)

const ENABLED_KEY = 'jojo/analytics/v1'

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
/** Whether usage reporting is on. Its own key: agreeing to crashes is not this. */
export function analyticsEnabled(): boolean {
  const stored = readStored(ENABLED_KEY)
  return stored === null || stored === undefined || stored === ''
    ? CRASH_DEFAULTS.enabled
    : stored !== 'off'
}

export function setAnalyticsEnabled(on: boolean): void {
  writeStored(ENABLED_KEY, on ? 'on' : 'off')
  /*
   * Told to the SDK immediately, not at the next page load.
   *
   * Once loaded, the SDK keeps reporting page views of its own accord; a stored
   * preference it has not been told about is a switch that appears to work and
   * does not. Only reaches the SDK when it was ALREADY loaded — turning
   * analytics off must never be the thing that fetches it.
   */
  if (loaded) void applyCollection(on)
}

/** Whether anything would actually be sent right now. */
export function analyticsOn(): boolean {
  return crashReportingOn(ANALYTICS_CAPABILITY, { enabled: analyticsEnabled() })
}

/* ------------------------------- the transport ---------------------------- */

type FirebaseAnalytics = import('firebase/analytics').Analytics

let loading: Promise<FirebaseAnalytics | null> | null = null
let loaded: FirebaseAnalytics | null = null

/**
 * Initialises Firebase once, and only when something is actually being reported.
 *
 * `isSupported()` is checked because `getAnalytics` throws outright where
 * IndexedDB or cookies are unavailable — a private window in some browsers, an
 * embedded webview, a sandboxed iframe. jojo runs in all three, and an analytics
 * call that takes the page down is a far worse outcome than a missing statistic.
 */
async function ensureLoaded(): Promise<FirebaseAnalytics | null> {
  if (loading) return loading
  loading = (async () => {
    try {
      const [app, analyticsSdk] = await Promise.all([
        import('firebase/app'),
        import('firebase/analytics'),
      ])
      if (!(await analyticsSdk.isSupported())) return null

      // `getApps()` first: React's StrictMode double-invokes effects in
      // development, and initialising a second app with the same name warns.
      const firebaseApp = app.getApps()[0] ?? app.initializeApp(FIREBASE_CONFIG)
      const analytics = analyticsSdk.getAnalytics(firebaseApp)
      // Applied here as well as in the setter, because the SDK starts
      // collecting the moment `getAnalytics` returns — and this can be reached
      // by a report that raced the switch being turned off.
      analyticsSdk.setAnalyticsCollectionEnabled(analytics, analyticsEnabled())
      loaded = analytics
      return analytics
    } catch {
      // A blocked request, an offline first load, an extension that eats
      // Google's domains. None of them is jojo's problem to solve and none of
      // them may break a feature.
      return null
    }
  })()
  return loading
}

async function applyCollection(on: boolean): Promise<void> {
  try {
    const analytics = loaded
    if (!analytics) return
    const { setAnalyticsCollectionEnabled } = await import('firebase/analytics')
    setAnalyticsCollectionEnabled(analytics, ANALYTICS_CAPABILITY === 'allowed' && on)
  } catch {
    /* analytics must never take a feature down */
  }
}

/**
 * Reports one thing that happened, unless the user has turned that off.
 *
 * NEVER THROWS and never rejects. It is called from click handlers and effects,
 * and analytics that can break a feature is worse than no analytics.
 *
 * Typed so the parameters must match the event: `report('screen_viewed', {...})`
 * will not compile with the wrong shape, and `isReportable` catches the rest.
 */
export function report<E extends AnalyticsEvent>(event: E, params: EventParams[E]): void {
  try {
    if (!analyticsOn()) return
    const payload = { event, params }
    if (!isReportable(payload)) {
      // Loud, because this is a bug in the caller: something outside the
      // vocabulary was passed, and the vocabulary is the whole safety story.
      console.warn('[jojo] refusing to report an event outside the vocabulary', event)
      return
    }
    void ensureLoaded().then(async (analytics) => {
      if (!analytics) return
      const { logEvent } = await import('firebase/analytics')
      // Re-checked after the await: loading the SDK is a network round trip,
      // and the switch can be turned off during it.
      if (analyticsOn()) logEvent(analytics, event, params)
    })
  } catch {
    /* analytics must never take a feature down */
  }
}
