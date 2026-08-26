/**
 * Keeping a conversation inside the model's context window.
 *
 * ## The gap this closes
 *
 * Three things grow across a session and nothing bounded any of them. Measured
 * on ten ordinary follow-ups against a real model:
 *
 *     turn   messages   tools   ~tokens
 *        1          4      33     8,227
 *        5         26      45    13,378
 *       10         58      62    21,062
 *
 * The history is never trimmed, the carried tool set grows monotonically
 * (33 → 62), and nothing compares the total to the window before sending. On an
 * 8k model that conversation stopped being answerable at turn 2; on 16k, at
 * turn 7.
 *
 * What happens then is the worst version of failing: the SERVER truncates, and
 * servers truncate from the front. The front is the system prompt — the rules
 * about not inventing ids, about asking when several records match, about
 * today's date. The model does not report this and the reply looks ordinary.
 * `guardTruncation` can sometimes detect it afterwards from a token count; by
 * then the answer has been given.
 *
 * ## What this does instead
 *
 * Drops the OLDEST exchanges until the request fits, and says so. Recent turns
 * are what a follow-up refers to; the system prompt and the current question
 * are never candidates.
 *
 * ## Why whole exchanges
 *
 * An assistant message carrying `tool_calls` and the `tool` messages answering
 * it are one unit. Dropping the assistant and keeping its results leaves
 * `tool_call_id`s pointing at nothing, which every provider rejects — so the
 * cut is only ever made at a boundary where no result is left orphaned.
 */

import type { ChatMessage } from '../core/model-server'
import { estimateTokens } from '../core/model-server'

/**
 * How much of the window to leave for the answer.
 *
 * The window has to hold the request AND what comes back. A budget that filled
 * it entirely would fit perfectly and leave the model no room to reply, which
 * reads as a truncated answer rather than as an oversized request.
 *
 * ## Why 4096, which is measured rather than chosen
 *
 * This was 1024, and 1024 was a guess. Measured against the three benchmark
 * models on four ordinary requests with the whole catalog offered — the
 * `completion_tokens` each needed before it had said anything at all:
 *
 * | model | worst of four |
 * | --- | --- |
 * | Gemma 3 31B | 39 |
 * | GPT-OSS 120B | 398 |
 * | Qwen3 14B | **2,358** |
 *
 * A model that reasons before it speaks spends most of its reply budget
 * thinking, and Qwen3 needed more than TWICE the old reserve on the easiest
 * question in the set. That is not a tail case: reasoning models are most of
 * what people run locally now, and the failure is total rather than degraded —
 * `file-a-new-document` came back with zero calls and an empty string.
 *
 * The consequence of getting it wrong in each direction is asymmetric, which is
 * what decides the number. Too small truncates a reply that was going to work;
 * too large costs history, and history has somewhere to go — `fitHistory`
 * summarises what it drops. So 4096: about 1.7× the worst measurement, and
 * roughly one conversation turn of history at a 32k window.
 *
 * ## Why this is NOT sent as `max_tokens`
 *
 * The tempting symmetry is to tell the server the same number. Measured, that
 * is strictly worse: with no `max_tokens` these servers allow everything left
 * after the prompt — 40,960, 131,072 and 262,144 tokens of `max_model_len`
 * respectively — so sending a reserve could only ever lower the ceiling. This
 * number decides how much PROMPT to pack, and nothing else.
 */
export const RESERVED_FOR_REPLY = 4096

/**
 * A safety margin on the estimate itself.
 *
 * `estimateTokens` divides by 3.6, which is close for prose and optimistic for
 * JSON — tool schemas are mostly punctuation and short keys, where real
 * tokenisers do worse. Being wrong in this direction costs a dropped exchange;
 * being wrong the other way costs the system prompt.
 *
 * VERIFIED against the three benchmark servers rather than assumed. The whole
 * catalog plus a system message and a question, compared with the
 * `prompt_tokens` each server reported for exactly that request:
 *
 * | model | actual ÷ estimate |
 * | --- | --- |
 * | GPT-OSS 120B | 0.575 |
 * | Gemma 3 31B | 0.886 |
 * | Qwen3 14B | **1.020** |
 *
 * The worst real tokeniser needs 1.02, so 1.15 covers it with room to spare —
 * and the spread is why a margin exists at all: the same 66,443 characters are
 * 10,610 tokens to one of these models and 18,830 to another.
 */
