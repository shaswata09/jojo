/**
 * Fitting the conversation to the model's window before the first round: the
 * trim, the summary of what the trim evicted, the summary carried from an
 * earlier turn, and the notes that tell the person what went.
 *
 * Runs once per user turn. What happens to the request AFTER this — the
 * per-round re-fit that stubs old results — is `refit` in `round.ts`.
 */

import type { ChatMessage } from '../core/model-server'
import { fitHistory, summarisedNote, trimNote } from './budget'
import type { Trimmed } from './budget'
import { asMessage, compact } from './compact'
import type { CompactOptions, ThreadRef } from './compact'
import type { ToolSpecs } from './offer'
import type { AgentOptions, AgentRun } from './types'

/**
 * A previous compaction's summary, when it arrived INSIDE the history.
 *
 * Both callers now hand the summary back as `context`: `agent-runs.ts` stores
 * it on the thread, and the bench runner keeps it beside its transcript
 * (`createFeedback` in bench/run.mts). This exists for a history that carries
 * one anyway — a caller that fed a turn's sent messages straight back as the
 * next turn's history, which the runner did until 2026-09-05, so that the
 * summary sat in the history as a `system` message and a cut that evicted it
 * would have lost it. `compact` does not read system messages, because on
 * that path a system message in the prefix was as likely to be a copy of the
 * system prompt. Kept: it costs a scan of the evicted prefix and nothing
 * else, and `context` wins over it whenever a caller passes one.
 *
 * So the summary is recognised by the wrapper `asMessage` puts on it — asked
 * of `asMessage` rather than copied here, so the two cannot drift — and
 * unwrapped back to the raw notes, prefix and pointer both off. What reaches
 * the next summariser as `earlier` is then the notes and not the boilerplate
 * around them, which is the same doubling the raw-return in `compact` closed
 * from the other side. The newest one in the prefix wins: each supersedes
 * the last.
 */
const priorSummaryIn = (
  evicted: readonly ChatMessage[],
  thread: ThreadRef | undefined,
): string | undefined => {
  // `asMessage` returns the message union; a system message's content is a
  // string, which is what is read here.
  const wrapped = (options: Pick<CompactOptions, 'thread'>): string =>
    String(asMessage('', options).content ?? '')
  const prefix = wrapped({})
  const suffix = thread === undefined ? '' : wrapped({ thread }).slice(prefix.length)
  for (let i = evicted.length - 1; i >= 0; i -= 1) {
    const m = evicted[i]
    if (m?.role !== 'system' || !m.content.startsWith(prefix)) continue
    const body = m.content.slice(prefix.length)
    const raw = (
      suffix !== '' && body.endsWith(suffix) ? body.slice(0, -suffix.length) : body
    ).trim()
    // A wrapper with nothing inside supersedes nothing: an older one may still
    // be the notes, so the search goes on rather than ending on it.
    if (raw === '') continue
    return raw
  }
  return undefined
}

/** The history one turn sends, and the summaries placed in front of it. */
export type FittedHistory = {
  /** The part of the history that fits, user turns carried ahead of the tail. */
  readonly history: readonly ChatMessage[]
  /** A summary written THIS turn, as the message that carries it. */
  readonly recovered: ChatMessage | null
  /** A summary from a previous turn, placed when this turn wrote none. */
  readonly carriedContext: ChatMessage | null
  /** The summary for the caller to persist on the thread, when one was written. */
  readonly written: AgentRun['compacted']
}

/**
 * The trim, and what the summary step needs to know about it. Decided before
 * any model is asked, and without awaiting anything.
 */
export type HistoryPlan = {
  readonly fitted: Trimmed
  readonly framing: Pick<CompactOptions, 'budget' | 'thread'>
  /** The prefix the trim removed, results and user turns included. */
  readonly evicted: readonly ChatMessage[]
  /** The summary this turn's would supersede, when there is one. */
  readonly earlier: string | undefined
}

