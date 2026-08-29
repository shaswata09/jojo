import {
  CRASH_KEPT,
  keepCrash,
  toCrashReport,
  type CrashReport,
} from '@jojo/service/core/crash'
import { CRASH_DEFAULTS, crashCapability, crashReportingOn } from '@jojo/service/core/crash-config'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { readOffered } from '@/lib/onboarding'
import { REPORTING } from '@/lib/reporting-config'

/**
 * Crash reporting on the phone, which is the only platform where Crashlytics
 * exists.
 *
 * Google ships Crashlytics for Apple platforms, Android, Flutter, Unity and the
 * Android NDK — and for nothing that runs in a browser. So this file is the one
 * place in jojo that can talk to it, and `web/src/lib/crash-log.ts` is the same
 * feature with a local sink instead. Both go through `core/crash.ts`, so a
 * report has the same shape and the same redaction wherever it was made.
 *
 * ## The native SDK is optional at RUNTIME, not just at build time
 *
 * `@react-native-firebase/crashlytics` needs a Firebase project and its config
 * files — `google-services.json`, `GoogleService-Info.plist` — checked into the
 * native projects. A checkout without them still has to build and run, because
 * most people working on jojo have no reason to hold its Firebase credentials,
 * and a debug build that dies at startup over a missing analytics file is a
 * hostile thing to hand a contributor.
 *
 * So the module is resolved lazily and its absence is a normal state, not an
 * error. `crashCapability` reads the build flag; this reads whether the SDK is
 * actually there; and the user's switch decides the rest. All three must say yes.
 *
 * ## Resolving the module used to install a SECOND, unredacted reporter
 *
 * `nativeCrashlytics()` looks like a lookup and is not. Constructing the module
 * runs `setGlobalErrorHandler(this.native)` and
 * `setOnUnhandledPromiseRejectionHandler(this.native)` as a constructor side
 * effect — `@react-native-firebase/crashlytics/lib/namespaced.ts:59-60` in the
 * 25.1.0 installed here — and the payload those build opens with the message
 * interpolated straight off the thrown error (`lib/handlers.ts:56`, in
 * `createNativeErrorObj`). Every argument below about `recordCrash` sending
 * only the redacted text was true and beside the point: the SDK had its own
 * path out, and it ran first.
 *
 * `mobile/firebase.json` closes it with
 * `crashlytics_is_error_generation_on_js_crash_enabled: false`. The handler is
 * still installed — it is a constructor, there is no way not to install it — but
 * with that flag off it generates no report and falls through to the previous
 * handler, which is `installLastResortHandlers`' chain and therefore
 * `recordCrash`. Chaining is left ON so that fall-through happens.
 *
 * The rejection half needs no flag on this app, and the reason is worth
 * recording because it is not obvious: that tracker patches the `promise`
 * npm polyfill's own class, and RN 0.81 on Hermes leaves `global.Promise` as
 * Hermes' native one (`Libraries/Core/polyfillPromise.js` only polyfills when
 * `HermesInternal.hasPromise()` is false). jojo's rejections are Hermes
 * promises, so they reach `HermesInternal.enablePromiseRejectionTracker` in
 * `lib/last-resort.ts` and nothing else. Turning Hermes off would silently
 * revive that path.
 *
 * ## What actually leaves the phone, stated because the app has to state it
 *
 * The redacted message and stack, plus whatever Crashlytics adds on its own:
 * per Google's own privacy documentation that is the device model, CPU
 * architecture, RAM and disk, the OS name and version, and a Crashlytics
 * installation UUID used to count how many people hit one crash. Retained by
 * Google for 90 days.
 *
 * It is NOT "no data about the user" and jojo must not say that it is. What is
 * true, and is what the screens say, is that no RECORD leaves: not an
 * application, a document, a note, a profile or a conversation, and not a key —
 * `core/crash.ts` strips those before a report exists, so there is nothing to
 * send even if a code path nobody thought about hands one over.
 *
 * ## It records locally as well, always
 *
 * Even with Crashlytics sending, the report is kept on the device — because the
 * person who hit the crash is the one who can describe it, and telling them "it
 * has been reported" while showing them nothing is how you get a bug report that
 * says "it crashed".
 */

const KEY = 'jojo/crashes/v1'
const ENABLED_KEY = 'jojo/crash-reporting/v1'

/**
 * What this build allows.
 *
 * From `lib/reporting-config.ts`, NOT an environment variable — React Native
 * has no mechanism that would inline one, which is exactly the bug that file
 * exists to have fixed. A build with it false cannot report whatever the
 * settings say, the same contract `VITE_CRASH_REPORTING` gives the web app.
 */
export const CRASH_CAPABILITY = crashCapability(REPORTING.crashes)

/**
 * The native module, or null.
 *
 * `require` rather than `import`, because the whole point is that this may not
 * be installed: a static import is a bundler error at build time, and what is
 * wanted is a runtime absence. Resolved once and remembered, including the
 * failure — retrying a missing module on every crash is a lot of work to
 * rediscover the same nothing.
 */
let resolved = false
let crashlytics: {
  recordError: (e: Error) => void
  log: (m: string) => void
  setCrashlyticsCollectionEnabled: (enabled: boolean) => Promise<void>
} | null = null

