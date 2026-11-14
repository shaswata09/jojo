/**
 * How a model request failed, and the sentence for each way it can.
 *
 * Split out of `model-server.ts`, which re-exports every public name here.
 * `refused` is exported for the readers beside it and is not part of that
 * surface.
 */

import { normaliseEndpoint } from './model-server-protocol'

/**
 * How a request failed, in the four ways a caller has to tell apart.
 *
 * `unconfigured` is not an error the user made, `unreachable` means nothing
 * answered, `refused` means something did and said no, and `malformed` means
 * something answered in a shape this does not recognise. The screen phrases each
 * differently because the fix for each is different.
 */
export type ModelFailure = {
  ok: false
  kind: 'unconfigured' | 'unreachable' | 'refused' | 'malformed'
  reason: string
  /**
   * A finer classification, for reporting only. Never shown to anybody.
   *
   * `kind` decides what the app DOES — retry, refuse, send them to Settings —
   * and three different causes want the same handling, so it stays coarse. This
   * says which of the three it was, because "nobody can reach NVIDIA from a
   * browser" and "one laptop went to sleep" are the same `kind` and completely
   * different problems.
   *
   * Set where the failure is CONSTRUCTED, which is the only place that knows.
   * The alternative — matching on `reason` later — reads a sentence written for
   * a human and turns the wording into an API, so the next copy edit silently
   * changes what the metrics mean.
   */
  why?: FailureKind
}

/**
 * How a model request failed, finely enough to act on.
 *
 * `timeout` and `stalled` are separate because the fixes are: nothing answered
 * at all points at an address or a firewall, while a stream that started and
 * stopped points at the model being unloaded or the machine swapping.
 *
 * `blocked` is the BROWSER refusing to make the request — mixed content, or a
 * missing CORS header. It is the failure a person cannot fix by restarting
 * anything, and the one most likely to hit everybody on a hosted copy at once.
 */
export const FAILURE_KINDS = [
  'unconfigured',
  'unreachable',
  'timeout',
  'stalled',
  'blocked',
  'refused',
  'malformed',
  /*
   * A turn with no prose and no tool call, on a 200.
   *
   * Reported as `malformed` — that is still what it IS, a shape this layer
   * cannot use — but named separately here because it is the one failure worth
   * simply asking again for, and `sendTurn` (model-server-retry.ts) does. Cline
   * retries this three times with backoff for the same reason: it was first seen
   * on Ollama, and the cause is the model rather than the server. Without a
   * name of its own the only way to recognise it from outside was to match on
   * the sentence shown to the user, which is exactly what the note on `why`
   * argues against.
   */
  'empty',
] as const

/*
 * An array with a derived type, rather than a bare union, because `analytics.ts`
 * needs these at RUNTIME: its `ALLOWED_STRINGS` set is what makes "no free text
 * is ever reported" a fact rather than a convention, and a set cannot be built
 * from a type. Derived rather than written twice, so the list and the type
 * cannot disagree about what a failure can be.
 */
export type FailureKind = (typeof FAILURE_KINDS)[number]

/** Long enough for a cold local model, short enough to not read as a hang. */
export const MODEL_TIMEOUT_MS = 60_000

/**
 * A rate limit, named rather than quoted.
 *
 * 429 is the one status where the body is reliably useless — providers answer it
 * with `{"detail":"Too Many Requests"}` or an HTML page or nothing at all — and
 * the one where the reader's next move is completely determined: wait. Quoting
 * the server here produced "The server answered 429 — Too Many Requests.",
 * which spends its whole length restating the number.
 *
 * It matters more than it looks because of NVIDIA's free tier, which is in the
 * provider list precisely so somebody without a card can run the agent. Meeting
 * the limit there is not a misconfiguration, it is Tuesday, and an agent run
 * that stops with a puzzling error reads as broken rather than as throttled.
 *
 * `retry-after` is passed through when the server sent one, because the only
 * thing better than "wait" is knowing how long.
 */
const rateLimited = (retryAfter: string | null): ModelFailure => ({
  ok: false,
  kind: 'refused',
  reason:
    'That model is rate limited right now, so this request was refused rather than answered. ' +
    (retryAfter && /^\d+$/.test(retryAfter.trim())
      ? `The server asked for ${retryAfter.trim()} seconds before the next one. `
      : 'Free tiers refill on a timer — a minute is usually enough. ') +
    'Nothing was lost; ask again when it clears.',
})

/**
 * Status 0 is not an answer, and must never be reported as one.
 *
 * A server cannot reply 0. It is what a browser puts on a response it refused to
 * let the page read — an opaque or CORS-blocked one — and the old wording turned
 * that into "The server answered 0.", which reads as a broken server and sent
 * people to check a provider that was working perfectly. Confirmed against
 * NVIDIA: Chrome reports `PreflightMissingAllowOriginHeader` and the page is
 * handed a zero.
 */