const MARGIN = 1.15

/**
 * What a compaction aims to leave behind, as a share of the whole window.
 *
 * Trimming the MINIMUM that fits is the obvious rule and it thrashes: the next
 * turn adds a message, overflows again, and pays for another summary. Measured
 * over ten turns with a 16k window, six of them trimmed — six summarisation
 * calls for one conversation, and every one of them losing a little more.
 *
 * Compacting hard instead buys headroom. Cutting back to a third of the window
 * leaves roughly two thirds free, which is many turns of ordinary conversation
 * before the next one is needed. The cost is that a compaction throws away more
 * at once — which is exactly why what it throws away is summarised rather than
 * dropped.
 */
export const COMPACT_TARGET = 1 / 3

export type Trimmed = {
  readonly history: readonly ChatMessage[]
  /** How many messages were dropped from the request. 0 means it fitted. */
  readonly dropped: number
  /**
   * Whether what was dropped may be SUMMARISED and recorded on the thread.
   *
   * False on overflow, and the distinction is not pedantic. Overflow means the
   * fixed part alone exceeds the window: dropping history cannot make the
   * request fit, and it is dropped only because losing the conversation is less
   * bad than losing the system prompt to a server that truncates from the
   * front. Recording that as "summarised through here" would replace a
   * conversation with a summary of a request that could not be sent.
   *
   * So the person is told (the count is real) and the thread is not written to.
   */
  readonly summarisable: boolean
  /** True when even an empty history does not fit — see `fitHistory`. */
  readonly overflows: boolean
}

const sizeOf = (parts: readonly unknown[]): number =>
  Math.round(estimateTokens(JSON.stringify(parts)) * MARGIN)

/**
 * Whether `history[0..n)` can be cut without orphaning a tool result.
 *
 * A `tool` message answers the assistant turn before it. Cutting immediately
 * before one would leave it pointing at a `tool_call_id` that is no longer in
 * the conversation.
 */
const cuttable = (history: readonly ChatMessage[], at: number): boolean =>
  at >= history.length || history[at]?.role !== 'tool'

/**
 * The longest tail of `history` that fits, with the fixed parts accounted for.
 *
 * `fixed` is everything that cannot be dropped: the system message, the current
 * question, and the tool schemas. When those alone exceed the window the result
 * has `overflows: true` and an empty history — the caller cannot make the
 * request smaller by dropping conversation, and should say so rather than send
 * something that will be truncated at the front.
 */
