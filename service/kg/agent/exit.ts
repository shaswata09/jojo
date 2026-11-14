/**
 * The exit check: what happens when the model answers without calling
 * anything, and what happens when the rounds run out.
 *
 * A call-free reply is the model saying it is finished, and four things are
 * asked of it before it is accepted, in this order: is it a tool call written
 * as prose, is it empty, is the run going in circles (`stuck.ts`), and does the
 * answer claim something the store does not show (`verify-gate.ts`).
 */

import { finish, settleContinuation } from './turn-state'
import type { TurnState } from './turn-state'
import type { OkTurn } from './round'
import type { AgentRun } from './types'
import { verifyBeforeExit } from './verify-gate'
import type { VerifyReason } from './verify-gate'

/**
 * A code fence stripped, but only when it wraps the WHOLE text.
 *
 * A model with no tool template often puts the bare object in a ```json block
 * — the fence is the one thing that can surround an unframed call without
 * being prose, so it is removed before the whole-answer test below rather than
 * failing it.
 */
const unfenced = (text: string): string => {
  const fenced = /^```[a-z]*\s*([\s\S]*?)\s*```$/i.exec(text)
  return fenced?.[1]?.trim() ?? text
}

/**
 * The name of a tool this text is trying to call, or null.
 *
 * Two shapes, because two families of small model produce them. Hermes and
 * Qwen-style models wrap the call in `<tool_call>…</tool_call>`; others emit a
 * bare JSON object with a `name` and `arguments`. Both arrive in `content`
 * when the server has no tool template for the model.
 *
 * Matched against what was actually OFFERED rather than against any
 * tool-shaped JSON. A model naming a tool it was not offered is a different
 * problem and `performCall` already refuses it.
 *
 * That check was ALSO the whole defence against mistaking prose for a call,
 * and it never was one — see the whole-answer rule in the body for why asking
 * about a tool is the case it cannot catch.
 */
function toolCallInText(text: string, offered: Set<string> | null): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return null

  const envelope = /<tool_call>\s*([\s\S]*?)<\/tool_call>/i.exec(text)
  /*
   * Without an envelope the object has to be the WHOLE answer, and that is a
   * fix rather than a tightening.
   *
   * Matching a fragment made asking about a tool unanswerable, because ASKING
   * about a tool is what makes the retriever offer it: the name check below
   * passes for exactly the tool the question named. Reproduced end to end —
   * "what would application.create do?", answered with a sentence that quotes
   * a complete `name`/`arguments` object and then explains what it does — and
   * the correct answer was thrown away and replaced with an error sending the
   * person to fix a `--jinja` flag on a server that is working.
   *
   * Nothing surrounds a call the transport failed to frame; that is what the
   * failure IS. So requiring the object to be the entire reply keeps every
   * shape this was written for and gives prose about a tool back to the person
   * who asked for it.
   */
  const body = envelope?.[1] ?? unfenced(trimmed)
  if (envelope === null && !(body.startsWith('{') && body.endsWith('}'))) return null

  const named = /"name"\s*:\s*"([\w.]+)"/.exec(body)
  const name = named?.[1]
  if (name === undefined) return null

  // A call needs arguments, or a bare `{"name": …}` in prose about anything
  // would trip this.
  if (envelope === null && !/"(arguments|parameters)"\s*:/.test(body)) return null

  /*
   * Compared against the set already resolved for this run rather than
   * re-resolving. `offered` is null when everything was offered, and a null
   * here means "any known tool counts" — which is right: the question is
   * whether the model was trying to call something it could have called.
   */
  const dotted = name.replace(/_/g, '.')
  return offered === null || offered.has(name) || offered.has(dotted) ? dotted : null
}

/**
 * What the PERSON is told when the verification gate sends an answer back.
 *
 * One sentence per reason, because the reasons are not interchangeable and a
 * single generic line would be the least useful of the four. The model gets
 * `verdict.nudge`, which is an instruction in the second person; this is the
 * fact in the third, for the screen.
 *
 * Written to be readable by somebody who does not know a gate exists: it says
 * what the assistant claimed, what the store actually shows, and that a round is
 * being spent on the difference. Somebody who sees this and then sees a correct
 * answer has learned the app checked; somebody who sees it and then sees the
 * same claim again has learned not to trust that claim, which is the whole
 * point.
 */
const VERIFY_NOTE: Record<VerifyReason, string> = {
  'claimed-write-none-attempted':
    'The assistant said it had changed something, but nothing that writes was called and the store is unchanged. It has been asked to check before finishing.',
  'claimed-write-none-landed':
    'The assistant said it had changed something, but every write it tried this turn failed or was declined, so the store is unchanged. It has been asked to check before finishing.',
  'named-unread-record':
    'The assistant named a record it did not read this turn. It has been asked to look it up before answering, rather than answering from memory.',
  'bare-acknowledgement':
    'The assistant agreed to do the work without doing it, so nothing has happened yet. It has been asked to make the call.',
  'stopped-mid-task':
    'The assistant stopped partway, saying what it would do next without doing it. It has been asked to carry on.',
}