const blockedByBrowser = (): ModelFailure => ({
  ok: false,
  kind: 'unreachable',
  /*
   * The one place in the app that KNOWS it was the browser, and it said nothing.
   *
   * `kind` stays `unreachable` because the app's next move is the same — there
   * is no answer to read — but `why` is the whole reason this field exists: a
   * status of zero is not a server that went to sleep, it is a provider nobody
   * on this origin can reach at all, and reported as plain `unreachable` it was
   * indistinguishable from one laptop being off. Left unset, `blocked` was a
   * FailureKind no code path could ever produce.
   */
  why: 'blocked',
  reason:
    'The browser blocked the reply, so nothing here ever saw it — that is not the server failing. ' +
    'It happens when a provider answers without the CORS headers a page needs, which several do. ' +
    'Install the jojo browser extension and it will make the call instead; Settings has it.',
})

/**
 * Turns a non-200 into a sentence, quoting the server rather than paraphrasing.
 *
 * The body is where a local server says the useful thing — vLLM answers a wrong
 * model name with the list of names it does have. Truncated, because some of
 * them answer with an HTML error page.
 */
export const refused = (status: number, body: string, retryAfter: string | null = null): ModelFailure =>
  status === 0
    ? blockedByBrowser()
    : status === 429
      ? rateLimited(retryAfter)
      : {
          ok: false,
          kind: 'refused',
          reason: `The server answered ${String(status)}${body.trim() ? ` — ${body.trim().slice(0, 200)}` : ''}.`,
        }

/**
 * A turn with nothing in it: no prose, no tool call, and a 200 in front of it.
 *
 * ONE CONSTRUCTOR FOR BOTH READERS, and `why` is why it exists. This sentence
 * was written out twice — once in `readTurn`, once in `readOllamaTurn` — so the
 * only way for a caller to recognise the case was to match the copy, and this
 * file already argues on `ModelFailure.why` that turning a sentence written for
 * a human into an API means the next edit to the wording silently changes what
 * the code does. Here it would silently switch the retry off.
 *
 * MEASURED CAUSE, and it is not a broken server. A model that reasons before it
 * speaks spends its whole reply budget thinking, the server stops it at the
 * limit, and what arrives is an assistant message with an empty `content` and no
 * calls — jojo's own Qwen3 14B benchmark runs did this, which is what the loop's
 * empty-reply guard already blames. Cline ships a three-attempt retry for the
 * same failure on Ollama. Asking again very often works, which is the whole
 * argument for tagging it rather than merely reporting it.
 */
export const emptyTurn = (): ModelFailure => ({
  ok: false,
  // Unchanged: `malformed` is what every existing caller branches on, and a turn
  // that says nothing genuinely is a shape this layer cannot use. Only the
  // finer `why` is new, so nothing downstream behaves differently by accident.
  kind: 'malformed',
  why: 'empty',
  reason: 'The model returned an empty turn — no answer and no tool call.',
})

/**
 * The sentence for a request that never got an answer.
 *
 * Shared so both apps blame the same thing in the same words. A timeout and a
 * closed port are one kind here on purpose — from the user's side they are the
 * same fact, "nothing is listening at that address", and the only actionable
 * difference is how long they waited to learn it.
 */
export const unreachable = (endpoint: string, detail: string, timedOut: boolean): ModelFailure => ({
  ok: false,
  kind: 'unreachable',
  why: timedOut ? 'timeout' : 'unreachable',
  reason: timedOut
    ? `Nothing answered ${normaliseEndpoint(endpoint)} within ${String(MODEL_TIMEOUT_MS / 1000)} seconds.`
    : `Could not reach ${normaliseEndpoint(endpoint)} — ${detail}.`,
})

/**
 * A stream that started and then stopped.
 *
 * Distinct wording from `unreachable`, because the facts are different and the
 * user's next move is different. "Nothing answered within sixty seconds" is
 * about a server that never spoke; this is about one that spoke, produced part
 * of an answer, and went quiet — which happens when a model is unloaded
 * mid-generation, when a proxy closes an idle connection, or when the machine
 * is swapping. Telling somebody nothing answered when they watched half a reply
 * appear is the kind of error message that makes people distrust the rest.
 *
 * `sofar` is included when there is any, because a partial answer is evidence
 * about what went wrong and the user has already seen it on screen.
 */
export const stalled = (endpoint: string, sofar: number): ModelFailure => ({
  ok: false,
  kind: 'unreachable',
  why: sofar > 0 ? 'stalled' : 'timeout',
  reason:
    sofar > 0
      ? `${normaliseEndpoint(endpoint)} stopped sending part-way through the answer, after ${String(MODEL_TIMEOUT_MS / 1000)} seconds with nothing further.`
      : `Nothing answered ${normaliseEndpoint(endpoint)} within ${String(MODEL_TIMEOUT_MS / 1000)} seconds.`,
})

export const unconfigured = (): ModelFailure => ({
  ok: false,
  kind: 'unconfigured',
  why: 'unconfigured',
  reason: 'No model is connected. Settings is where the endpoint goes.',
})