/** The history trimmed to the window, or passed through whole when there is no window. */
function fitToWindow(
  options: AgentOptions,
  system: ChatMessage,
  question: ChatMessage,
  tools: ToolSpecs,
): Trimmed {
  /*
   * Trimmed before sending, rather than truncated by the server after.
   *
   * Nothing bounded a conversation. Measured over ten ordinary follow-ups
   * against a real model, the request went 8,227 → 21,062 tokens: the history
   * is never cut, the carried tool set grows monotonically (33 → 62 schemas),
   * and no one compared the total to the window. On an 8k model that stopped
   * being answerable at turn 2.
   *
   * What happened then is the worst way to fail: the SERVER truncates, and
   * servers truncate from the front — which is this system message, with the
   * rules about not inventing ids, about asking when several records match, and
   * about what today is. Nothing reports it and the reply reads normally.
   *
   * `window` is the person's own number when they gave one, and the provider's
   * default otherwise: 131,072 for a local OpenAI-compatible server and 32,768
   * for Ollama, which is optimistic for Ollama specifically (its `num_ctx` is
   * 4,096 unless changed) — so this
   * is a floor on the damage rather than a guarantee, and `guardTruncation`
   * still runs afterwards for the case where the guess was too generous.
   */
  return options.window === undefined
    ? {
        history: options.history,
        dropped: 0,
        stubbed: 0,
        kept: [],
        toSummarise: [],
        lost: null,
        summaryChars: 0,
        summarisable: true,
        overflows: false,
      }
    : fitHistory(options.history, [system, question, tools], options.window)
}

/**
 * The history fitted to the window, and how a summary of the evicted part
 * would be framed.
 *
 * What was dropped, summarised back in — so a long chat loses DETAIL rather
 * than memory.
 *
 * A plain trim is the floor and it is not enough on its own: at turn twelve
 * the assistant would have no idea that at turn three you said which Rice
 * application you meant, or that it already filed the CV, or that you told it
 * to leave Baylor alone. It asks again, or acts as though none of it
 * happened.
 *
 * `compact` is handed the WHOLE evicted prefix — `history.slice(0,
 * dropped)`: the person's turns, the assistant's, and the original tool
 * results — and does its own marking. What its model is shown is still only
 * the assistant's side (`summarisable` there): the person's turns from that
 * prefix are already at the head of `fitted.history`, verbatim, and the
 * results are never shown to a model at all. That split is the round-one
 * fix and it stands: the first version's summariser was given the prefix
 * whole and, measured on the six endurance cases, the person's turn-one
 * sentence survived in 1 of 18 model×case cells — compressed ~20:1
 * alongside forty serialised records. See `budget.ts` for the numbers.
 *
 * Round one then passed `fitted.toSummarise` — the marked assistant turns
 * and nothing else — and that lost twice, measured on the same cases:
 *
 *   - `compact` refused a reply longer than its INPUT, and that input was
 *     now prose and tool names, 87–831 characters, so a four-heading summary
 *     was "longer than its source". GPT-OSS lost 12 of 34 summaries that
 *     way, Gemma 4 of 34, Qwen 4 of 31 — every Gemma/Qwen refusal had an
 *     input of ≤202 characters against a 106-character skeleton. The rule
 *     is against what the summary REPLACES in the request, which includes
 *     the 6,000-character results the budget stubbed or cut, and only the
 *     full prefix carries those.
 *   - The summariser was not shown the results, so it could not name a
 *     record it had only ever seen there: Qwen and GPT-OSS wrote "app:
 *     unknown", and Qwen then updated the Rice application instead of
 *     Stripe. `compact` now walks the results for a ledger of `label (id)`
 *     pairs, deterministically, and appends it to what it returns — so the
 *     ids reach the stored context whatever the model wrote. It needs the
 *     tool messages to walk.
 *
 * One system note takes the evicted assistant turns' place — system, not
 * assistant, because a model defends its own prior speech and this is
 * context rather than something it said. It is asked for only when a cut
 * actually removed something of the assistant's, so an ordinary conversation
 * never pays for it, and a cut that evicted only user turns (all of them
 * carried) pays for nothing either. It is allowed to fail: without it the
 * trim is a plain one, which is what happened before this existed.
 */