/** A call written into the reply's text, refused as a server misconfiguration. */
function refuseCallAsText(state: TurnState, answer: string): AgentRun | null {
  const { onEvent } = state.options
  /*
   * Unless it IS a tool call, written as prose.
   *
   * A model whose server has no matching tool template emits
   * `<tool_call>{"name":…}</tool_call>` — or a bare JSON object naming a
   * tool — in `content` instead of in `tool_calls`. That is a server
   * configuration problem (llama.cpp without `--jinja`, LM Studio with the
   * wrong template) and it is extremely common on small local models.
   *
   * Reported as an ERROR naming the cause rather than printed as the
   * answer. Printing it is what the code did: the chat bubble showed raw
   * JSON, the run status said `answered`, no step was recorded, and it was
   * indistinguishable from the model politely declining to act. Nobody can
   * debug that from the outside.
   *
   * Deliberately NOT executed. Recovering a call the transport did not
   * frame means trusting text the model produced to be a call the user
   * approved, and the whole approval gate rests on the transport telling
   * the two apart.
   */
  const looksLikeCall = toolCallInText(answer, state.offered)
  if (looksLikeCall !== null) {
    onEvent({
      type: 'error',
      reason: `The model tried to call “${looksLikeCall}” by writing it out as text rather than as a tool call. That usually means the server is running without a tool template for this model — in llama.cpp it is the --jinja flag, and in LM Studio it is the prompt template on the model's page. Nothing was run.`,
    })
    return finish(state, 'error')
  }
  return null
}

/** A reply with nothing in it, on a run that did nothing. */
function refuseEmpty(state: TurnState, turn: OkTurn, answer: string): AgentRun | null {
  const { onEvent } = state.options
  /*
   * Nothing said, and nothing done. That is not an answer.
   *
   * Measured against Qwen3 14B: `file-a-new-document` failed on every
   * condition with zero calls, an empty reply, and a run status of
   * `answered`. The model spends its whole output budget reasoning before
   * it speaks, hits the server's reply limit mid-thought, and returns
   * nothing at all — and jojo showed an empty chat bubble and called the
   * turn finished.
   *
   * This is the same argument the branch above makes about a call written
   * as prose, and it lands harder: there the bubble at least held text
   * somebody could puzzle over. Reported as an ERROR that names the cause,
   * because the fix is a server setting and nobody can guess that from a
   * blank reply.
   *
   * Only when NOTHING happened. A run whose steps landed has done the work
   * — the announcements are on screen and the records are written — and
   * calling that an error would be a lie about a store that did change.
   */
  if (answer.trim() === '' && state.steps.length === 0) {
    onEvent({
      type: 'error',
      reason:
        turn.finishReason === 'length'
          ? 'The model used its whole reply budget without answering or calling anything. Models that reason before they speak — Qwen3, GPT-OSS, DeepSeek-R1 — do this when the server’s reply limit is small: raise it, or set Reasoning to Off in Settings → Model. Nothing was changed.'
          : 'The model returned an empty reply and did not call anything, so nothing was changed. Asking again, more specifically, usually works.',
    })
    return finish(state, 'error')
  }
  return null
}

/** The stuck detector's verdict on the reply itself; only a stop is acted on. */
function stopIfSpinning(state: TurnState, answer: string): AgentRun | null {
  const { onEvent } = state.options
  /*
   * The reply itself, before anything is decided about it.
   *
   * Only a STOP is honoured here, and the omission is deliberate rather than
   * an oversight. Two of the detector's five shapes can fire on a call-free
   * turn: `chant` (this one reply has come apart, repeating a phrase at
   * itself) and `echo` (the same answer twice with nothing done between).
   * Both stops are real and neither has any other guard.
   *
   * Its `echo` NUDGE is dropped on purpose. A nudge on this path means "do
   * not finish yet", and the verification gate below is the purpose-built
   * mechanism for exactly that decision, with a bound — one per user turn —
   * that exists so a model which cannot satisfy it is not argued with
   * forever. A second, separately-bounded thing that also blocks the exit
   * would quietly double that budget, which is the composition failure
   * mutation testing cannot see: two correct guards joining wrongly.
   *
   * WHICH LEAVES `chant` AS THE ONLY VERDICT THIS BRANCH CAN ACT ON TODAY,
   * and the arithmetic is worth writing down rather than discovering later.
   * `echoStop` is three identical answers, and at most TWO call-free answers
   * can occur in a run: the gate argues once, and every answer after that is
   * accepted. So the `echo` stop is unreachable while
   * `MAX_VERIFY_NUDGES_PER_TURN` is 1. The branch still tests `action ===
   * 'stop'` rather than `kind === 'chant'`, because it is one branch and
   * because raising that bound should make the other half start working
   * without anything here changing — but nobody should read this line and
   * believe an echo can stop a run today. The counts still accumulate, so
   * the day it can, it will.
   */
  const spinning = state.stuck.observe({ call: null, text: answer })
  if (spinning.action === 'stop') {
    // Third-person, for the person reading the screen. See `StuckVerdict`:
    // the nudge text and the stop text have different audiences and are not
    // interchangeable.
    onEvent({ type: 'error', reason: spinning.text })
    return finish(state, 'stuck')
  }
  return null
}

