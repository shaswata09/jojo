/**
 * L1 — what a crash report is, and what must never be in one.
 *
 * WHY THIS LAYER. A crash reporter is a network client, and `check-platform`
 * bans the network from here for good reasons. So this layer owns the two halves
 * that can be WRONG — what a report contains, and how many are kept — and the
 * sending is a port an app shell injects, exactly like `convert` and `scan`.
 * Firebase Crashlytics then lives in `mobile/`, where a native dependency
 * belongs, and nothing portable has heard of Google.
 *
 * WHY REDACTION IS THE POINT OF THE FILE. jojo's whole claim is that your
 * records do not leave the device, and the one exception a user opts into is
 * crash reporting. A crash report is assembled from a message and a stack, and
 * both are written by code that had a bad day — a failed fetch names its URL, a
 * thrown settings object serialises its fields, and an API key is one `${}` away
 * from a report at any moment. `web/src/lib/keys-stay-local.test.ts` asserts a
 * key cannot reach a backup; a reporter that shipped one to Google would make
 * that promise true and irrelevant on the same day.
 *
 * So nothing here trusts its input. Everything that looks like a credential, an
 * address or a filesystem path is replaced before a report exists, and the
 * redaction runs on the way IN rather than on the way out — a report that never
 * held a key cannot leak one from a code path nobody thought about.
 */

/** What went wrong, once it is safe to keep. */
export type CrashReport = {
  /** Stable per report, so a list can key on it and a user can quote one. */
  id: string
  /** ISO instant. Supplied by the caller — this layer has no clock. */
  at: string
  /**
   * Where it happened, in the app's own words: 'assistant', 'boot', 'vault'.
   *
   * A short label rather than a module path, because it is read by a person
   * deciding whether the thing they were doing is the thing that broke.
   */
  where: string
  /** The message, redacted. */
  message: string
  /** The stack, redacted, and capped. Absent when the throw had none. */
  stack?: string
}

/** How many are kept. A ring, because a crash loop must not fill the disk. */
export const CRASH_KEPT = 20

/** Longest stack kept. Enough to see the frame that matters, not a core dump. */
const STACK_MAX = 4000

/** Longest message kept. */
const MESSAGE_MAX = 500

/*
 * What gets replaced, in the order that matters.
 *
 * Ordered longest-context-first so a specific rule wins over a general one: an
 * `Authorization: Bearer sk-…` header is matched as a header before the bare
 * token rule gets to it, which keeps the redacted text readable as a header.
 *
 * Every pattern replaces with a NAMED placeholder rather than blanking, because
 * "the message mentioned a key here" is diagnostic information and the key
 * itself is not.
 */
const RULES: readonly (readonly [RegExp, string])[] = [
  /*
   * An auth header, whatever the scheme, to the END OF THE LINE.
   *
   * This matched `\S+` — one non-space run — which redacts the SCHEME and
   * leaves the credential: `Authorization: Token abc123…` became
   * `Authorization: «redacted» abc123…`. Found by adding the case the rule
   * exists for, after mutation testing showed deleting the rule entirely broke
   * nothing: every other example was already caught by the prefix or bearer
   * rules. A header's value runs to the end of its line, so that is what goes.
   */
  [/\b(authorization|x-api-key|api-key)\b\s*[:=]\s*[^\r\n]+/gi, '$1: «redacted»'],
  /*
   * A vendor key by its own prefix. These are the shapes the providers in
   * `provider.ts` actually mint — `sk-`, `sk-ant-`, `nvapi-`, `gsk_`, `sk-or-` —
   * and a prefix match is what catches one that arrived somewhere no rule
   * anticipated, like the middle of a URL or a serialised settings object.
   */
  [/\b(sk-ant|sk-or|sk|nvapi|gsk)[-_][A-Za-z0-9\-_]{8,}/g, '«redacted-key»'],
  // A bearer token with no recognisable prefix.
  [/\bBearer\s+[A-Za-z0-9\-._~+/]{12,}=*/gi, 'Bearer «redacted»'],
  /*
   * A URL's query and fragment, kept as an origin and a path.
   *
   * A failed request names its URL, and a query string is where tokens, ids and
   * search terms live. The origin and path are the useful half for a bug report
   * and the rest is the user's business.
   */
  [/(https?:\/\/[^\s?#]+)[?#]\S*/gi, '$1?«redacted»'],
  /*
   * A local filesystem path, which on a phone and a desktop alike contains the
   * account name. `/Users/someone/…` in a report handed to a vendor is a name
   * the user did not choose to give.
   */
  [/(\/(?:Users|home)\/)[^/\s"')]+/g, '$1«user»'],
  [/([A-Za-z]:\\Users\\)[^\\\s"')]+/g, '$1«user»'],
  // An email address, which a profile or a contact can put into a message.
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '«redacted-email»'],
]

/**
 * Strips credentials and personal detail out of text bound for a report.
 *
 * Applied to the message and the stack, on the way in. Never returns undefined
 * for a defined input, because a caller that got `undefined` back would be
 * tempted to fall back to the raw value.
 */
export function redact(text: string): string {
  let out = text
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement)
  return out
}

/**
 * Turns anything that was thrown into a report.
 *
 * Takes `unknown` because that is what a `catch` and an `onerror` actually hand
 * you: an Error most of the time, a string sometimes, and occasionally an object
 * with no message at all. A reporter that assumed `Error` would itself throw
 * inside the handler for a throw, which is the worst place to have a bug.
 */
export function toCrashReport(
  thrown: unknown,
  where: string,
  at: string,
  id: string,
): CrashReport {
  const error = thrown instanceof Error ? thrown : null
  const raw =
    error?.message ??
    (typeof thrown === 'string'
      ? thrown
      : thrown === null || thrown === undefined
        ? 'Nothing was thrown, which should not be possible.'
        : safeString(thrown))

  const stack = typeof error?.stack === 'string' ? redact(error.stack).slice(0, STACK_MAX) : undefined

  return {
    id,
    at,
    where,
    message: redact(raw).slice(0, MESSAGE_MAX) || 'An error with no message.',
    ...(stack === undefined ? {} : { stack }),
  }
}

/** `String(x)` on a proxy or a getter can itself throw. This one cannot. */
function safeString(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return 'An error that could not be described.'
  }
}

/**
 * Adds a report, keeping the newest `CRASH_KEPT`.
 *
 * Newest first, because the one being read is almost always the last one — and
 * because a crash loop then fills the list with the same thing rather than
 * pushing the first, most informative one off the end.
 */
export function keepCrash(
  list: readonly CrashReport[],
  report: CrashReport,
  max = CRASH_KEPT,
): CrashReport[] {
  return [report, ...list].slice(0, max)
}