export function planHistory(
  options: AgentOptions,
  system: ChatMessage,
  question: ChatMessage,
  tools: ToolSpecs,
): HistoryPlan {
  const fitted = fitToWindow(options, system, question, tools)

  /*
   * How long a summary may be THIS turn, in characters, or no limit when
   * there is no window to derive one from.
   *
   * `summaryChars` is a share of the window (`SUMMARY_SHARE`) bounded by the
   * room the fitted request actually leaves under the ceiling, so putting the
   * summary back cannot re-overflow what the trim just fixed. It is 0 both
   * without a window and on overflow, and those zeros mean opposite things:
   * no window is no ceiling at all, overflow is no room at all. `undefined`
   * here is the first; the second is handled where the summary is placed.
   */
  const budget = options.window === undefined ? undefined : fitted.summaryChars
  const framing: Pick<CompactOptions, 'budget' | 'thread'> = {
    ...(budget === undefined ? {} : { budget }),
    ...(options.thread === undefined ? {} : { thread: options.thread }),
  }
  /*
   * The summary this one supersedes, from wherever the caller keeps it.
   *
   * It used to be sent as a user message reading "Earlier still: …", which
   * `compact` now ignores along with every other user message — so a
   * twice-compacted thread would keep only its second summary. It goes through
   * `earlier` instead, where the summariser is told what it is.
   */
  const evicted = options.history.slice(0, fitted.dropped)
  const earlier = options.context ?? priorSummaryIn(evicted, options.thread)
  return { fitted, framing, evicted, earlier }
}

/**
 * The evicted prefix being summarised — or `null` when there is nothing to
 * summarise, no summariser, or Stop was pressed.
 *
 * Returned as the pending call rather than awaited, so a turn that does not
 * compact never yields before its first model round.
 *
 * THE FLOOR IS `compact`'S, AND ONLY `compact`'S.
 *
 * This used to hold a second copy of it — skip the call when `budget <
 * MIN_SUMMARY_CHARS` — and the copy did more than the constant says.
 * `compact` refuses the MODEL under that floor and still returns the ledger
 * line, which costs no call and is the half of a summary that carries ids;
 * skipping `compact` outright threw the ledger away with it. Measured
 * 2026-09-06 by driving the real loop through the endurance cases:
 * long-vault-convention came out at 112, 53, 18 and 275 characters on turns
 * 4-7, and on all four neither a summary NOR the ids were placed.
 *
 * The reason it was written that way was real and is now fixed at the source:
 * the note's wrapper — 57 characters of "Earlier in this conversation
 * (summarised, not verbatim): ", plus the pointer when there is a thread —
 * was spent OUTSIDE the budget, so a ledger-only note under the floor took up
 * to a fifth more room than the fit had left. `textBudget` counts it inside
 * the budget instead, so what `compact` returns is what fits.
 *
 * What remains here is the two questions this file can answer and `compact`
 * cannot: whether anything was evicted at all, and whether it may be
 * summarised. No window is no floor either: `budget` is undefined and
 * `compact` is asked with no limit.
 */
export function summariseEvicted(
  options: AgentOptions,
  { fitted, framing, evicted, earlier }: HistoryPlan,
): Promise<string | null> | null {
  const { signal } = options
  // The abort check also covers a Stop pressed DURING the chooser call in
  // `chooserPick` (offer.ts), which is the only window in which that call is
  // running and cancellable by nothing. See there for why this is skipped
  // rather than returned from.
  if (
    fitted.dropped > 0 &&
    fitted.summarisable &&
    fitted.toSummarise.length > 0 &&
    options.summariser &&
    !signal?.aborted
  ) {
    return compact(
      options.summariser,
      evicted,
      {
        ...framing,
        ...(earlier === undefined ? {} : { earlier }),
      },
      signal,
    )
  }
  return null
}

