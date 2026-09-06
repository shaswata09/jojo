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
 * Three stages, in the order of how little each one loses, and each stage runs
 * only if the one before it did not bring the request under the target:
 *
 *   1. STUB old tool results. A tool result is re-derivable — the store still
 *      holds what `memory.list` returned — so it is the one kind of message
 *      that can be replaced by a one-line pointer ("40 records; re-read if
 *      needed") without losing anything the person said or the assistant
 *      decided. Oldest first, stopping as soon as the request fits, so the
 *      newest results — the ones a follow-up is most likely about — survive
 *      longest. The assistant's tool CALLS stay, so every `tool_call_id` still
 *      answers something.
 *   2. CUT the oldest exchanges, at a boundary that leaves no orphaned result —
 *      but the person's own turns are never cut. They are carried forward
 *      verbatim ahead of what remains, and only the ASSISTANT's messages from
 *      the cut prefix are offered for summarising.
 *   3. As a last resort, drop the oldest user turns too, and say why.
 *
 * ## Why user turns are kept and not summarised — measured
 *
 * The six endurance benchmark cases plant a fact in turn one and ask for it
 * after 4–7 compactions. Under the old single-stage trim — cut whole
 * exchanges, summarise everything cut — the fact survived in 1 of 18
 * model×case cells (Gemma 1/6, Qwen 0/6, GPT-OSS 0/6). The reason is
 * arithmetic, not model quality: one `memory.list` result is ~6,000
 * characters, and the person's one-sentence turn was being compressed ~20:1
 * alongside forty serialised records. No summariser keeps the sentence at
 * that ratio. So the records are stubbed (they can be re-read), and the
 * sentence is kept as the person wrote it — the same split Codex makes
 * (user messages kept, assistant and tool content dropped) and SWE-agent's
 * `LastNObservations` makes for the tool half.
 *
 * Keeping user turns means the sent history can hold two user messages in a
 * row. Measured on 2026-09-05 against all three bench servers with
 * `user, user, assistant, user` and a fact in the first: Gemma 4 31B, Qwen3
 * 14B and GPT-OSS 120B each answered it (prompt_tokens 59, 53 and 113), so
 * the shape is accepted where it has to be.
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

/**
 * How much of the window a compaction summary may take, as a share of it.
 *
 * This replaced a fixed 1,200 characters (~380 tokens under the margin), which
 * was the same size at 8k as at 128k. That constant is half of why the
 * endurance cases failed: forty records and a sentence were being asked to fit
 * in the space of a paragraph whatever the window. A tenth of the window is a
 * paragraph at 8k and two pages at 128k — enough to hold the structured
 * sections the summariser is asked for without being enough to become the
 * thing that overflows: with the target at a third and the reply reserve at
 * 4,096, a third plus a tenth plus the reserve is under the window at every
 * size the providers declare.
 *
 * A share and not a number, so that nothing downstream can carry its own copy.
 */
export const SUMMARY_SHARE = 0.1

export type Trimmed = {
  /**
   * What to send: the user turns carried out of the cut prefix, verbatim and in
   * order, followed by the tail that survived — with old tool results replaced
   * by stubs where that was needed.
   */
  readonly history: readonly ChatMessage[]
  /**
   * The compaction boundary: how many leading messages of the input are no
   * longer sent as they stood. `input.slice(0, dropped)` is the prefix that was
   * evicted, and it is what the thread records as covered by a summary.
   *
   * It COUNTS the user turns that were carried forward — they are in the prefix
   * and also in `history` — so `dropped - kept.length` is the number of messages
   * actually removed. 0 means the request fitted, or fitted once tool results
   * were stubbed; check `stubbed` to tell those apart.
   */
  readonly dropped: number
  /**
   * How many tool results were replaced by a one-line stub. Stubbing changes no
   * message the person or the assistant wrote and needs no summary — the record
   * is still in the store and the stub says how to read it back.
   */
  readonly stubbed: number
  /**
   * The user turns from the evicted prefix, carried into `history` verbatim.
   * Never candidates for the summariser: a sentence the person wrote survives
   * intact or, at the very end, is dropped with `lost` saying so — it is never
   * paraphrased.
   */
  readonly kept: readonly ChatMessage[]
  /**
   * What the summariser may see: the ASSISTANT's messages from the evicted
   * prefix — its prose and the names and arguments of what it called. No user
   * turn, and no tool result (those are in the store). Empty means nothing of
   * the assistant's was cut and no summary is needed this turn.
   */
  readonly toSummarise: readonly ChatMessage[]
  /**
   * User turns dropped at the very end, when even the person's own messages
   * with everything else gone did not fit. `null` whenever every user turn
   * survived, which is the case this whole design exists to make normal.
   */
  readonly lost: { readonly count: number; readonly reason: string } | null
  /**
   * How many characters of summary the window can afford this turn: a
   * `SUMMARY_SHARE` of the window, and never more than the room the fitted
   * request actually leaves under the ceiling — the second bound is what stops
   * a summary from re-overflowing a request the trim just fixed when the fixed
   * part takes most of the window (measured: 21.7k of tools at 26.6k leaves
   * ~800 tokens of room, and a tenth of the window would be 2.6k).
   *
   * The cut RESERVES the share when evicting more can afford it (stage 2's
   * middle pass), so this is the whole share whenever the exchanges being
   * evicted could make room for it, and the honest remainder when they
   * cannot. That remainder can be below what any summary needs — 75
   * characters on the vault-convention shape at its 26,100 window, where the
   * share is eight times the room — and a number that small is `compact`'s
   * floor to refuse, not this field's to round up: the room is what it is.
   */
  readonly summaryChars: number
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
 * Characters per token, DERIVED from the estimator rather than copied from it.
 *
 * The summary budget is handed out in characters because that is what a
 * `slice` takes, while everything here is measured in tokens. The divisor lives
 * in `model-server` and it is measured; a second 3.6 written here would be a
 * second thing that can stop agreeing with the first, so this asks the
 * estimator what a thousand characters weigh and inverts that.
 */
const CHARS_PER_TOKEN = 1000 / estimateTokens('x'.repeat(1000))

/** Characters a budget of `tokens` can hold once the margin is applied to it. */
const charsFor = (tokens: number): number =>
  Math.max(0, Math.floor((tokens / MARGIN) * CHARS_PER_TOKEN))

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
 * The number of records in a serialised read result, when it is a list.
 *
 * Two shapes. `queries.ts` wraps every list in `{ total, shown, matches }` with
 * the counts FIRST, precisely so that they survive `renderOutcome`'s cut — a
 * truncated result is not parseable, but its first thirty characters are, and
 * that is what the regex reads. A bare array is counted by parsing it. Anything
 * else is a single record or prose, and the stub names the tool without a
 * count rather than guessing one.
 */
const recordCount = (content: string): number | null => {
  const counted = /^\{"total":(\d+),"shown":(\d+)/.exec(content)
  if (counted?.[1] !== undefined) return Number(counted[1])
  try {
    const parsed: unknown = JSON.parse(content)
    return Array.isArray(parsed) ? parsed.length : null
  } catch {
    return null
  }
}

/**
 * The one line that stands in for an evicted tool result.
 *
 * It names the tool, so the model knows which call to repeat; gives the count
 * when the result was a list, so "were there any?" is still answerable without
 * a call; and says the result can be re-read, because a model that reads a
 * bare gap either assumes the call failed or invents what it returned.
 */
export const stubFor = (tool: string, content: string): string => {
  const count = recordCount(content)
  const what = count === null ? 'result' : `${String(count)} record${count === 1 ? '' : 's'}`
  return `[${tool} ${what} withheld to save room — re-read if needed by calling ${tool} again]`
}

/** Which tool each `tool_call_id` in `history` was made to. */
const callNames = (history: readonly ChatMessage[]): ReadonlyMap<string, string> => {
  const names = new Map<string, string>()
  for (const m of history) {
    if (m.role !== 'assistant') continue
    for (const c of m.tool_calls ?? []) names.set(c.id, c.function.name)
  }
  return names
}

/** The user turns in `messages[0..end)`, in order. */
const usersIn = (messages: readonly ChatMessage[], end: number): ChatMessage[] =>
  messages.slice(0, end).filter((m) => m.role === 'user')

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
  const share = Math.round(window * SUMMARY_SHARE)
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
    return {
      history: [],
      dropped: history.length,
      stubbed: 0,
      kept: [],
      toSummarise: [],
      lost: null,
      summaryChars: 0,
      summarisable: false,
      overflows: true,
    }
  }

  const room = ceiling - base
  /** A result that was sent, with the summary bounded by what is actually left. */
  const sent = (
    out: readonly ChatMessage[],
    dropped: number,
    stubbed: number,
    kept: readonly ChatMessage[],
    toSummarise: readonly ChatMessage[],
    lost: Trimmed['lost'],
  ): Trimmed => ({
    history: out,
    dropped,
    stubbed,
    kept,
    toSummarise,
    lost,
    summaryChars: charsFor(Math.min(share, room - sizeOf(out))),
    summarisable: true,
    overflows: false,
  })

  // Nothing to do until the window is actually threatened. A conversation that
  // fits is left byte-identical, which is also what keeps the prefix cached.
  if (base + sizeOf(history) <= ceiling) {
    return sent(history, 0, 0, [], [], null)
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
  const target = Math.max(
    Math.round(window * COMPACT_TARGET) - base,
    Math.round(room * COMPACT_TARGET),
  )

  /*
   * Stage 1: stub tool results, oldest first, until the request is under the
   * target. Nothing the person or the assistant wrote is touched, so a request
   * that fits after this stage needs no summary — and measured on the
   * endurance histories, where results are ~6,000 characters each and prose is
   * a sentence, this stage alone is what fits them.
   *
   * A result no longer than its stub is left alone. The stub exists to save
   * room; where it would save none it would only lose the one thing a short
   * result carries, which is the id of a record just written.
   *
   * The LAST exchange's result is not protected either, and that was measured
   * rather than assumed, because it is the result the next question is most
   * likely about — long-vault-convention is exactly that shape: turn eight
   * saves a link beside the one turn seven's listing returned. At the case's
   * 26,100 window the fixed part is 21,693 tokens and the room 311; the
   * person's seven turns take 200 of it, leaving 111 for anything else. The
   * link record is 87 tokens intact and 48 as a stub, and the exchange around
   * it 159 intact and 119 stubbed — neither fits, and the answer alone (22)
   * does. Protecting the record would have bought nothing there, and at any
   * wider window it would take from the summary's reserve what one re-read
   * gives back.
   */
  const names = callNames(history)
  const working: ChatMessage[] = [...history]
  let stubbed = 0
  for (let i = 0; i < working.length; i += 1) {
    const m = working[i]
    if (m === undefined || m.role !== 'tool') continue
    const content = stubFor(names.get(m.tool_call_id) ?? 'the tool', m.content)
    if (content.length >= m.content.length) continue
    working[i] = { role: 'tool', tool_call_id: m.tool_call_id, content }
    stubbed += 1
    if (sizeOf(working) <= target) return sent(working, 0, stubbed, [], [], null)
  }

  /*
   * Stage 2: cut the oldest exchanges, at a boundary that leaves no orphaned
   * tool result, carrying the user turns of the cut prefix forward verbatim.
   *
   * `cut` runs to `working.length` inclusive, which is deliberate and was not
   * always so. When the whole history was a candidate for cutting, the empty
   * tail satisfied any target trivially and a conversation whose last exchange
   * was one token too big lost everything. Now the cut prefix is never empty of
   * the person's words: at `cut === length` what is sent is every user turn
   * they wrote, which is not "nothing" — and if even that is too much, stage 3
   * says so rather than pretending.
   *
   * And it starts at 0, so the whole stubbed history is itself a candidate.
   * That matters in one case: the person's turns alone exceed the target, so
   * the first pass finds no cut at all, and the whole history is within the
   * next limit. Starting at 1 sent the same bytes but counted the first
   * message as evicted-and-carried — `dropped: 1` over nothing, a boundary
   * for the thread to record where nothing happened (found by mutation, and
   * the mutant was the truthful one).
   *
   * Three passes. The target is a GOAL and `room` is the constraint, and
   * falling between them must not mean losing the conversation: under a tool
   * list taking most of the ceiling the target drops below one exchange, no
   * cut satisfies it, and the old code returned an empty history with
   * `overflows: false`. So aim for the target, and settle for what FITS.
   *
   * The middle pass, `room - share`, reserves the summary's room, and it is
   * there because the budget collapsed without it. `summaryChars` is whatever
   * the fitted tail leaves under the ceiling, and a pass that takes the FIRST
   * cut under `room` leaves anything from nothing to one exchange — measured
   * on long-vault-convention against Qwen3 14B at a 26,100 window: 90 and
   * 172 characters, a summariser call spent for a note cut mid-heading. So
   * when the target is out of reach, aim for `room - share` before `room`.
   * The share is then taken from exchanges that were being evicted anyway —
   * never from the person's words, which are in every candidate, and never by
   * evicting an exchange that would have fitted: the last pass is still
   * tightest-first, because a verbatim exchange is worth more than the same
   * tokens of a summary of it.
   *
   * The first pass needs no reserve of its own. A cut under the target leaves
   * `room - target`, and that is at least the share whenever the target is a
   * third of the window (`0.9·window − 4,096 − base` against
   * `window/3 − base`: covered above 7,229 tokens, and no provider declares
   * less than 8,192) and whenever the degraded target `room/3` has
   * `room ≥ 0.15·window`. Below that the tools take all but a sliver, two
   * thirds of the room is the honest maximum, and the vault case is the
   * measurement: at 26,100 the room is 311 tokens and the share 2,610, the
   * person's seven turns are 200 of the 311, so no cut can afford the share
   * and the last pass keeps the closing answer (22 tokens) and leaves 25 —
   * 75 characters. `compact` refuses to call the model under
   * `MIN_SUMMARY_CHARS`, and the trim stands plain, which is right: the
   * person's turns went verbatim and there was no room for anything else.
   */
  const evict = (cut: number, out: readonly ChatMessage[]): Trimmed =>
    sent(
      out,
      cut,
      stubbed,
      usersIn(working, cut),
      working.slice(0, cut).filter((m) => m.role === 'assistant'),
      null,
    )
  for (const limit of [target, room - share, room]) {
    for (let cut = 0; cut <= working.length; cut += 1) {
      if (!cuttable(working, cut)) continue
      const candidate = [...usersIn(working, cut), ...working.slice(cut)]
      if (sizeOf(candidate) <= limit) return evict(cut, candidate)
    }
  }

  /*
   * Stage 3: even the person's own turns, with everything else gone, do not
   * fit. Drop the oldest of them until what is left does — and say how many
   * and why, because this is the only stage that loses something nobody can
   * re-derive. A summary is still offered for the assistant's side; the user
   * turns that went are counted in `lost`, never paraphrased.
   */
  const users = usersIn(working, working.length)
  for (let from = 1; from <= users.length; from += 1) {
    const survivors = users.slice(from)
    if (sizeOf(survivors) <= room) {
      return {
        ...evict(working.length, survivors),
        kept: survivors,
        lost: {
          count: from,
          reason: `${String(from)} of the person's earliest message${from === 1 ? '' : 's'} did not fit even with every reply and result removed`,
        },
      }
    }
  }
  return { ...evict(working.length, []), kept: [], lost: null }
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
