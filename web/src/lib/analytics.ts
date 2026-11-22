import { isReportable, type AnalyticsEvent, type EventParams } from '@jojo/service/core/analytics'
import { CRASH_DEFAULTS, crashCapability, crashReportingOn } from '@jojo/service/core/crash-config'
import { wasOffered } from '@/lib/onboarding'
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
 * UNSET MEANS THE DEFAULT, and the default is NO.
 *
 * Only a stored 'on' or 'off' is an answer. Anything else — nothing stored, an
 * empty string — falls through to `CRASH_DEFAULTS.enabled`, which is false
 * since the owner reversed it on 2026-11-21 (pre-ticked boxes are not consent;
 * see `core/crash-config.ts`). Reading the stored value as `!== 'off'` is
 * unchanged, so somebody who answered keeps exactly the answer they gave, and
 * there is still no migration and no first-launch write.
 */
/** Whether usage reporting is on. Its own key: agreeing to crashes is not this. */
export function analyticsEnabled(): boolean {
  const stored = readStored(ENABLED_KEY)
  if (stored !== null && stored !== undefined && stored !== '') return stored !== 'off'

  /*
   * Nothing stored means one of two things, and they are not the same: the
   * person declined and we wrote 'off' (handled above), or they have NOT BEEN
   * ASKED YET.
   *
   * This used to return `CRASH_DEFAULTS.enabled` — then true — for the unasked
   * case, and `main.tsx` reports `app_opened` at module scope before React even
   * mounts. So a first-run user in the EU was reported to Google before the
   * reporting question had been drawn on screen. `wasOffered('crash')` is the
   * one fact that separates "asked" from "not asked", and it stays even now
   * the default is off: it is what keeps a future flip of the default from
   * reporting before the question exists, which was a bug whatever the policy.
   *
   * It is also why `Onboarding` must not mark the stage offered when it asked
   * nothing (a build with both capabilities off). That silent mark, plus a
   * later build that turned analytics on, read here as "asked, and took the
   * default" — consent from a dialog that was never drawn.
   */
  return wasOffered('crash') && CRASH_DEFAULTS.enabled
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
  // Off also means forgotten: see `forgetAnalyticsIdentity`.
  if (!on) forgetAnalyticsIdentity()
}

/**
 * Another tab turned the switch: tell THIS tab's SDK too (review 3, multitab-1).
 *
 * `setAnalyticsEnabled` reaches only the SDK loaded in the tab it ran in. jojo's
 * own `report()` re-reads the stored answer every time, so it stopped in every
 * tab — but an SDK already loaded in another tab kept collection on, kept
 * sending what it sends of its own accord, and wrote `_ga` straight back after
 * the first tab had forgotten it. A switch that appears to work and does not,
 * which is what the setter's own comment warns about.
 *
 * `key` is the `StorageEvent`'s: null when the whole of storage was cleared,
 * which takes the answer with it. The two effects are parameters so a test can
 * watch them; the defaults are the page's.
 */
export function followAnalyticsSwitch(
  key: string | null,
  apply: (on: boolean) => void = (on) => {
    // Only an SDK this tab already loaded: another tab's "off" must never be
    // the thing that fetches it here.
    if (loaded) void applyCollection(on)
  },
  forget: () => void = () => {
    forgetAnalyticsIdentity()
  },
): void {
  if (key !== ENABLED_KEY && key !== null) return
  const on = analyticsEnabled()
  apply(on)
  if (!on) forget()
}

// Once per page, for the life of the page, like the SDK it governs.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    followAnalyticsSwitch(event.key)
  })
}

/**
 * The SDK's identifiers for this browser, as it leaves them.
 *
 * GA keeps a client id in `_ga` and a session in `_ga_<measurement id>` (and
 * `_gid` in older tags); Firebase keeps an installation id and a heartbeat log
 * in two IndexedDB databases of its own. Turning analytics off stopped new
 * reports but left all of them, so a person who said no still carried the id
 * that their earlier reports were filed under.
 */
export const ANALYTICS_LEFTOVERS = {
  cookie: /^_ga(?:_|$)|^_gid$/,
  databases: ['firebase-installations-database', 'firebase-heartbeat-database'],
} as const

type Leftovers = {
  readCookies: () => string
  writeCookie: (line: string) => void
  hostname: string
  deleteDatabase: (name: string) => void
}

const browserLeftovers = (): Leftovers | null =>
  typeof document === 'undefined'
    ? null
    : {
        readCookies: () => document.cookie,
        writeCookie: (line) => {
          document.cookie = line
        },
        hostname: location.hostname,
        deleteDatabase: (name) => {
          indexedDB.deleteDatabase(name)
        },
      }

/**
 * Deletes what `ANALYTICS_LEFTOVERS` names. Local only: nothing is sent.
 *
 * Each cookie is expired on this host and on every parent domain, because gtag
 * writes it on the widest domain it is allowed to and a cookie only expires
 * under the domain it was set on. A database the loaded SDK still holds open
 * is deleted when the page closes — `deleteDatabase` waits, it does not fail.
 */