/**
 * The earlier summary, re-placed — or null when a fresh one superseded it or
 * there is no room for it.
 *
 * A summary from a PREVIOUS turn, when this turn did not write a new one.
 *
 * The common case once a conversation has been compacted once: it fits now,
 * nothing is dropped, and what the model still needs is the note about the
 * part that is no longer here. Placed only where there is room for it:
 * `asMessage` fits the body to what is left of the budget once the wrapper is
 * paid for, so a budget the wrapper alone can consume — 0 on overflow, or a
 * tail that fits with nothing to spare — leaves the prefix and the pointer
 * with nothing between them. That is not context, it is the thing that
 * overflows, so it is compared against the empty note and dropped when it
 * says no more than one. (This subsumes the `budget !== 0` it replaces: at 0
 * there is no body, and above 0 there can still be none.)
 *
 * Never BOTH. A fresh summary supersedes `earlier`: the summariser was
 * shown the earlier notes and told to carry forward what still matters, and
 * `compact` merged the earlier ledger into the new one — so everything the
 * old note held that is still true is in the new note, and placing the old
 * one beside it is two notes that disagree wherever the person corrected
 * something in between. The `recovered === null` here is the guard, and a
 * test pins that exactly one "summarised, not verbatim" message goes out
 * when a thread with stored context compacts again (mutation found it
 * unpinned: dropping the guard survived every test then in this file).
 */
function carriedSummary(
  recovered: ChatMessage | null,
  { framing, earlier }: HistoryPlan,
): ChatMessage | null {
  const carried = recovered === null && earlier !== undefined ? asMessage(earlier, framing) : null
  return carried !== null && carried.content !== asMessage('', framing).content ? carried : null
}

/**
 * The app notes about the trim.
 *
 * What the person is told, counted by what actually went. `dropped` is the
 * boundary and it includes the user turns carried forward; those were sent,
 * so "left out" would be false of them. A cut that evicted only user turns
 * removed nothing and says nothing.
 */
function reportTrim(
  onEvent: AgentOptions['onEvent'],
  fitted: Trimmed,
  recovered: ChatMessage | null,
): void {
  const removed = fitted.dropped - fitted.kept.length
  if (removed > 0) {
    onEvent({
      type: 'note',
      app: true,
      text: recovered === null ? trimNote(removed) : summarisedNote(removed),
    })
  }
  if (fitted.lost !== null) {
    // The one stage that loses something nobody can re-derive, so it is
    // reported on its own terms rather than folded into the count above.
    onEvent({
      type: 'note',
      app: true,
      text: `Even your own earlier messages did not all fit this model: ${fitted.lost.reason}. ${String(fitted.lost.count)} ${fitted.lost.count === 1 ? 'was' : 'were'} left out of this request; your records are untouched.`,
    })
  }
  if (fitted.overflows) {
    onEvent({
      type: 'note',
      app: true,
      text: 'The tool list alone is larger than this model can hold. Narrow what the assistant may reach for, or raise the context window in Settings if your server allows it.',
    })
  }
}

/**
 * The history this turn sends, with whatever summary stands in for the part
 * that did not fit, and the notes that say what went.
 *
 * `summary` is what `summariseEvicted` came back with, or `null` when it was
 * not asked.
 */
export function placeHistory(
  options: AgentOptions,
  plan: HistoryPlan,
  summary: string | null,
): FittedHistory {
  const { signal } = options
  const { fitted, framing } = plan
  let recovered: ChatMessage | null = null
  let written: AgentRun['compacted']
  /*
   * Not kept when Stop was pressed while it was being written. `written` is
   * what the caller PERSISTS as the thread's context, and a summary of a turn
   * the person abandoned — possibly cut off mid-request — must not replace
   * the exchanges it claims to cover. The run ends as `aborted` below.
   */
  if (summary !== null && !signal?.aborted) {
    // `asMessage` owns the prefix and the pointer; the thread stores the
    // summary itself. See `compact` for the doubling this avoids.
    recovered = asMessage(summary, framing)
    written = {
      context: summary,
      messages: fitted.dropped,
      kept: fitted.kept.flatMap((m) => (m.role === 'user' ? [m.content] : [])),
    }
  }
  const carriedContext = carriedSummary(recovered, plan)
  reportTrim(options.onEvent, fitted, recovered)

  return { history: fitted.history, recovered, carriedContext, written }
}
