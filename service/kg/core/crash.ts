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
type Replacement = string | ((match: string, ...groups: string[]) => string)

const RULES: readonly (readonly [RegExp, Replacement])[] = [
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
  /*
   * The iOS equivalent of the account name: the per-install container UUID.
   *
   *   /var/mobile/Containers/Data/Application/9C4E…/Documents/…
   *
   * There was no rule for this shape at all, which an audit found by handing
   * `redact` the path `restore-documents.ts` actually writes to on a phone —
   * it came back unchanged, UUID and all. The UUID is stable for the life of
   * an install, so a series of reports carrying it is a series a vendor can
   * join up into one device's history. `/private/var/…` and the `Bundle`
   * container are the same path under their other spellings.
   */
  [
    /(\/(?:private\/)?var\/(?:mobile\/Containers|containers)\/[A-Za-z]+\/Application\/)[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/g,
    '$1«install»',
  ],
  /*
   * …and then EVERYTHING under one of those roots, because the leak an audit
   * reproduced was not the account name — that rule already worked — it was
   * the FILE NAME after it.
   *
   * The names under these roots are the user's own. `restore-documents.ts`
   * files a restored document as `<id>__<their document's name>`, and an
   * `ENOENT` names the whole path; `/Users/…/Documents/Offer - Fujitsu -
   * signed.pdf` in a report tells a vendor who is hiring the user. Nothing
   * under a user-data root is diagnostic enough to be worth that, so the tail
   * goes and only the shape is kept.
   *
   * The extension and any `:line:col` survive, which is what keeps a stack
   * frame readable as a stack frame: `at /Users/«user»/«path».tsx:12:3` still
   * says a bundled module threw rather than a document read failing.
   *
   * The lazy span crosses spaces on purpose. Stopping at whitespace is what
   * the old rule did, and a document called `Offer - Fujitsu.pdf` walked
   * straight through it — a filename with a space in it is the normal case,
   * not the exotic one. Nothing tells you where such a path ends, so this
   * takes the first extension-shaped token and accepts that it will sometimes
   * swallow a few words of message with it. That direction costs diagnostics;
   * the other direction costs the user.
   *
   * The Android root is spelled out here rather than anonymised above because
   * `dev.jojo` is the app's own package name and public — it is an anchor, not
   * a secret. `ReactNativeBlobUtil.fs.dirs.DocumentDir` resolves to
   * `/data/user/0/dev.jojo/files` there, which is where every document the app
   * holds on that platform lives.
   */
  [
    /((?:«user»|«install»|\/data\/(?:user\/\d+|data)\/[A-Za-z0-9_.]+))([/\\])[^\r\n"'()]{0,200}?(\.[A-Za-z0-9]{1,8})(?![A-Za-z0-9])/g,
    (_match, root: string, separator: string, extension: string) =>
      `${root}${separator}«path»${extension}`,
  ],
  // The same tail with no extension to anchor on, so it ends at whitespace.
  // The lookahead is what stops this undoing the rule above by eating the
  // `«path».pdf` it just wrote.
  [
    /((?:«user»|«install»|\/data\/(?:user\/\d+|data)\/[A-Za-z0-9_.]+))([/\\])(?!«path»)[^\s"')]+/g,
    (_match, root: string, separator: string) => `${root}${separator}«path»`,
  ],
  /*
   * Android's two other spellings of "a file the user owns", neither of which
   * the rules above anchor on.
   *
   *   content://com.android.providers.downloads.documents/document/msf%3A31
   *   content://com.android.externalstorage.documents/document/primary%3AOffer.pdf
   *   /storage/emulated/0/Download/Offer - Fujitsu - signed.pdf
   *
   * A `content://` URI is what the document picker hands back, and the part
   * after the authority is the provider's own name for the file — for the
   * external-storage provider that IS the file name. `/storage/…` is shared
   * storage, where a downloaded offer letter lives. Both reach a message the
   * moment a read fails, and both say who is hiring the user as plainly as a
   * `/Users/…` path does.
   *
   * The authority is kept for `content://` because "the downloads provider
   * refused" and "Drive refused" are different bugs, and an authority is a
   * package name, which is public. Everything after it goes. For `/storage/`
   * the volume (`emulated/0`, or an SD card's id) is kept for the same reason
   * — internal storage and a removable card fail differently — and the tail
   * goes, with the extension kept when one can be found, as above. The first
   * `/storage/` rule crosses spaces for the same reason the one above does: a
   * file name with a space in it is the normal case. A `content://` URI is
   * percent-encoded, so it has none to cross and ends at whitespace.
   */
  [/(content:\/\/[A-Za-z0-9_.-]+)\/[^\s"')]*/gi, '$1/«path»'],
  [
    /(\/storage\/(?:emulated\/\d+|self\/primary|[A-Za-z0-9-]+))\/[^\r\n"'()]{0,200}?(\.[A-Za-z0-9]{1,8})(?![A-Za-z0-9])/g,
    '$1/«path»$2',
  ],
  // The lookahead spans the whole tail, not just its start: `emulated` alone
  // also matches the volume pattern, and a lookahead at the start let this rule
  // re-match `/storage/emulated` + `/0/«path».pdf` and eat the extension the
  // rule above had just kept.
  [
    /(\/storage\/(?:emulated\/\d+|self\/primary|[A-Za-z0-9-]+))\/(?![^\s"')]*«path»)[^\s"')]+/g,
    '$1/«path»',
  ],
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
  for (const [pattern, replacement] of RULES) {
    // Narrowed rather than cast: a rule replaces with a literal or with a
    // function of its own captures, and `String.replace` has a distinct
    // overload for each.
    out =
      typeof replacement === 'string'
        ? out.replace(pattern, replacement)
        : out.replace(pattern, replacement)
  }
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
export function toCrashReport(thrown: unknown, where: string, at: string, id: string): CrashReport {
  const error = isError(thrown) ? thrown : null
  const raw =
    error?.message ??
    (typeof thrown === 'string'
      ? thrown
      : thrown === null || thrown === undefined
        ? 'Nothing was thrown, which should not be possible.'
        : safeString(thrown))

  const stack =
    typeof error?.stack === 'string' ? redact(error.stack).slice(0, STACK_MAX) : undefined

  return {
    id,
    at,
    where,
    message: redact(raw).slice(0, MESSAGE_MAX) || 'An error with no message.',
    ...(stack === undefined ? {} : { stack }),
  }
}

/**
 * `instanceof`, guarded. It walks the prototype chain, and on a revoked proxy
 * that walk throws — inside the handler for a throw, which is the one place a
 * second throw replaces the report with the reporter's own failure.
 */
function isError(value: unknown): value is Error {
  try {
    return value instanceof Error
  } catch {
    return false
  }
}

/**
 * Describes a thrown value that is not an Error, by its TYPE and nothing else.
 *
 * This used to be `JSON.stringify(value)`, and that is the wrong instinct for a
 * report that can leave the device. Code throws objects for convenience — a
 * failed tool result, a settings object, a record that did not validate — and
 * stringifying one sends every field of it. Redaction only catches what has a
 * recognisable SHAPE: an employer's name, a note, a job title have none, so a
 * thrown `{ employer: 'Fujitsu', notes: '…' }` went to Crashlytics whole. No
 * rule can be written for "text the user typed", so the only safe move is not
 * to read the value at all.
 *
 * What survives is what a developer needs to find the throw: that it was not
 * an Error, and what kind of value it was — `non-Error: object`,
 * `non-Error: number`, `non-Error: array`. Not the constructor's name either,
 * tempting as it is: it would take a prototype walk on a value that may be a
 * hostile proxy, to report something the calling code's stack already says.
 *
 * A thrown STRING is not routed here and is still redacted and kept, on
 * purpose: it is written by code the way an Error's message is, and the two
 * carry the same risk. Treating one as data and the other as a message would
 * be drawing the line by syntax rather than by where the text came from.
 */
function safeString(value: unknown): string {
  // `Array.isArray` throws on a revoked proxy, and this runs inside a handler
  // for a throw — the one place a second throw is worst. `typeof` cannot.
  try {
    if (Array.isArray(value)) return 'non-Error: array'
  } catch {
    /* fall through to the type, which is always readable */
  }
  return `non-Error: ${typeof value}`
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
