/**
 * One model round: re-fit the request, ask, re-ask an empty reply, and carry a
 * reply that was cut off at the output limit into the next round.
 *
 * What comes back is either a settled turn for the caller to act on, a request
 * to go round again (a continuation was sent), or the end of the run.
 */

import type { Turn } from '../core/model-server'
import { isEmptyTurn } from '../core/model-server'
import { stubToFit, stubbedNote } from './budget'
import { CONTINUE_PROMPT, CUT_CALL_PROMPT } from './prompt'
import { finish } from './turn-state'
import type { TurnState } from './turn-state'
import type { AgentRun } from './types'

/**
 * How many times one user turn may be carried on past an incomplete reply — a
 * reply cut off at the model's output limit, or a tool call cut off before its
 * arguments closed.
 *
 * Three: a long answer needs one continuation far more often than two, and a
 * model still being cut off on its fourth attempt is at the edge of its window,
 * where a fifth will not fit either. Each one also spends a round of
 * `maxSteps`, which is the bound that cannot be argued with.
 */
export const MAX_CONTINUATIONS_PER_TURN = 3

/**
 * How many times an EMPTY reply — no answer, no call — is asked again before it
 * is reported. Two retries, three sends: `EMPTY_TURN_ATTEMPTS`' number, which
 * the benchmark's transport has applied all along and neither app did. The
 * second send is the one that usually works.
 */
export const EMPTY_TURN_RETRIES = 2

/** A turn the server answered, as opposed to one that failed. */
export type OkTurn = Extract<Turn, { ok: true }>

/** What one round came to. */
export type RoundOutcome =
  /** The run is over, and this is its result. */
  | { readonly kind: 'ended'; readonly run: AgentRun }
  /** A continuation was asked for; the next round reads the answer to it. */
  | { readonly kind: 'again' }
  /** A settled turn: an answer, calls, or both. */
  | { readonly kind: 'turn'; readonly turn: OkTurn }

const ended = (run: AgentRun): RoundOutcome => ({ kind: 'ended', run })

/** Old tool results stubbed until the request fits the window again. */
function refitToWindow(state: TurnState): void {
  const { options, messages, tools, tails } = state
  const { onEvent } = options
  /*
   * Re-fitted before EVERY round, not only before the first.
   *
   * `fitHistory` (history.ts) runs once, and everything after it only grows: each
   * round pushes an assistant turn and one `tool` message per call, each up
   * to the result cap. A run of several rounds could therefore send a request
   * well past the window it was measured against, and a server over its
   * window truncates from the FRONT — taking the system prompt and the
   * person's own question, the two parts that must survive.
   *
   * `stubToFit` only shortens old tool results to their stubs, so nothing is
   * orphaned and nothing is lost that the store cannot give back.
   */
  if (options.window !== undefined) {
    const refit = stubToFit(messages, [tools], options.window, tails)
    if (refit.stubbed > 0) {
      messages.splice(0, messages.length, ...refit.messages)
      onEvent({ type: 'note', app: true, text: stubbedNote(refit.stubbed) })
    }
  }
}

/** One request to the model, streaming its fragments out as events. */
function ask(state: TurnState): Promise<Turn> {
  const { llm, onEvent } = state.options
  /*
   * The delta sink, rebuilt per round so a fragment can never be attributed to
   * the round before it. `onDelta` is optional on the port: a caller that does
   * not stream simply never calls it.
   */
  return llm(
    state.messages,
    state.tools,
    (text) => {
      onEvent({ type: 'delta', text })
    },
    (text) => {
      onEvent({ type: 'thinking', text })
    },
  )
}

/** The model's reply, re-asked while it is empty. */
async function askUntilAnswered(state: TurnState): Promise<Turn> {
  const { signal } = state.options
  let turn = await ask(state)
  /*
   * An empty reply — no answer, no call — asked again, quietly, before it is
   * reported. The apps had no retry at all: one blank turn ended the run with
   * an error, where the benchmark's transport (`sendTurn`) always re-asked.
   * Not a round: nothing was said, so nothing is added to the conversation.
   */
  for (let retry = 0; retry < EMPTY_TURN_RETRIES && isEmptyTurn(turn) && !signal?.aborted; retry++) {
    turn = await ask(state)
  }
  return turn
}

