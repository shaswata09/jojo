import { ERROR_SITES, errorKind } from '@jojo/service/core/analytics'
import { report } from '@/lib/analytics'
import { crashEnabled, recordCrash } from '@/lib/crash-log'

export type ErrorSite = (typeof ERROR_SITES)[number]

/**
 * One call for everything that goes wrong, wherever it goes wrong.
 *
 * ## Why a single entry point
 *
 * There are three places an error can usefully end up on the web — the console,
 * the local crash log the Diagnostics panel reads, and an analytics event — and
 * before this every site picked its own subset. The render boundary wrote to
 * two of them, the unhandled-rejection handler wrote to one, and everything
 * else wrote to none. A site that has to remember three calls is a site that
 * remembers two.
 *
 * ## Why the analytics event matters more on web than on the phone
 *
 * THERE IS NO BROWSER CRASHLYTICS. `crash-log.ts` says so at length and keeps a
 * local ring buffer instead, which is genuinely useful — a person can read their
 * own crashes and quote one back — and is worth nothing to a maintainer, because
 * it never leaves the machine. The event is the only signal that does, and it is
 * the reason a bug affecting every Firefox user is now countable rather than
 * anecdotal.
 *
 * ## What travels
 *
 * A place and a class of error. Not the message, not the stack, not a component
 * name — `core/analytics.ts` has no parameter any of those could travel in, and
 * a test pins that. The full detail still goes to the console and to the local
 * log, which stay on the device.
 *
 * ## It never throws
 *
 * It runs inside error handlers. An exception here would replace the error being
 * reported with one from the reporter, which is how a small bug becomes an
 * unexplainable one.
 */
export function reportError(
  where: ErrorSite,
  thrown: unknown,
  options: { fatal?: boolean } = {},
): void {
  const fatal = options.fatal ?? false
  try {
    // The console first: it is the only one that survives reporting being off,
    // and it is what somebody debugging their own machine actually reads.
    console.error(`[jojo:${where}]`, thrown)
  } catch {
    /* A console that throws is not worth a second attempt. */
  }
  try {
    recordCrash(thrown, where, crashEnabled())
  } catch {
    /* `recordCrash` already swallows its own failures; this is belt and braces
       for the case where reading the preference is what broke. */
  }
  try {
    report('error_caught', { where, kind: errorKind(thrown), fatal })
  } catch {
    /* Reporting is best-effort by definition. */
  }
}
