/**
 * Acting on a turn that asked for tools: the narration, the assistant turn,
 * and then each call in order — run it, write back what ran, ask whether the
 * run is going anywhere, and reply with the result.
 *
 * Running ONE call — the offered check, repair, the refusals, the approval gate
 * and the tool itself — is `performCall` in `perform-call.ts`. This module owns
 * what the conversation records about it.
 */

import type { ToolCall } from '../core/model-server'
import { resultBudget } from './budget'
import { performCall } from './perform-call'
import type { OkTurn } from './round'
import type { StuckVerdict } from './stuck'
import { finish, settleContinuation } from './turn-state'
import type { TurnState } from './turn-state'
import type { AgentRun, AgentStep } from './types'

/** The narration that came with the calls, emitted as a note. */
function narrate(state: TurnState, turn: OkTurn): void {
  const { onEvent } = state.options
  // Narration alongside calls. Emitted as a note rather than an answer: the
  // model is still working, and showing "let me look that up" as the reply
  // would make the run look finished when it is not.
  // A cut-off answer the model then followed with calls was narration after
  // all: it goes out as a note, joined, and its scaffolding is dropped.
  const narration = state.partial + (turn.text ?? '')
  if (state.partial !== '') {
    settleContinuation(state)
    state.messages.push({ role: 'assistant', content: narration })
  }
  if (narration) onEvent({ type: 'note', text: narration })
}

/** The assistant's turn, pushed ahead of its results and returned by reference. */
function pushAssistantTurn(state: TurnState, turn: OkTurn) {
  // The assistant's own turn goes in BEFORE the results. OpenAI-compatible
  // servers reject a `tool` message whose `tool_call_id` has no preceding
  // assistant turn asking for it, and the rejection names neither.
  /*
   * `arguments` is what the harness UNDERSTOOD, never the model's raw bytes.
   *
   * This carried `c.raw` — the exact text the model emitted — and that was a
   * 400 waiting to happen. vLLM's chat template requires
   * `tool_calls[].function.arguments` to parse as a JSON object; a model that
   * double-encodes once, or trails a `</tool_call>` after the brace, produced
   * a call that `repair.ts` fixed for the executor while its unrepaired text
   * went into history — and every request after it was rejected wholesale:
   * "chat_template: tool_calls[].function.arguments must be a JSON object".
   * The conversation could not recover, because the poison was re-sent on
   * every turn.
   *
   * Found by fault injection on its first live run: 60% corrupted arguments,
   * 3 of 3 calls repaired and executed, 0 of 3 conversations clean, every
   * turn after the first answering 400. Repair had made the call succeed and
   * the conversation fail.
   *
   * So the entry is minted as canonical JSON of the PARSED arguments, or `{}`
   * when nothing parsed, and is UPDATED below once repair has run — the
   * assistant message is held by reference for exactly that. `{}` plus a tool
   * result saying the arguments were invalid is a state the model can retry
   * from; a rejected request is not.
   */
  const assistantTurn = {
    role: 'assistant' as const,
    content: turn.text,
    tool_calls: turn.toolCalls.map((c) => ({
      id: c.id,
      type: 'function' as const,
      function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
    })),
  }
  state.messages.push(assistantTurn)
  return assistantTurn
}

type AssistantTurn = ReturnType<typeof pushAssistantTurn>

/** One call run, numbered and recorded on the run's steps. */
async function executeCall(state: TurnState, turn: OkTurn, call: ToolCall, at: number): Promise<AgentStep> {
  const { options, offered, enforced, messages, tools } = state
  state.counter += 1
  const step = await performCall(options, call, {
    id: `s${String(state.counter)}`,
    offered,
    enforced,
    truncated: turn.finishReason === 'length',
    // Measured against the request as it stands, with this round's earlier
    // results in it, and shared among the calls still to run.
    resultChars:
      options.window === undefined
        ? undefined
        : resultBudget(messages, [tools], options.window, turn.toolCalls.length - at),
  })
  state.steps.push(step)
  return step
}

/** The assistant turn's arguments for this call, rewritten to what ran. */
function recordArgsThatRan(assistantTurn: AssistantTurn, call: ToolCall, step: AgentStep): void {
  /*
   * History carries what RAN. `step.args` is the repaired object when
   * `repair.ts` fixed the call and the parsed object otherwise; `{}` when
   * nothing parsed at all. Written back here, in the scope that holds the
   * assistant message, because `performCall` neither sees history nor
   * should — see the comment on `assistantTurn` for the 400 this prevents.
   */
  const slot = assistantTurn.tool_calls.find((t) => t.id === call.id)
  if (slot) slot.function.arguments = JSON.stringify(step.args ?? {})
}

