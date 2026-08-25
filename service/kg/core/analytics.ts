import { FAILURE_KINDS } from './model-server'
import type { FailureKind } from './model-server'

/**
 * L1 — the complete vocabulary of what jojo may report about how it is used.
 *
 * ## Why this is a closed list and not a `logEvent(name, params)` helper
 *
 * Crash reporting leaks by accident: a message written by failing code happens
 * to contain a key, and `core/crash.ts` scrubs the shapes that leak. Usage
 * analytics is the opposite problem. Nothing leaks by accident, because every
 * event is written on purpose by somebody adding a feature — and that is exactly
 * why it is dangerous. The natural thing to write is
 * `track('application_created', { employer: app.org, role: app.role })`, and it
 * would sail through review, because it looks like the analytics code in every
 * other app.
 *
 * In a JOB SEARCH that one line is somebody's employer, their job title, and the
 * fact that they are looking — a set of facts with real consequences if it ends
 * up in a vendor's console. So there is no general-purpose logger to reach for.
 * There is this list, and adding to it means editing this file, which is the
 * moment somebody has to think.
 *
 * ## No free text, at all, anywhere
 *
 * Every parameter is a number or a value from a closed set declared here. Not
 * "strings we promise to sanitise" — no strings from anywhere near a record.
 * `analytics.test.ts` asserts it over the whole table, so a `role` or an
 * `employer` cannot be added without a test going red.
 *
 * ## Counts are bucketed
 *
 * "47 applications" is a small fingerprint and no more useful than "20+" for
 * deciding what to build. Buckets answer the product question — is this feature
 * used a little or a lot — while being useless for telling two people apart.
 *
 * ## The network is not here
 *
 * As everywhere in core. This decides what MAY be said; an app shell injects
 * something that can say it. Firebase Analytics lives in `web/` and `mobile/`.
 */

/**
 * Every event jojo may report. Adding one is a deliberate edit to this file.
 *
 * Named for the thing that happened rather than the screen it happened on, so a
 * redesign does not silently change what the numbers mean.
 */
export const EVENTS = [
  /** The app was opened. The denominator for everything else. */
  'app_opened',
  /** A screen was looked at. Which one is in `screen`. */
  'screen_viewed',
  /** An application record was created, however it was started. */
  'application_created',
  /** An application moved along the pipeline. */
  'application_advanced',
  /** A question was asked of the assistant. */
  'assistant_asked',
  /** The agent ran a tool, and whether the person approved it. */
  'assistant_tool_decided',
  /** A scout pipeline was turned on. */
  'scout_pipeline_started',
  /** A scout proposal was accepted or dismissed. */
  'scout_proposal_decided',
  /** Something was filed in the vault. Which kind is in `kind`. */
  'vault_item_added',
  /** A model provider was connected successfully. */
  'model_connected',
  /** The document reader was connected successfully. */
  'reader_connected',
  /** A backup was written or read. Which is in `direction`. */
  'backup_used',
  /** A transfer between devices finished. */
  'transfer_completed',
  /** The guided tour was started or finished. */
  'tour_used',
  /**
   * A model request that did not work. The first failure in this list.
   *
   * With no backend there are no server logs, so before this a provider that
   * was broken for everybody looked exactly like one nobody had tried.
   */
  'model_failed',
  /**
   * Something threw and was caught. The site and the kind, nothing else.
   *
   * Deliberately one event rather than one per site: what a maintainer needs is
   * a count per place, and twelve near-identical event names would spread that
   * across twelve dashboards.
   */
  'error_caught',
] as const

export type AnalyticsEvent = (typeof EVENTS)[number]

/* --------------------------- the allowed values --------------------------- */

/**
 * Screens, as an enum rather than a route string.
 *
 * A route can gain a parameter — `/applications/:id` — and an id is a record.
 * A name from a list cannot.
 */
export const SCREENS = [
  'dashboard',
  'applications',
  'calendar',
  'vault',
  'scout',
  'statistics',
  'assistant',
  'graph',
  'profile',
  'settings',
  'guide',
  'transfer',
] as const

/** Bucketed, because an exact count is a fingerprint and a bucket is an answer. */
export const COUNTS = ['0', '1', '2-5', '6-20', '21-50', '50+'] as const

export const KINDS = ['file', 'link', 'snippet', 'reminder', 'person', 'posting'] as const
export const DECISIONS = ['approved', 'declined'] as const
export const DIRECTIONS = ['export', 'restore'] as const
export const OUTCOMES = ['started', 'finished'] as const

/**
 * Providers, by NAME, and only ones jojo ships knowledge of.
 *
 * `openai-compatible` covers "a server the user typed an address for", and the
 * address is deliberately not reported: it is frequently a hostname on the
 * user's own network, which is a fact about them rather than about jojo.
 */
export const PROVIDERS_REPORTED = [
  'ollama',
  'openai-compatible',
  'openai',
  'anthropic',
  'openrouter',
  'groq',
  'nvidia',
  'other',
] as const

