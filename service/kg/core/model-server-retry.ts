/**
 * Asking again when the model said nothing, and only then.
 *
 * Split out of `model-server.ts`, which re-exports every public name here.
 */

import type { ModelFailure } from './model-server-errors'
import type { Thinking } from './model-server-thinking'
import { DEFAULT_THINKING, sendsThinking } from './model-server-thinking'
import type { Turn } from './model-server-turn'

/* -------------------------------------------------------------------------- */
/* Asking again when the model said nothing                                    */
/* -------------------------------------------------------------------------- */

/**
 * A pause, injected.
 *
 * D26, and the same rule as `now`: `check-platform` bans `setTimeout` from core
 * and tools because a module that can schedule is a module whose tests have to
 * wait. The app passes `(ms) => new Promise((r) => setTimeout(r, ms))`; a test
 * passes a function that records the number and returns immediately, which is
 * how the backoff below is asserted in microseconds rather than seconds.
 */
export type Delay = (ms: number) => Promise<void>

/**
 * Three sends in total — one ask and two retries.
 *
 * Cline's number, and it retries the identical failure for the identical reason.
 * It is a ceiling rather than a target: the second attempt is the one that
 * usually works, because what went wrong the first time was a reply budget spent
 * on reasoning rather than anything about the request.
 *
 * Not higher, because each attempt is a whole prompt through a local model —
 * seconds, not milliseconds — and a fourth try that fails the same way costs a
 * user more waiting to reach the same sentence.
 */
export const EMPTY_TURN_ATTEMPTS = 3

/** The first wait. Doubles per retry — see `emptyRetryDelayMs`. */
export const EMPTY_RETRY_BASE_MS = 500

/**
 * How long to wait before asking again, after `attempt` empty turns.
 *
 * 500ms then 1s. Deliberately short: this is not a rate limit, it is a model
 * that produced nothing, and there is nothing to wait FOR — the pause exists so
 * that a server which is genuinely unwell (a model mid-unload, a machine
 * swapping) is not hit three times inside a millisecond, and so that the retries
 * are visibly a retry rather than a spin.
 *
 * No jitter, and none is wanted. Jitter spreads a herd of clients off one clock;
 * jojo is one client talking to one server on the same desk, and `kg/` has no
 * randomness to spread it with (D26).
 */
export const emptyRetryDelayMs = (attempt: number): number =>
  EMPTY_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1)

/**
 * Whether this failure is the model having said nothing at all.
 *
 * Reads the tag `emptyTurn` sets, never the sentence. NOTE for whoever owns
 * `anthropic.ts`: its reader builds the same sentence by hand without the tag,
 * so an empty turn from Claude is not retried. That is the safe direction to be
 * wrong in — a hosted model with a large reply budget is not the one this failure
 * was measured on — but it is a real gap, and one line of `why: 'empty'` there
 * closes it.
 */
export const isEmptyTurn = (turn: Turn): boolean => !turn.ok && turn.why === 'empty'

/**
 * A server complaining about the thinking field itself.
 *
 * Matching on the server's own words, which is a different thing from matching
 * on ours: this reads a body jojo quoted rather than a sentence jojo wrote, and
 * the shape of an API's error is that API's contract. `refused` puts up to 200
 * characters of it in `reason`, which is where the name lands.
 *
 * WHY IT IS NEEDED AT ALL. `think` on Ollama is rejected by some builds for a
 * model with no thinking capability — Gemma 3 is exactly such a model and is one
 * of the three jojo is built for — and no client can know a model's capabilities
 * before it asks. Without this, a default of `off` would break the commonest
 * local setup there is; with it, the cost of guessing wrong is one extra round
 * trip and a request that then succeeds.
 *
 * Deliberately loose. A false positive costs one repeated request without the
 * field, which is the same request jojo would have sent a week ago; a false
 * negative costs the user a provider that will not answer at all.
 */
export const rejectsThinking = (turn: Turn): boolean =>
  !turn.ok &&
  turn.kind === 'refused' &&
  /think|reasoning_effort|chat_template_kwargs/i.test(turn.reason)

/**
 * One whole send-and-parse, supplied by the app.
 *
 * A callback rather than a request, because everything between the two lives in
 * the app: the relay decision, the abort signal, streaming, `readTurnFor` and
 * `guardTruncation`. Handing this layer a `fetch` would put the network in core;
 * handing it a prebuilt `ModelRequest` would leave it unable to rebuild one with
 * a different thinking mode, which is half of what `sendTurn` does.
 *
 * `thinking` is passed IN so the caller builds the request with it — see
 * `chatRequest`'s `options`. `attempt` is 1-based and is there for the caller to
 * report with, nothing here reads it back.
 */
export type TurnAttempt = (plan: {
  readonly attempt: number
  readonly thinking: Thinking
}) => Promise<Turn>