/**
 * True when a reply cut off at the output limit was carried into another
 * round, and the caller should go round again without acting on it.
 */
function continueCutOff(state: TurnState, turn: OkTurn, round: number): boolean {
  const { onEvent } = state.options
  /*
   * Cut off at the completion cap, and said out loud.
   *
   * `finish_reason` was parsed by every reader and consumed by nothing, so a
   * reply that stopped mid-sentence was indistinguishable from one that
   * finished. That is worst on the two paths that matter most here: a
   * truncated `arguments` string reaches `safeParse` as invalid JSON and the
   * model is told "the arguments were not valid JSON", which is the wrong
   * diagnosis and invites the same call again; and a truncated answer is
   * simply shown as the answer.
   *
   * A note rather than an error, because the partial work is still worth
   * having and the round may well continue — but the user is told, because
   * "the reply was cut off" is something they can act on and a half-sentence
   * is not.
   */
  /*
   * CARRIED ON, while there is budget to — reported 2026-10-22: models
   * "often get stuck with an incomplete response", and this branch used to
   * show a note and accept the half-sentence as the answer.
   *
   * A cut-off ANSWER is continued: the partial goes into the conversation,
   * the model is asked to pick up where it stopped, and the two halves are
   * joined into one answer. A cut-off TOOL CALL is never run — arguments that
   * stop mid-string are not the call the model meant — and the whole turn is
   * asked for again, without its broken arguments ever entering history
   * (`repair.ts` records what a malformed call in history does to vLLM).
   *
   * Not on the last round, for the reason the verification gate gives: a
   * continuation spends a round, and spending the last one throws away the
   * part that was written.
   */
  const cutOff = turn.finishReason === 'length'
  if (cutOff && state.continuations < MAX_CONTINUATIONS_PER_TURN && round < state.maxSteps - 1) {
    if (turn.toolCalls.length > 0) {
      state.continuations += 1
      onEvent({
        type: 'note',
        app: true,
        text: 'The model’s tool call was cut off by its output limit before it was complete, so it was not run. It has been asked to send it again.',
      })
      state.messages.push({ role: 'user', content: CUT_CALL_PROMPT })
      return true
    }
    if (turn.text) {
      state.continuations += 1
      if (state.continuedFrom === null) state.continuedFrom = state.messages.length
      state.partial += turn.text
      // No event: the streamed draft simply keeps growing into the next
      // round's fragments, so the person sees one answer being written.
      state.messages.push({ role: 'assistant', content: turn.text })
      state.messages.push({ role: 'user', content: CONTINUE_PROMPT })
      return true
    }
  }
  if (cutOff) {
    onEvent({
      type: 'note',
      app: true,
      text: 'The model stopped mid-reply because it hit its own output limit. Anything below this may be incomplete — a shorter question, or a larger reply limit on the server, usually fixes it.',
    })
  }
  return false
}

/** One round trip to the model, up to the point where its reply is acted on. */
export async function modelRound(state: TurnState, round: number): Promise<RoundOutcome> {
  const { onEvent, signal } = state.options
  if (signal?.aborted) return ended(finish(state, 'aborted'))

  refitToWindow(state)

  const turn = await askUntilAnswered(state)
  /*
   * Abort is checked BEFORE `!turn.ok`, and the order is the whole point.
   *
   * Stopping a run now cancels the HTTP request, and a cancelled fetch comes
   * back as a failed turn — so with the checks the other way round, pressing
   * Stop ended the run with a red error entry blaming the model for a failure
   * the user caused. Reading the flag first means a stop reads as a stop.
   */
  if (signal?.aborted) return ended(finish(state, 'aborted'))
  if (!turn.ok) {
    onEvent({ type: 'error', reason: turn.reason })
    return ended(finish(state, 'error'))
  }

  // What it thought, before what it did — the order it happened in.
  if (turn.reasoning !== undefined) onEvent({ type: 'thought', text: turn.reasoning })

  if (continueCutOff(state, turn, round)) return { kind: 'again' }
  return { kind: 'turn', turn }
}
