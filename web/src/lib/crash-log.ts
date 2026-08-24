import {
  CRASH_KEPT,
  keepCrash,
  toCrashReport,
  type CrashReport,
} from '@jojo/service/core/crash'
import { CRASH_DEFAULTS, crashCapability, crashReportingOn } from '@jojo/service/core/crash-config'
import { readStored, writeStored } from '@/lib/storage'

/**
 * Crash reporting for the web app, which keeps everything on the device.
 *
 * WHY THERE IS NO CRASHLYTICS HERE. There is no browser Crashlytics to add:
 * Google ships it for Apple platforms, Android, Flutter, Unity and the Android
 * NDK, and for nothing that runs in a page. So the honest web answer is not a
 * different vendor — it is the same report, kept where the records already are.
 * A crash the user can read and quote is most of the value of a crash reporter
 * and costs none of the promise.
 *
 * OUTSIDE THE GRAPH, deliberately, for the reason `ModelServer.apiKey` is:
 * `core/backup.ts` serialises nodes, edges and documents, so anything modelled
 * as a node travels in every export and every Transfer. A stack trace is exactly
 * the kind of thing somebody would be surprised to find in a file they mailed to
 * a friend. It lives under its own storage key, beside the settings.
 *
 * REDACTED ON THE WAY IN. `core/crash.ts` strips keys, query strings, home
 * directories and email addresses before a report exists, so a report that never
 * held a credential cannot leak one later — including through this file's own
 * `read`, which is what Diagnostics renders.
 */

const KEY = 'jojo/crashes/v1'

/**
 * The user's answer, in its own key.
 *
 * Not folded into the model settings document: that one is rewritten on every
 * keystroke in the endpoint field, and a consent flag has no business sharing a
 * write path with something that noisy. Its own key also means a settings
 * document this build cannot parse cannot take the consent with it — the same
 * argument `model-settings.tsx` makes for splitting the saved-server list out.
 */
const ENABLED_KEY = 'jojo/crash-reporting/v1'

/** Whether the user has opted in. Off unless the stored value says otherwise. */
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
export function crashEnabled(): boolean {
  const stored = readStored(ENABLED_KEY)
  return stored === null || stored === undefined || stored === ''
    ? CRASH_DEFAULTS.enabled
    : stored !== 'off'
}

export function setCrashEnabled(on: boolean): void {
  writeStored(ENABLED_KEY, on ? 'on' : 'off')
}

/**
 * The build's answer, read once.
 *
 * `VITE_CRASH_REPORTING` is a build-time variable, so a copy of jojo built
 * without it cannot report however the settings are edited — see
 * `core/crash-config.ts` for why a build may only ever take away.
 *
 * Unset means off, which is the default for every ordinary `npm run build`.
 */
export const CRASH_CAPABILITY = crashCapability(
  import.meta.env['VITE_CRASH_REPORTING'] as string | undefined,
)

/** Every kept report, newest first. Empty when storage is unavailable. */
export function readCrashes(): CrashReport[] {
  const raw = readStored(KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    // Filtered rather than cast, like `readServers`: one malformed entry must
    // not take the whole list down on a screen people go to when things break.
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

export function clearCrashes(): void {
  writeStored(KEY, '[]')
}

/**
 * Records one crash, if the user asked for that.
 *
 * NEVER THROWS. It runs inside error handlers — an exception here would replace
 * the error being reported with one from the reporter, which is how a small bug
 * becomes an unexplainable one.
 *
 * Returns whether anything was kept, so a caller can tell "reporting is off"
 * from "reporting failed", which are different things to say to a user.
 */
export function recordCrash(
  thrown: unknown,
  where: string,
  enabled: boolean,
): boolean {
  try {
    if (!crashReportingOn(CRASH_CAPABILITY, { enabled })) return false
    const report = toCrashReport(thrown, where, new Date().toISOString(), newId())
    writeStored(KEY, JSON.stringify(keepCrash(readCrashes(), report)))
    return true
  } catch {
    return false
  }
}

/**
 * An id for a report, from the clock and a little randomness.
 *
 * Not `core/ref.ts`'s minter: that is for records that live in the graph and
 * must be stable across devices. This one is only a React key and something a
 * person can quote back, and it must work in a handler that is already failing.
 */
function newId(): string {
  const now = Date.now().toString(36)
  const salt = Math.floor(Math.random() * 1e6).toString(36)
  return `crash-${now}-${salt}`
}

/**
 * Catches what React cannot: a throw outside a component, and a rejected promise
 * nobody awaited.
 *
 * An error boundary only sees errors thrown during render. Most of what actually
 * breaks in this app happens somewhere else — a storage write, an agent turn, a
 * fetch handler — so without these two listeners a crash reporter would report
 * the minority of crashes and quietly imply it had seen them all.
 *
 * `enabled` is read through a getter rather than passed by value, because these
 * listeners are installed once at startup and the setting changes later.
 */
export function listenForCrashes(enabled: () => boolean): () => void {
  const onError = (event: ErrorEvent) => {
    recordCrash(event.error ?? event.message, 'window', enabled())
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    recordCrash(event.reason, 'promise', enabled())
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