/** True when the verification gate sent the answer back for another round. */
function sentBack(state: TurnState, answer: string, round: number): boolean {
  const { onEvent } = state.options
  /*
   * The pre-exit verification gate: one question asked the moment the model
   * says it is finished.
   *
   * A model that calls NOTHING and announces success was scored as having
   * succeeded — `bench-score.ts` carries the number in its own comment, "an
   * agent that calls nothing and always answers scored 16/36 clean and 45/69
   * turns". Probed against this file: "move my Rice application to
   * interview", answered "I've moved your Rice application to interview.",
   * zero steps, `stopped: 'answered'`. `answerMust` catches that at SCORING
   * time, which helps whoever reads the benchmark and does nothing at all
   * for the person whose application did not move.
   *
   * It is the first of the four changes LangChain shipped to take
   * GPT-5.2-Codex from 52.8% to 66.5% on Terminal-Bench 2.0 with no model
   * change, and it is the cheapest: no clock, no model call, string work
   * over facts this function already has.
   *
   * NOT ON THE LAST ROUND, and that guard is not caution — it is the
   * difference between the gate helping and the gate destroying an answer.
   * A nudge spends a round, so nudging on the final one falls straight out
   * of the loop in `runAgent` and reports `'cap'` with `answer: null`: a perfectly
   * good reply thrown away and replaced with "stopped after N rounds". The
   * gate is worth a round only when there is a round to spend.
   */
  const verdict =
    round < state.maxSteps - 1
      ? verifyBeforeExit({
          request: state.options.prompt,
          answer,
          steps: state.steps,
          history: state.priorText,
          nudgesUsed: state.verifyNudges,
        })
      : ({ accept: true } as const)

  if (!verdict.accept) {
    state.verifyNudges += 1
    /*
     * Told to the person as well as to the model, and in the person's own
     * voice rather than the model's.
     *
     * `verdict.nudge` opens "Stop: you said you changed something…" — it is
     * an instruction, written second-person, FOR THE MODEL. Showing that
     * verbatim on screen would read as the app barking at the reader. What
     * the reader needs is the fact underneath it: the assistant said one
     * thing and the store says another, and the run is spending a round on
     * it rather than quietly accepting the claim.
     *
     * `app: true` so it is never replayed to the model as its own prior
     * speech next turn — the model already gets the nudge itself, below.
     */
    onEvent({ type: 'note', app: true, text: VERIFY_NOTE[verdict.reason] })
    state.messages.push({ role: 'assistant', content: answer })
    /*
     * `user`, not `system`. The comment on the step-budget note in `calls.ts`
     * records why: a system message appearing mid-conversation is a
     * shape some OpenAI-compatible servers handle badly, and this one has to
     * survive on llama.cpp and Ollama as well as on a hosted endpoint.
     */
    state.messages.push({ role: 'user', content: verdict.nudge })
    return true
  }
  return false
}

/**
 * A call-free reply, settled: the run's result, or `null` when the gate sent
 * it back and the loop should go round again.
 */
export function settleAnswer(state: TurnState, turn: OkTurn, round: number): AgentRun | null {
  const { onEvent } = state.options
  // Joined to whatever earlier rounds wrote before being cut off.
  const answer = state.partial + (turn.text ?? '')
  settleContinuation(state)

  const refused =
    refuseCallAsText(state, answer) ?? refuseEmpty(state, turn, answer) ?? stopIfSpinning(state, answer)
  if (refused !== null) return refused
  if (sentBack(state, answer, round)) return null

  onEvent({ type: 'answer', text: answer })
  state.messages.push({ role: 'assistant', content: answer })
  return finish(state, 'answered', answer)
}

/** The round budget spent without an answer. */
export function capped(state: TurnState): AgentRun {
  const { onEvent } = state.options
// The cap. Said out loud, because a run that ends without explaining itself is
// indistinguishable from a crash.
  const reason = `Stopped after ${String(state.maxSteps)} rounds without finishing. Nothing further was run — what did happen is listed above.`
  onEvent({ type: 'error', reason })
  return finish(state, 'cap')
}
