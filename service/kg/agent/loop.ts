/**
 * L3 — the agent loop: ask the model, run what it asks for, ask again.
 *
 * The network is injected rather than reached. `check-platform` bans `fetch`
 * from this layer and is right to, and the same split that made
 * `model-server.ts` testable makes this testable: the loop is control flow,
 * `llm` is a function the caller supplies, and a test hands it a script instead
 * of a socket. Everything that can be wrong here — a cap that does not hold, an
 * unmatched `tool_call_id`, a refusal reported as a crash — is provable without
 * a model running anywhere.
 *
 * WHAT MAKES THIS SAFE ENOUGH TO POINT AT A 7B. Four things, in order of how
 * much they matter:
 *
 *   1. Every write goes through `runtime.run`, so it is one transaction, one
 *      journal row and one undo — the same contract a button press gets. An
 *      agent cannot reach a code path a user could not.
 *   2. Arguments are parsed by the tool's own schema before anything runs, so a
 *      hallucinated field is a sentence back to the model, not a `TypeError`
 *      from inside a transaction.
 *   3. Destructive calls go through `approve`, which the app wires to a human.
 *   4. `maxSteps` is a hard stop, not a suggestion. A model that loops is the
 *      normal failure of small models, not an exotic one.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not retry a failed tool call on the
 * model's behalf. That is a way of hiding from the user that the model got it
 * wrong, and it makes the trace a worse record of what happened than the thing
 * it is a trace of.
 *
 * IT DOES REPAIR MALFORMED ARGUMENTS, AND THAT SENTENCE USED TO SAY OTHERWISE.
 *
 * The paragraph above read "and it does not repair malformed arguments", on the
 * same reasoning. The reasoning was right about a REPAIR THAT GUESSES and wrong
 * about the thing small models actually do, which is a formatting failure and
 * not a reasoning one. Aider publishes the two channels separately for exactly
 * this reason — QwQ complied with the edit format 91.0% of the time and scored
 * 42.1%; Qwen2.5-Coder-32B complied 94.7% and scored 71.4% — and jojo was
 * scoring the format channel as a capability failure.
 *
 * Measured here, with a probe against this file: `memory_list` sent as
 * `{"type":"application","limit":"5"} </tool_call>` came back "the arguments
 * were not valid JSON", and the same call with `limit: '5'` came back
 * "limit: Needs to be a number". Neither is a mistake about the job. Both cost
 * a whole round trip of somebody's GPU, out of eight.
 *
 * `repair.ts` is what makes that safe rather than a guess: it is schema-driven,
 * it never invents a required field, it refuses an unterminated document, and
 * every change it makes is REPORTED — on the step as `repairs`, and on screen as
 * an app note. `runtime.check` remains the authority, and the approval gate sees
 * the repaired arguments, not the ones that arrived. Nothing is hidden; what
 * changed is that a comma in the wrong place no longer costs a round.
 *
 * TWO MORE GUARDS LIVE HERE NOW, both in their own modules and both wired in by
 * `exit.ts` and `calls.ts`.
 * `stuck.ts` replaces the repeat counter this file used to keep — it fingerprinted
 * the RAW BYTES, so the commonest small-model behaviour, re-emitting the same
 * call with jittered whitespace, defeated it completely and burned all eight
 * rounds (probe: 8/8 rounds, `stopped: 'cap'`). `verify-gate.ts` is consulted
 * when the model answers with no tool call, because "I've moved your Rice
 * application to interview" with zero steps was accepted as an answer.
 *
 * HOW IT IS LAID OUT. `runAgent` below is the whole turn, read top to bottom,
 * and each phase it names lives in a module of its own:
 *
 *   - `offer.ts`        which tools this run may call (lexicon, chooser, allowlist)
 *   - `prompt.ts`       the system prompt and the other sentences sent to the model
 *   - `history.ts`      fitting the conversation to the window, and compaction
 *   - `turn-state.ts`   the state carried between rounds, and the final result
 *   - `round.ts`        one model round: re-fit, ask, empty-reply retry, cut-offs
 *   - `exit.ts`         a call-free reply: the stuck and verification gates; the cap
 *   - `calls.ts`        a reply with calls: narration, results, budget and stuck tails
 *   - `perform-call.ts` one call: offered check, repair, refusals, approval, run
 *   - `types.ts`        the shapes callers see, all re-exported from here
 */

import type { ChatMessage } from '../core/model-server'
import { runCalls } from './calls'
import { capped, settleAnswer } from './exit'
import { placeHistory, planHistory, summariseEvicted } from './history'
import { chooserPick, lexicalChoice, offerFor } from './offer'
import { systemMessage } from './prompt'
import { modelRound } from './round'
import { createTurnState } from './turn-state'
import type { AgentOptions, AgentRun } from './types'

export type {
  AgentEvent,
  AgentOptions,
  AgentRun,
  AgentStep,
  Cancellation,
  LlmTurnFn,
  StepStatus,
} from './types'
export { CONTINUE_PROMPT, CUT_CALL_PROMPT, SYSTEM_PROMPT } from './prompt'
export { EMPTY_TURN_RETRIES, MAX_CONTINUATIONS_PER_TURN } from './round'

/**
 * One user turn: choose the tools, fit the history, then ask the model and act
 * on what it says until it answers, gets stuck, is stopped, or runs out of
 * rounds.
 *
 * Nothing here awaits unless a phase has a model call to wait for — the chooser
 * and the summariser are each awaited only when they were asked — so a run with
 * neither reaches its first model round without yielding, as it always has.
 */
export async function runAgent(options: AgentOptions): Promise<AgentRun> {
  const lexical = lexicalChoice(options)
  const picking = chooserPick(options, lexical)
  const offer = offerFor(options, picking === null ? null : await picking)

  const system = systemMessage(options)
  const question: ChatMessage = { role: 'user', content: options.prompt }

  const plan = planHistory(options, system, question, offer.tools)
  const summarising = summariseEvicted(options, plan)
  const fitted = placeHistory(options, plan, summarising === null ? null : await summarising)

  const state = createTurnState(options, offer, system, question, fitted)

  for (let round = 0; round < state.maxSteps; round++) {
    const outcome = await modelRound(state, round)
    if (outcome.kind === 'ended') return outcome.run
    if (outcome.kind === 'again') continue

  // No calls: the model is done talking and this is the answer.
    const run =
      outcome.turn.toolCalls.length === 0
        ? settleAnswer(state, outcome.turn, round)
        : await runCalls(state, outcome.turn, round)
    if (run !== null) return run
  }

  return capped(state)
}