/** The stuck detector's verdict on this call. */
function observeCall(state: TurnState, turn: OkTurn, call: ToolCall, step: AgentStep): StuckVerdict {
  /*
   * Is this run going anywhere? Asked once per CALL, not once per round —
   * a turn routinely asks for three tools, and a cycle can live entirely
   * inside one of them.
   *
   * `step.name` rather than `call.name`, and that is a user-facing choice:
   * the stop sentence ends up on screen, the step carries the registry name
   * the rest of the app shows, and the wire spelling with underscores
   * appears nowhere a person reads.
   *
   * `step.args` rather than `call.args`, so the fingerprint is taken over
   * the arguments that actually RAN. After repair, `{"limit":"5"}` and
   * `{"limit":5}` are the same call — because they are — and a detector
   * that saw them as two would need one more round to notice a spiral it
   * could already see.
   *
   * `ok` is not optional in practice even though the type allows it:
   * omitting it defaults to the SUCCEEDING schedule, which is later and
   * gentler, and the failing spiral — the one worth catching soonest,
   * because a call that failed identically twice will fail a third time —
   * would never fire.
   */
  return state.stuck.observe({
    call: { name: step.name, args: step.args, raw: call.raw },
    ok: step.status === 'done',
    text: turn.text,
  })
}

/** The call's result, with the round-budget and stuck tails, written back for the model. */
function replyToCall(
  state: TurnState,
  call: ToolCall,
  step: AgentStep,
  verdict: StuckVerdict,
  round: number,
): void {
  const { messages, tails } = state
  // Every call gets a reply, including the ones that failed. A model left
  // waiting on a result it never receives will re-issue the same call
  // forever.
  /*
   * How many rounds are left, once there are few.
   *
   * The cap was a wall: the loop ran to `maxSteps` and stopped with
   * "Stopped after N rounds without finishing" and no answer, having never
   * told the model it was running out. A model that knows it has one round
   * left says what it found; a model that does not calls another tool and
   * gets cut off mid-thought.
   *
   * Only in the last two rounds, and only appended to a result the model is
   * already reading — a budget announced on every round is noise, and a
   * separate system message mid-conversation is a shape some providers
   * handle badly.
   */
  const left = state.maxSteps - round - 1
  const budget =
    left <= 1
      ? `\n\n${left === 0 ? 'This was your last step.' : 'You have one step left.'} Answer now with what you have, and say plainly what you could not finish.`
      : ''

  /*
   * Told, rather than silently answered the same way again. The model's own
   * transcript already contains the first answer; what it has not been told
   * is that it is going in circles, and a repeated identical result reads to
   * it as confirmation.
   *
   * `verdict.text` on a NUDGE is written in the second person, for the model,
   * which is why it is appended to the tool result the model is already
   * reading rather than emitted as an event. On a STOP it is third person,
   * for the person, and goes to `onEvent` below. Swapping the two would show
   * the user an instruction and the model a status line.
   */
  const nudge = verdict.action === 'nudge' ? `\n\n${verdict.text}` : ''
  if (nudge !== '' || budget !== '') tails.set(call.id, `${nudge}${budget}`)

  messages.push({
    role: 'tool',
    tool_call_id: call.id,
    content: `${step.detail ?? 'Done.'}${nudge}${budget}`,
  })
}

/**
 * Every call the turn asked for, in order. The run's result when one of them
 * ended it, or `null` to go on to the next round.
 */
export async function runCalls(state: TurnState, turn: OkTurn, round: number): Promise<AgentRun | null> {
  const { onEvent, signal } = state.options
  narrate(state, turn)
  const assistantTurn = pushAssistantTurn(state, turn)

  for (const [at, call] of turn.toolCalls.entries()) {
    /*
     * Checked per CALL, not once per round.
     *
     * A turn routinely asks for several tools at once, and the check above
     * runs before the first of them — so a model that requested three writes
     * performed all three after the user pressed Stop. Only the destructive
     * ones were caught, and only because the approval gate happened to
     * decline them.
     */
    if (signal?.aborted) return finish(state, 'aborted')
    const step = await executeCall(state, turn, call, at)
    recordArgsThatRan(assistantTurn, call, step)
    const verdict = observeCall(state, turn, call, step)
    replyToCall(state, call, step, verdict, round)

    /*
     * Stopped AFTER the result was pushed, never before.
     *
     * The invariant in `replyToCall` — every call gets a reply — holds on the
     * way out too. `messages` is returned to the caller and stored as the
     * thread's transcript, and an assistant turn asking for a tool with no
     * matching `tool` message is rejected outright by OpenAI-compatible
     * servers on the NEXT request, with a message that names neither. A run
     * that stopped would have poisoned the conversation that followed it.
     */
    if (verdict.action === 'stop') {
      onEvent({ type: 'error', reason: verdict.text })
      return finish(state, 'stuck')
    }
  }
  return null
}
