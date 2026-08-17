/**
 * L0 — a thrown DOMException, as one of the four `StorageFailureCode`s.
 *
 * Split out of `idb-driver.ts`: every driver entry point ends in a `catch` that
 * calls `classify`, so this is the one place that decides whether a failure is
 * retried, reported as full, or escalated to the recovery panel. It knows
 * nothing about `idb` or about IndexedDB handles — it reads a caught value and
 * returns a `DriverResult`, which is why the write queue's own backstop
 * (`commitGuarded` in `kg/repo/queue.ts`, for a driver that throws instead of
 * returning) routes through it rather than inventing a second mapping.
 */

import { driverFail } from './driver'
import type { DriverResult, StorageFailureCode } from './driver'

/**
 * The DOMException name, through whatever it was wrapped in.
 *
 * `tx.done` rejects with the transaction's error, but a quota failure in Chrome
 * arrives as an `AbortError` whose `cause` is the `QuotaExceededError` — and
 * reporting that as a generic abort is how "there is no room left" turns into a
 * retry loop that can never succeed. `TERMINAL` in `kg/repo/queue.ts` stops the
 * queue on quota, blocked and corrupt, and retries only `unavailable`, so a
 * failure misread as the last of those does not produce a wrong message, it
 * produces an infinite one.
 */
function errorName(e: unknown): string {
  if (typeof e !== 'object' || e === null) return ''
  const error = e as { name?: unknown; cause?: unknown }
  if (typeof error.name === 'string' && error.name !== 'AbortError') return error.name
  if (error.cause !== undefined && error.cause !== e) {
    const inner = errorName(error.cause)
    if (inner) return inner
  }
  return typeof error.name === 'string' ? error.name : ''
}

export const messageOf = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : String(e)

/**
 * A thrown DOMException, as one of the four codes the app knows how to answer.
 *
 * Every arm is a recovery the user can be told about, which is why the default
 * is `unavailable` rather than `corrupt`: "we could not reach storage" invites a
 * retry, "your data could not be read" invites the recovery panel, and guessing
 * the second when it was the first would offer to start somebody fresh over a
 * transient failure.
 *
 * That default carries more weight than it used to. `unavailable` is now the
 * ONLY code the write queue retries — the other three stop it — so a
 * deterministic failure misclassified as `unavailable` is a queue that retries
 * it forever, and a transient one misclassified as `corrupt` is persistence
 * switched off over a blip. The three names in the `corrupt` arm below are
 * there because each is decided by the bytes of the row being written and never
 * by the weather: a unique-index collision, an invalid key, and a value the
 * structured clone algorithm refuses.
 */
export function classify<T>(e: unknown, what: string): DriverResult<T> {
  const name = errorName(e)
  const detail = `${what}: ${name || 'error'} — ${messageOf(e)}`

  const code: StorageFailureCode =
    name === 'QuotaExceededError'
      ? 'storage/quota'
      : name === 'VersionError'
        ? // The store on disk is NEWER than this build knows how to open, which
          // happens the moment a user reloads one tab and not another after a
          // deploy. Not corruption — the data is fine and a reload fixes it —
          // so it takes the code whose recovery is "close the other one and try
          // again" rather than the one that offers to start fresh.
          'storage/blocked'
        : name === 'ConstraintError' || name === 'DataError' || name === 'DataCloneError'
          ? 'storage/corrupt'
          : 'storage/unavailable'

  return driverFail<T>(code, detail, { name, operation: what })
}