export function forgetAnalyticsIdentity(env: Leftovers | null = browserLeftovers()): void {
  if (env === null) return
  try {
    const labels = env.hostname.split('.')
    const domains = [
      '',
      ...labels.slice(0, -1).map((_, i) => `; domain=.${labels.slice(i).join('.')}`),
    ]
    for (const pair of env.readCookies().split(';')) {
      const name = pair.split('=')[0]?.trim() ?? ''
      if (!ANALYTICS_LEFTOVERS.cookie.test(name)) continue
      for (const domain of domains) {
        env.writeCookie(`${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`)
      }
    }
  } catch {
    /* document.cookie throws in a sandboxed frame */
  }
  for (const name of ANALYTICS_LEFTOVERS.databases) {
    try {
      env.deleteDatabase(name)
    } catch {
      /* no IndexedDB here, so nothing was kept in it */
    }
  }
}

/** Whether anything would actually be sent right now. */
export function analyticsOn(): boolean {
  return crashReportingOn(ANALYTICS_CAPABILITY, { enabled: analyticsEnabled() })
}

/* ------------------------------- the transport ---------------------------- */

type FirebaseAnalytics = import('firebase/analytics').Analytics

/**
 * What `getAnalytics` must be told, and why the closed vocabulary is not enough
 * on its own.
 *
 * `core/analytics.ts` declares every event jojo may report, every parameter is a
 * number or a value from a closed set, and `analytics.test.ts` asserts that over
 * the whole table so an `employer` cannot be added without a test going red.
 * All of that governs the events jojo WRITES. It says nothing about the ones the
 * SDK sends by itself.
 *
 * And it sends one. `@firebase/analytics` issues a gtag `config` on
 * initialisation, and its own source carries the note: "This will trigger a
 * page_view event unless 'send_page_view' is set to false in configProperties"
 * (dist/index.cjs.js:889, where `configProperties = options?.config ?? {}`).
 * `getAnalytics(firebaseApp)` passed no options, so the default applied — and a
 * GA4 `page_view` carries `page_location`, the full URL.
 *
 * jojo's URLs are not opaque. `linksOf`/`addressOf` build
 * `/applications/<slug>` where the slug is minted from the employer name the
 * user typed. So opening an application sent that employer to a vendor's
 * console, which is the exact sentence `core/analytics.ts` opens with as the
 * thing it exists to prevent. The suite was green throughout, because no test
 * can see an event jojo does not write.
 *
 * `page_location` and `page_referrer` are pinned as well as the event being
 * turned off. Disabling `page_view` stops the automatic EVENT; gtag still
 * attaches the current location to subsequent events unless the config
 * overrides it, and jojo reports events from every screen. The origin alone is
 * what a vendor gets — no path, no query, no record.
 */
/*
 * …and the advertising half of Google Analytics, which jojo has no use for.
 *
 * `allow_google_signals` is what joins a GA client id to the visitor's signed-in
 * Google account, for cross-device reports and demographics; it is on whenever
 * the property has it enabled in the console, and the property's console is not
 * something a reader of this repository can check. `allow_ad_personalization_
 * signals` is what lets the data feed ad personalisation. A person who agreed
 * to "counts of which screens are opened" agreed to neither, so both are turned
 * off here, in the code, where the claim can be read and a test can pin it —
 * rather than in a console setting that a property owner can flip back.
 */
export const ANALYTICS_INIT = {
  config: {
    send_page_view: false,
    page_location: typeof location === 'undefined' ? '' : location.origin,
    page_referrer: '',
    page_title: 'jojo',
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  },
} as const

/**
 * Google consent mode, set to "denied" for every advertising purpose.
 *
 * Handed to `setConsent` BEFORE `initializeAnalytics`, because that is the
 * order in which it is a DEFAULT: the SDK keeps a settings object passed
 * before initialisation and issues `gtag('consent', 'default', …)` ahead of
 * its first `config` (`@firebase/analytics` `_setConsentDefaultForInit`, read
 * in `initializeAnalyticsInternal`). Called after, it is an `update` — which
 * arrives after the config call has already gone out with the SDK's own
 * default of "granted" for every type.
 *
 * `analytics_storage` is deliberately absent. It is the one jojo asked for —
 * the usage switch IS consent to it — and denying it would turn the switch the
 * person moved into a switch that does nothing. Everything listed here is
 * advertising, which jojo does not do and nobody was asked about.
 */
export const ANALYTICS_CONSENT = {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
} as const

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
      // Before initialising, so it is the consent DEFAULT — see ANALYTICS_CONSENT.
      analyticsSdk.setConsent(ANALYTICS_CONSENT)
      /*
       * `initializeAnalytics`, not `getAnalytics`. They differ in exactly one
       * way that matters: only the first takes settings, and `getAnalytics`
       * therefore cannot turn the automatic `page_view` off. See ANALYTICS_INIT.
       */
      const analytics = analyticsSdk.initializeAnalytics(firebaseApp, ANALYTICS_INIT)
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
