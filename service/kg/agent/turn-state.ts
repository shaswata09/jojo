/**
 * The state one user turn carries from round to round, and the two ways of
 * ending or tidying it that every phase shares.
 *
 * One explicit object rather than a dozen variables closed over by one long
 * function: each phase of the loop — a model round, the exit check, a tool
 * call — takes the state, reads what it needs and updates what it owns, and a
 * reader can see from the type alone what survives between rounds.
 */

import type { ChatMessage } from '../core/model-server'
import type { FittedHistory } from './history'
import type { OfferedTools, ToolSpecs } from './offer'
import { createStuckDetector } from './stuck'
import type { StuckDetector } from './stuck'
import type { AgentOptions, AgentRun, AgentStep } from './types'

export const DEFAULT_MAX_STEPS = 8

export type TurnState = {
  readonly options: AgentOptions
  /** The hard ceiling on model round trips for this run. */
  readonly maxSteps: number
  /** What this run was allowed to call. `null` is the whole catalog. */
  readonly offered: Set<string> | null
  /** The offered tools, in the model's own shape. */
  readonly tools: ToolSpecs
  /** True when the list is a boundary rather than the retriever's guess. */
  readonly enforced: boolean
  /** The request as it grows. One array for the whole run: `finish` returns it. */
  readonly messages: ChatMessage[]
  readonly steps: AgentStep[]
  /** What the loop appended to each result, so a cut to fit can keep it. See `stubToFit`. */
  readonly tails: Map<string, string>
  /**
   * Every way this run can be going nowhere, watched at once.
   *
   * Per run rather than per round: the loop a small model gets into spans
   * rounds — call, misread the refusal, call again — and a per-round counter
   * would never see it.
   *
   * THIS REPLACED A COUNTER THAT COULD NOT DO ITS JOB, and the failure is worth
   * recording because it looked like it worked. The old code keyed on
   * `${name}\u0000${raw}` — the RAW BYTES of the arguments — and stopped at
   * three. Probed against this file: a model re-emitting `memory_overview` with
   * one more space inside the braces each round ran all eight rounds and ended
   * as `'cap'`, because eight different byte strings are eight different calls.
   * Jittered whitespace is not an exotic failure; it is what a sampler at any
   * temperature above zero does to an unconstrained argument string.
   *
   * `stuck.ts` fingerprints the PARSED arguments — keys sorted, spacing gone —
   * and watches four more shapes the counter could not see at all: a call that
   * keeps FAILING (stopped sooner, because a repeated failure never resolves
   * itself), a CYCLE of calls (A,B,A,B), the same ANSWER given twice with
   * nothing done between, and one reply CHANTING a phrase at itself.
   */
  readonly stuck: StuckDetector
  /**
   * The conversation as it stood BEFORE this turn, as plain text.
   *
   * Built once, here, and deliberately not from `messages` at the point of use.
   * The verification gate's fabrication rule asks whether a name in the answer
   * came from anywhere real, and `messages` grows during the run to include the
   * model's OWN narration — so reading it live would let a model launder a name
   * it invented in round one by repeating it in round three. The prior
   * conversation cannot do that.
   */
  readonly priorText: readonly string[]
  /** A summary written this turn; reported on every outcome. */
  readonly written: AgentRun['compacted']
  /** Tool calls made so far, which numbers each step's id. */
  counter: number
  /**
   * How many times the verification gate has sent this USER TURN back.
   *
   * Owned here rather than inside the gate because the bound is per user turn
   * and the gate is called once per model turn — see
   * `MAX_VERIFY_NUDGES_PER_TURN`. One `runAgent` call is one user turn, so a
   * counter scoped to this function is exactly the right scope, and the gate
   * enforces the bound itself once it is told the number.
   */
  verifyNudges: number
  /**
   * Carrying a reply past the point where it was cut off. `continuations`
   * counts against `MAX_CONTINUATIONS_PER_TURN`; `partial` is the answer so far,
   * joined to whatever the next round says; `continuedFrom` is where in
   * `messages` the scaffolding began, so the finished answer replaces it with
   * one assistant message rather than leaving the partial and the "continue"
   * request in history.
   */
  continuations: number
  partial: string
  continuedFrom: number | null
}

/** The state a run starts its first round with. */
export function createTurnState(
  options: AgentOptions,
  offer: OfferedTools,
  system: ChatMessage,
  question: ChatMessage,
  fitted: FittedHistory,
): TurnState {
  const { recovered, carriedContext } = fitted
  const messages: ChatMessage[] = [
    system,
    ...(recovered === null ? [] : [recovered]),
    ...(carriedContext === null ? [] : [carriedContext]),
    ...fitted.history,
    question,
  ]
  return {
    options,
    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
    offered: offer.offered,
    tools: offer.tools,
    enforced: offer.enforced,
    messages,
    steps: [],
    tails: new Map<string, string>(),
    stuck: createStuckDetector(),
    priorText: [
      ...(recovered === null ? [] : [String(recovered.content ?? '')]),
      ...(carriedContext === null ? [] : [String(carriedContext.content ?? '')]),
      ...fitted.history.map((m) => (typeof m.content === 'string' ? m.content : '')),
    ],
    written: fitted.written,
    counter: 0,
    verifyNudges: 0,
    continuations: 0,
    partial: '',
    continuedFrom: null,
  }
}

/** The run's result, on whichever outcome ended it. */
export const finish = (
  state: TurnState,
  stopped: AgentRun['stopped'],
  answer: string | null = null,
): AgentRun => ({
  messages: state.messages,
  answer,
  steps: state.steps,
  stopped,
  offered: state.offered === null ? null : [...state.offered],
  // Reported on every outcome, including a failure: a compaction that
  // happened is a fact about the thread whether or not the turn then worked,
  // and losing it would mean summarising the same exchanges again next time.
  ...(state.written === undefined ? {} : { compacted: state.written }),
})

/** Drop the continuation scaffolding; the joined answer stands in for it. */
export function settleContinuation(state: TurnState): void {
  if (state.continuedFrom !== null) state.messages.splice(state.continuedFrom)
  state.continuedFrom = null
  state.partial = ''
}
