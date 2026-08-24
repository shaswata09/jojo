import {
  CRASH_KEPT,
  keepCrash,
  toCrashReport,
  type CrashReport,
} from '@jojo/service/core/crash'
import { crashCapability, crashReportingOn } from '@jojo/service/core/crash-config'
import AsyncStorage from '@react-native-async-storage/async-storage'

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
 * `process.env.CRASH_REPORTING` is inlined by the RN bundler at build time, so
 * a build made without it cannot report whatever the settings say — the same
 * contract `VITE_CRASH_REPORTING` gives the web app.
 */
export const CRASH_CAPABILITY = crashCapability(process.env['CRASH_REPORTING'])

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
let crashlytics: { recordError: (e: Error) => void; log: (m: string) => void } | null = null

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

/** Whether the user has opted in. Read from storage; off unless it says on. */
export async function crashEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ENABLED_KEY)) === 'on'
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