/**
 * What each event may carry, and nothing else.
 *
 * Every value type here is a union of literals or a number. There is deliberately
 * no `string` in this table — see the header. `analytics.test.ts` walks it and
 * fails if one appears.
 */
export type EventParams = {
  app_opened: Record<string, never>
  screen_viewed: { screen: (typeof SCREENS)[number] }
  application_created: { source: 'manual' | 'link' | 'scout' | 'capture' }
  application_advanced: { to: 'submitted' | 'screen' | 'interview' | 'offer' | 'closed' }
  assistant_asked: { tools_available: number; has_model: boolean }
  assistant_tool_decided: { decision: (typeof DECISIONS)[number]; destructive: boolean }
  scout_pipeline_started: { kind: 'twin' | 'scout' }
  scout_proposal_decided: { decision: (typeof DECISIONS)[number] }
  vault_item_added: { kind: (typeof KINDS)[number] }
  model_connected: { provider: (typeof PROVIDERS_REPORTED)[number] }
  /**
   * A model request that did not work, and the shape of the not-working.
   *
   * THE FIRST FAILURE EVENT IN THIS TABLE, and the gap it closes is the one a
   * local-first app has by construction: there is no backend, so there are no
   * server logs, and until this existed a model that timed out for every user of
   * a given provider was indistinguishable from one nobody had tried. Every
   * other event here records something working.
   *
   * WHAT IT DELIBERATELY DOES NOT CARRY is the address or the message. The
   * endpoint is frequently a hostname on the person's own network — the note
   * above `PROVIDERS_REPORTED` says why that is a fact about them rather than
   * about jojo — and an error string is free text, which is exactly what this
   * table has no `string` in it to prevent. `kind` and `phase` are enough to
   * tell "nobody can reach NVIDIA from a browser" from "one person's laptop was
   * asleep", which is the question worth answering.
   */
  model_failed: {
    provider: (typeof PROVIDERS_REPORTED)[number]
    kind: FailureKind
    phase: (typeof FAILURE_PHASES)[number]
  }
  /**
   * A caught error, as a place and a class.
   *
   * `fatal` separates "a boundary caught this and the screen is gone" from "a
   * background write failed and the app carried on", which decides whether a
   * count is an emergency or a nuisance.
   */
  error_caught: {
    where: (typeof ERROR_SITES)[number]
    kind: (typeof ERROR_KINDS)[number]
    fatal: boolean
  }
  reader_connected: { via: 'path' | 'extension' | 'direct' }
  backup_used: { direction: (typeof DIRECTIONS)[number]; records: (typeof COUNTS)[number] }
  transfer_completed: { records: (typeof COUNTS)[number] }
  tour_used: { outcome: (typeof OUTCOMES)[number] }
}

/**
 * A provider id, narrowed to something reportable.
 *
 * `PROVIDER_IDS` and `PROVIDERS_REPORTED` currently hold the same names, and
 * this function exists for the moment they stop doing so. Reporting
 * `settings.provider` directly would work today and would silently start
 * reporting whatever string a future provider — or a saved server from an older
 * version, or a hand-edited backup — happens to carry.
 *
 * Anything unrecognised answers 'other', which is a real answer: it says a
 * provider was connected without claiming to know which.
 */
export function reportableProvider(id: string): (typeof PROVIDERS_REPORTED)[number] {
  return (PROVIDERS_REPORTED as readonly string[]).includes(id)
    ? (id as (typeof PROVIDERS_REPORTED)[number])
    : 'other'
}

/**
 * The screen a path is on, or null when it is not one jojo reports.
 *
 * ## Why this is a function and not `pathname`
 *
 * The obvious implementation of screen tracking is to report the path, and in
 * this app the path is frequently a record: `/applications/app:01a1-2b3c` is an
 * identifier for one of the user's applications, and `/employers/rice-university`
 * is the name of a place somebody is applying to, spelled out in the URL.
 *
 * So only the FIRST segment is looked at, and only when it is a name declared in
 * `SCREENS`. Everything deeper is dropped without being examined, which is what
 * makes an id unreportable rather than merely unreported: there is no branch
 * here that can return one.
 *
 * A path jojo does not recognise answers null — including `/employers/…`, which
 * is a real screen deliberately left out of `SCREENS` because its own segment is
 * an employer's name.
 */
export function screenForPath(pathname: string): (typeof SCREENS)[number] | null {
  if (typeof pathname !== 'string') return null
  const first = pathname.split('?')[0]?.split('#')[0]?.split('/').filter(Boolean)[0]
  // The root is the dashboard, which has no segment of its own.
  if (first === undefined) return 'dashboard'
  return (SCREENS as readonly string[]).includes(first) ? (first as (typeof SCREENS)[number]) : null
}

/** One reportable thing, as the ports take it. */
export type Reportable<E extends AnalyticsEvent = AnalyticsEvent> = {
  event: E
  params: EventParams[E]
}

