/**
 * L1 — KgError, KgErrorCode, Result<T>.
 *
 * `userMessage` is toast copy: a plain sentence, no jargon, no ids. `context`
 * is logged and never shown. Keeping them apart is what stops a record id
 * leaking into a toast, and what stops the log losing the detail that would have
 * explained the failure.
 *
 * `Result` rather than a throw at every boundary that can fail for an ordinary
 * reason. A private-browsing window with IndexedDB switched off is not an
 * exception, it is Tuesday: it has a code, a sentence and a recovery path, and
 * making the caller handle it is cheaper than making every caller remember a
 * try/catch it will forget once.
 */

export type KgErrorCode =
  | 'storage/unavailable'
  | 'storage/quota'
  | 'storage/blocked'
  | 'storage/corrupt'
  | 'graph/not-found'
  | 'graph/conflict'
  | 'graph/invariant'
  | 'tool/refused'

/**
 * Sentences, not error text.
 *
 * The default for a code exists so no call site has to invent copy under
 * pressure — the failure paths are the ones written last and read most, and
 * "storage/quota" reaching a toast is how an app tells the user it has given up
 * in a language they do not speak.
 */
const DEFAULT_MESSAGE: { readonly [C in KgErrorCode]: string } = {
  'storage/unavailable': 'This browser is not letting jojo save data on this device.',
  'storage/quota': 'There is no room left to save. Export a copy, then remove something.',
  'storage/blocked': 'Another jojo tab is open with an older version. Close it and try again.',
  'storage/corrupt': 'Some of the saved data could not be read.',
  'graph/not-found': 'That record no longer exists.',
  'graph/conflict': 'Something else changed that record first.',
  'graph/invariant': 'That change would have left the records inconsistent.',
  'tool/refused': 'That is not something jojo can do right now.',
}

export class KgError extends Error {
  readonly code: KgErrorCode
  /** Toast copy. Plain sentence, no jargon, no ids. */
  readonly userMessage: string
  /** Logged, never shown. */
  readonly context?: Record<string, unknown>

  constructor(
    code: KgErrorCode,
    userMessage?: string,
    options?: { context?: Record<string, unknown>; cause?: unknown },
  ) {
    const message = userMessage ?? DEFAULT_MESSAGE[code]
    // `cause` is passed to Error rather than kept as a field so a devtools stack
    // shows the original failure: an IDB DOMException laundered into a KgError
    // with no cause loses the one line that says which store rejected the write.
    super(
      `${code}: ${message}`,
      options?.cause === undefined ? undefined : { cause: options.cause },
    )
    this.name = 'KgError'
    this.code = code
    this.userMessage = message
    // Assigned only when present. With `exactOptionalPropertyTypes` an explicit
    // `context: undefined` is a different type from an absent key, and it is
    // also what makes a log line read "context: undefined" instead of nothing.
    if (options?.context !== undefined) this.context = options.context
  }
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: KgError }

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function err<T = never>(error: KgError): Result<T> {
  return { ok: false, error }
}

/** `fail('graph/not-found')` — the common case, with the sentence already written. */
export function fail<T = never>(
  code: KgErrorCode,
  userMessage?: string,
  options?: { context?: Record<string, unknown>; cause?: unknown },
): Result<T> {
  return { ok: false, error: new KgError(code, userMessage, options) }
}

export function isKgError(e: unknown): e is KgError {
  return e instanceof KgError
}

/**
 * Wraps anything thrown into a KgError without losing it.
 *
 * The rule this serves is in `tools/runtime.ts`: an exception that is not a
 * deliberate failure is a programmer error and is re-thrown to the
 * ErrorBoundary. This is for the other case — a boundary that genuinely cannot
 * throw, where swallowing the original message would leave nothing to debug.
 */
export function asKgError(e: unknown, code: KgErrorCode, userMessage?: string): KgError {
  if (e instanceof KgError) return e
  return new KgError(code, userMessage, {
    cause: e,
    context: { thrown: e instanceof Error ? e.message : String(e) },
  })
}