function nativeCrashlytics() {
  if (resolved) return crashlytics
  resolved = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const mod = require('@react-native-firebase/crashlytics') as { default: () => unknown }
    crashlytics = mod.default() as typeof crashlytics
  } catch {
    // Not installed, or installed without its config files. Both are fine.
    crashlytics = null
  }
  return crashlytics
}

/** Whether crash reporting is on. Read from storage; the default is below. */
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
 * The second half is newer and was a live defect, the same one as in
 * `lib/analytics.ts` and fixed the same way. `CRASH_DEFAULTS.enabled` answers
 * "they were asked and did not choose"; on a fresh install nobody has been asked
 * at all, and this returned true anyway — measured on an empty AsyncStorage,
 * `setUp` then handed the SDK a yes nobody had given. So an unset preference
 * also needs the reporting stage of onboarding to have been PUT to them.
 *
 * The stage is marked whenever `ReportingStep` is dismissed, however it is
 * dismissed, because what matters is that the question was on screen.
 */
export async function crashEnabled(): Promise<boolean> {
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

export async function setCrashEnabled(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(ENABLED_KEY, on ? 'on' : 'off')
  } catch {
    // A phone that cannot write its settings is a bigger problem than this one.
  }
  await applyCollection(on)
}

/**
 * Tells the native SDK what the answer is.
 *
 * THE NATIVE DEFAULT IS OFF ON EVERY LAUNCH, and this comment used to credit the
 * wrong file for it. jojo's own `AndroidManifest.xml` sets nothing of the sort —
 * grep it. The `firebase_crashlytics_collection_enabled=false` meta-data is
 * merged in from `@react-native-firebase/crashlytics`'s own manifest, and its
 * `ReactNativeFirebaseCrashlyticsInitProvider` then OVERWRITES it at process
 * start with `crashlytics_auto_collection_enabled` from `firebase.json` —
 * defaulting to TRUE when the key, or the file, is missing. There was no
 * `firebase.json` here at all, so the real behaviour was the opposite of what
 * this paragraph claimed: collection came up enabled before any JavaScript ran,
 * and a startup crash from somebody who had never been asked was sent.
 *
 * `firebase.json` now sets that key false, so the sentence is true again — and
 * it is what makes this call non-optional. Without it the switch in Settings
 * would write a preference the SDK never hears about, and crash reporting would
 * be permanently off however many times somebody turned it on.
 *
 * Called from `setUp` at launch as well as from the switch, because that native
 * default is re-applied on EVERY launch rather than only the first.
 */
async function applyCollection(on: boolean): Promise<void> {
  try {
    const native = nativeCrashlytics()
    if (!native) return
    // Never on when the BUILD says no, whatever is stored.
    await native.setCrashlyticsCollectionEnabled(CRASH_CAPABILITY === 'allowed' && on)
  } catch {
    /* never let the reporter break a launch */
  }
}

/**
 * Called once at startup, before anything can crash that we would want to send.
 *
 * The twin of `analytics.setUp`, and it exists for the same reason: a stored
 * "yes" that the SDK is never told about is a setting that does nothing.
 */
export async function setUp(): Promise<void> {
  await applyCollection(await crashEnabled())
}

export async function readCrashes(): Promise<CrashReport[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isReport).slice(0, CRASH_KEPT) : []
  } catch {
    return []
  }
}

const isReport = (v: unknown): v is CrashReport =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as CrashReport).id === 'string' &&
  typeof (v as CrashReport).at === 'string' &&
  typeof (v as CrashReport).where === 'string' &&
  typeof (v as CrashReport).message === 'string'

export async function clearCrashes(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '[]')
  } catch {
    /* nothing useful to do */
  }
}

/**
 * Records one crash: on the device always, and to Crashlytics if it is there.
 *
 * NEVER THROWS, and never rejects. It runs inside error handlers, where an
 * exception would replace the error being reported with one from the reporter.
 *
 * The REDACTED message is what goes to Crashlytics, not the original — the
 * redaction in `core/crash.ts` is the whole reason this is safe to send, so
 * sending the raw error would defeat it in one line.
 */
export async function recordCrash(thrown: unknown, where: string): Promise<boolean> {
  try {
    if (CRASH_CAPABILITY !== 'allowed') return false
    if (!crashReportingOn(CRASH_CAPABILITY, { enabled: await crashEnabled() })) return false

    const report = toCrashReport(thrown, where, new Date().toISOString(), newId())

    try {
      const kept = keepCrash(await readCrashes(), report)
      await AsyncStorage.setItem(KEY, JSON.stringify(kept))
    } catch {
      // Storage failed; still worth sending.
    }

    const native = nativeCrashlytics()
    if (native) {
      // A fresh Error carrying the REDACTED text. Passing the original would
      // hand Crashlytics the message this whole file exists to clean.
      const safe = new Error(report.message)
      if (report.stack) safe.stack = report.stack
      native.log(`where: ${report.where}`)
      native.recordError(safe)
    }
    return true
  } catch {
    return false
  }
}

function newId(): string {
  return `crash-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}
