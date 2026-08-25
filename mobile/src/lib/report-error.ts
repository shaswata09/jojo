import { ERROR_SITES, errorKind } from '@jojo/service/core/analytics'
import { report } from '@/lib/analytics'
import { recordCrash } from '@/lib/crash'

export type ErrorSite = (typeof ERROR_SITES)[number]

/**
 * One call for everything that goes wrong. The phone's half of
 * `web/src/lib/report-error.ts`, and deliberately the same shape.
 *
 * ## The two destinations, and why both
 *
 * CRASHLYTICS takes the error itself — a redacted message and a stack, which is
 * what tells somebody how to fix a bug. `recordCrash` does the redaction; see
 * `core/crash.ts` for what it removes and why sending the raw error would
 * defeat the whole arrangement in one line.
 *
 * ANALYTICS takes a place and a class, and nothing else. That looks redundant
 * beside Crashlytics and is not: a crash report answers "what broke", and a
 * counted event answers "how often, and is it getting worse" — and the same
 * event exists on web, where there is no Crashlytics at all, so the two
 * platforms are finally comparable.
 *
 * ## Fire and forget, and never throws
 *
 * Both destinations are async and neither is awaited: this runs inside error
 * handlers, and an error handler that waits on the network is one that turns a
 * caught bug into a frozen screen. Every path is wrapped, because an exception
 * here would replace the error being reported with one from the reporter.
 */
export function reportError(
  where: ErrorSite,
  thrown: unknown,
  options: { fatal?: boolean } = {},
): void {
  const fatal = options.fatal ?? false
  try {
    // `adb logcat` is how a bug report from a real device gets its stack, and it
    // is the only destination that works with reporting switched off.
    console.error(`[jojo:${where}]`, thrown)
  } catch {
    /* A console that throws is not worth a second attempt. */
  }
  try {
    void recordCrash(thrown, where).catch(() => {
      /* Already swallows its own failures; this catches a rejected promise. */
    })
  } catch {
    /* Synchronous throw before the promise existed. */
  }
  try {
    void report('error_caught', { where, kind: errorKind(thrown), fatal }).catch(() => {
      /* Reporting is best-effort by definition. */
    })
  } catch {
    /* As above. */
  }
}