export function fitHistory(
  history: readonly ChatMessage[],
  fixed: readonly unknown[],
  window: number,
): Trimmed {
  const ceiling = window - RESERVED_FOR_REPLY
  const base = sizeOf(fixed)
  /*
   * `dropped: 0`, and that is not cosmetic.
   *
   * Overflow means the FIXED part alone does not fit — the schemas, the system
   * prompt, the question. No amount of history can be dropped to fix it, and
   * nothing is being summarised, because the request cannot be made at all.
   *
   * Reporting `history.length` here told the loop that everything had been
   * dropped: it summarised the whole conversation and the caller persisted
   * `contextThrough` over all of it, permanently replacing a conversation with
   * a summary of a request that was never sent.
   */
  if (base >= ceiling) {
    return { history: [], dropped: history.length, summarisable: false, overflows: true }
  }

  // Nothing to do until the window is actually threatened. A conversation that
  // fits is left byte-identical, which is also what keeps the prefix cached.
  if (base + sizeOf(history) <= ceiling) {
    return { history, dropped: 0, summarisable: true, overflows: false }
  }

  /*
   * Over the line, so compact to the TARGET rather than to the line: cutting
   * just enough to fit means the next turn overflows again, and the one after
   * that — six summarisation calls in a ten-turn conversation, each losing a
   * little more.
   *
   * A third of the window if that is reachable, and a third of what is actually
   * AVAILABLE when it is not.
   *
   * The first version was `window/3 - base`, which reads correctly and collapses:
   * the fixed part is mostly tool schemas, and those can exceed a third of the
   * window on their own. Measured at a 16k window with ~9.6k of schemas, the
   * target came out negative, clamped to zero, and **every compaction dropped
   * the entire conversation** — the opposite of keeping the important part.
   *
   * `room` is what history could occupy at most. Taking the larger of the two
   * aims means the goal is still "a third of the window" whenever the tool list
   * leaves space for that, and degrades to "a third of what is left" instead of
   * to nothing when it does not.
   */
  const room = ceiling - base
  const target = Math.max(Math.round(window * COMPACT_TARGET) - base, Math.round(room * COMPACT_TARGET))

  /*
   * Oldest first, at a boundary that leaves no orphaned tool result — and never
   * as far as emptying the history, which is the subtle half.
   *
   * This ran to `cut <= history.length`, so the empty tail was a candidate and
   * it trivially satisfies ANY target. A conversation whose last exchange was
   * one token too big for the target therefore fell through to "drop
   * everything" rather than to "keep what fits", with `overflows: false`
   * reporting that all was well. Raising `RESERVED_FOR_REPLY` is what made that
   * reachable; it was always the behaviour.
   */
  for (let cut = 1; cut < history.length; cut += 1) {
    if (!cuttable(history, cut)) continue
    const tail = history.slice(cut)
    if (sizeOf(tail) <= target) {
      return { history: tail, dropped: cut, summarisable: true, overflows: false }
    }
  }

  /*
   * The target is a GOAL, and `room` is the constraint. Falling between them
   * must not mean losing the conversation.
   *
   * Found by raising `RESERVED_FOR_REPLY`: under a tool list taking most of the
   * ceiling, the target dropped below the size of a single exchange, no `cut`
   * ever satisfied it, and this returned an empty history with
   * `overflows: false` — the request says everything is fine and the person's
   * last turn is gone. That is the same silent loss the overflow branch above
   * was split apart to prevent, arriving by a different route.
   *
   * So: aim for the target, and settle for whatever genuinely FITS. Compacting
   * sooner next turn is a cost; answering a follow-up with no idea what it
   * follows is a failure.
   */
  for (let cut = 1; cut < history.length; cut += 1) {
    if (!cuttable(history, cut)) continue
    const tail = history.slice(cut)
    if (sizeOf(tail) <= room) {
      return { history: tail, dropped: cut, summarisable: true, overflows: false }
    }
  }

  return { history: [], dropped: history.length, summarisable: true, overflows: false }
}

/** What to tell the person when earlier turns were summarised rather than lost. */
export const summarisedNote = (dropped: number): string =>
  `This conversation grew past what the model can hold, so the earliest ${String(dropped)} message${dropped === 1 ? '' : 's'} ${dropped === 1 ? 'was' : 'were'} replaced with a short summary. The assistant still knows what happened; it no longer has the exact wording.`

/** What to tell the person when earlier turns had to go. */
export const trimNote = (dropped: number): string =>
  `This conversation grew past what the model can hold, so the earliest ${String(dropped)} message${dropped === 1 ? '' : 's'} ${dropped === 1 ? 'was' : 'were'} left out of this request. Your records are untouched — start a new conversation to give it a clean slate.`

/**
 * Whether a tool list leaves room for a conversation.
 *
 * Used to decide whether the LLM chooser is worth its risk this turn — see the
 * loop. "Fits" is deliberately not "fits at all": a request where the schemas
 * take everything but the reply reserve is one where the person gets a single
 * turn and no history, so the bar is the compaction target. If the tools alone
 * exceed the share of the window meant to hold everything, the list is too big.
 */
export function fitsWindow(tools: readonly unknown[] | undefined, window: number): boolean {
  if (tools === undefined) return false
  const budget = Math.round(window * COMPACT_TARGET)
  // `MARGIN`, not a repeated 1.15 — a second copy of a constant is a second
  // copy that can stop agreeing with the first.
  return Math.round(estimateTokens(JSON.stringify(tools)) * MARGIN) <= budget
}