export type SendTurnOptions = {
  /** Required, and injected. See `Delay`. */
  readonly delay: Delay
  /** Defaults to `DEFAULT_THINKING`. */
  readonly thinking?: Thinking
  /** Total sends before giving up. Defaults to `EMPTY_TURN_ATTEMPTS`. */
  readonly attempts?: number
  /**
   * The provider, when the caller knows it — and it always does.
   *
   * Optional only so that a test can drive this with a bare thunk. With it, the
   * thinking downgrade fires only when a thinking field was actually sent; with
   * it absent the check falls back to the mode alone, which is right more often
   * than not and never unsafe.
   */
  readonly provider?: string
}

/**
 * Ask, and ask again if the model said nothing.
 *
 * ## The failure
 *
 * A turn with no content and no tool call, on a 200. Measured on Ollama by
 * Cline, which ships a three-attempt retry for it, and reproduced here on Qwen3
 * 14B: the model reasons until the reply limit stops it and returns an empty
 * message. jojo errored on the first one, which turned a transient into a dead
 * end for the user.
 *
 * ## What it deliberately does not retry
 *
 * Anything else. A refusal, a rate limit, a truncated prompt, an unreachable
 * server and a malformed body are all left exactly as they were: they are facts
 * about the request or the server, and asking again produces the same fact more
 * slowly. NVIDIA's entry in the provider table makes the point in writing — "a
 * silent retry against a rate limit is how one slow answer becomes four" — and
 * this retries a strictly narrower thing than that warning forbids.
 *
 * ## Exhaustion is still an empty turn
 *
 * The failure that comes back after the last attempt keeps `why: 'empty'` and
 * `kind: 'malformed'`, so nothing downstream mistakes it for the server refusing
 * — it is the same failure jojo would have reported immediately before, with the
 * count added and the cause named. The loop's own empty-reply guard therefore
 * still fires, on a turn that has now genuinely been asked for three times.
 *
 * ## The one thing it changes about the request
 *
 * A server that rejects the thinking field is re-asked without it, once, with no
 * delay — the server answered straight away and the fix is deterministic, so a
 * pause would only be latency. That send does not count against the retry
 * budget, because nothing was asked of the model: the request never reached one.
 */
export async function sendTurn(attempt: TurnAttempt, options: SendTurnOptions): Promise<Turn> {
  const total = Math.max(1, options.attempts ?? EMPTY_TURN_ATTEMPTS)
  /*
   * Every send, including the one downgrade, which does not count as an attempt.
   *
   * A SECOND COUNTER AND NOT A BOOLEAN, and the reason is a measurement rather
   * than taste. The first version reasoned its way out of a `for(;;)`: the
   * downgrade sets `thinking` to the one mode that puts nothing on the wire, so
   * `carried` is false on the next pass and the branch is unreachable. That is
   * true, and it was still the wrong thing to rely on. Mutation-testing this
   * function with the assignment changed to a no-op did not fail a test — it
   * HUNG, and no test timeout fired: an `await` over a delay that resolves
   * immediately never yields to the macrotask queue, so vitest's own timer
   * cannot run and the whole suite stops dead. In an app that is a frozen tab.
   *
   * A counter cannot be reasoned wrong. It bounds the loop by arithmetic no
   * matter what the branches below do.
   *
   * NOTHING REACHES IT, and that is the point rather than a hole in the tests.
   * Deleting `calls < ceiling` and `calls >= ceiling` is the one mutant of this
   * function that survives the suite: no input can get there while the branches
   * are correct. It is a bound, not a behaviour — the case for keeping it is the
   * mutant above, which is not a wrong answer but a stopped process.
   */
  const ceiling = total + 1
  let thinking = options.thinking ?? DEFAULT_THINKING
  let sends = 0

  for (let calls = 1; ; calls += 1) {
    const turn = await attempt({ attempt: sends + 1, thinking })
    if (turn.ok) return turn

    const carried =
      options.provider === undefined
        ? thinking !== 'server-default'
        : sendsThinking(options.provider, thinking)
    if (carried && rejectsThinking(turn) && calls < ceiling) {
      thinking = 'server-default'
      continue
    }

    sends += 1
    if (!isEmptyTurn(turn)) return turn
    if (sends >= total || calls >= ceiling) return exhaustedEmptyTurn(total)
    await options.delay(emptyRetryDelayMs(sends))
  }
}

/**
 * The sentence for a model that said nothing however often it was asked.
 *
 * Names the count, because "it returned nothing" and "it returned nothing three
 * times" are different facts and only the second one tells the reader that jojo
 * already tried the obvious thing. The rest is the loop's own wording for this
 * cause, which was written against the same measurement and should not be said
 * two different ways in one app.
 */
export const exhaustedEmptyTurn = (attempts: number): ModelFailure => ({
  ok: false,
  kind: 'malformed',
  why: 'empty',
  reason:
    `The model returned an empty turn — no answer and no tool call — ${String(attempts)} times running. ` +
    'Models that reason before they speak — Qwen3, GPT-OSS, DeepSeek-R1 — do this when the server’s ' +
    'reply limit is small: raise it, or run the model with thinking turned off. Nothing was changed.',
})