/**
 * Buckets a count.
 *
 * The only place a number from the user's records becomes a reportable value, so
 * it is the only place that has to be right. Negative and non-finite inputs
 * answer '0' rather than throwing: this is called from event handlers, and a
 * reporter that throws is worse than one that is slightly wrong.
 */
export function bucket(n: number): (typeof COUNTS)[number] {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n === 1) return '1'
  if (n <= 5) return '2-5'
  if (n <= 20) return '6-20'
  if (n <= 50) return '21-50'
  return '50+'
}

/**
 * The last line of defence, at runtime.
 *
 * The types above stop this at compile time, and this stops it when somebody
 * reaches the port through a cast, a generic, or JSON that came from somewhere
 * else. It is cheap and it is the difference between "the types say no" and
 * "no".
 *
 * Rejects rather than sanitises. A parameter that is not in the vocabulary is a
 * mistake in the calling code, and quietly dropping it would hide the mistake
 * while shipping the event.
 */
export function isReportable(value: unknown): value is Reportable {
  if (typeof value !== 'object' || value === null) return false
  const { event, params } = value as { event?: unknown; params?: unknown }
  if (typeof event !== 'string' || !(EVENTS as readonly string[]).includes(event)) return false
  if (typeof params !== 'object' || params === null) return false

  for (const v of Object.values(params as Record<string, unknown>)) {
    // Numbers and booleans are always safe: they cannot carry a name.
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return false
      continue
    }
    if (typeof v === 'boolean') continue
    /*
     * A string is allowed ONLY when it is a value this file declares. That is
     * what makes "no free text" a fact rather than a convention: an employer
     * name is a string, and it is not in any of these lists.
     */
    if (typeof v === 'string' && ALLOWED_STRINGS.has(v)) continue
    return false
  }
  return true
}

/**
 * Where an error was caught. A place in the app, never a stack frame.
 *
 * A stack frame names the user's own render tree and can carry a component
 * whose props are their records; these are twelve fixed strings chosen so that
 * "the assistant keeps dying for people on Firefox" is answerable and nothing
 * about any particular person is.
 */
export const ERROR_SITES = [
  /** A React render threw and a boundary caught it. */
  'render',
  /** The same, but contained to one route rather than the whole app. */
  'route',
  /** A throw underneath an agent run, which has no other home. */
  'agent',
  /** A promise nobody awaited rejected. */
  'unhandled_rejection',
  /** A throw that reached the window or the RN global handler. */
  'uncaught',
  /** Reading or writing the record store. */
  'storage',
  /** Writing a backup file. */
  'backup',
  /** Reading one back. */
  'restore',
  /** The document reader. */
  'reader',
  /** The capture extension's relay. */
  'extension',
  /** Device-to-device transfer. */
  'transfer',
  /** Somewhere that has not earned its own name yet. */
  'other',
] as const

/**
 * What kind of error it was, from a fixed list.
 *
 * The CONSTRUCTOR NAME, matched against this list — never the message, which is
 * free text and frequently contains a path, a URL or a record's title. A name
 * this does not recognise reads as `other` rather than travelling, which is the
 * property that makes this safe to send from a handler that catches anything.
 */
export const ERROR_KINDS = [
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'QuotaExceededError',
  'SecurityError',
  'NotFoundError',
  'InvalidStateError',
  'AbortError',
  'NetworkError',
  'VersionError',
  'other',
] as const

/**
 * Classifies a caught value without reading a word of it.
 *
 * `DOMException` carries its useful classification in `name` rather than in the
 * constructor — every one of them is a `DOMException` — so `name` is what is
 * read, and it is checked against the list above before it is allowed out.
 */
export function errorKind(thrown: unknown): (typeof ERROR_KINDS)[number] {
  const name =
    thrown instanceof Error && typeof thrown.name === 'string' ? thrown.name : ''
  return (ERROR_KINDS as readonly string[]).includes(name)
    ? (name as (typeof ERROR_KINDS)[number])
    : 'other'
}

/** Which call failed. This file's own vocabulary, so it is declared here. */
export const FAILURE_PHASES = ['connect', 'chat', 'models'] as const

/** Every string any event may carry, flattened. Built from the lists above. */
const ALLOWED_STRINGS: ReadonlySet<string> = new Set<string>([
  ...SCREENS,
  ...COUNTS,
  ...KINDS,
  ...DECISIONS,
  ...DIRECTIONS,
  ...FAILURE_KINDS,
  ...FAILURE_PHASES,
  ...ERROR_SITES,
  ...ERROR_KINDS,
  ...OUTCOMES,
  ...PROVIDERS_REPORTED,
  // The small unions declared inline in `EventParams`.
  'manual',
  'link',
  'scout',
  'capture',
  'submitted',
  'screen',
  'interview',
  'offer',
  'closed',
  'twin',
  'path',
  'extension',
  'direct',
])
