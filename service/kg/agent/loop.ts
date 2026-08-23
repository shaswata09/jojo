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
 * model's behalf, and it does not repair malformed arguments. Both are ways of
 * hiding from the user that the model got it wrong, and both make the trace a
 * worse record of what happened than the thing it is a trace of.
 */

import type { ChatMessage, ToolCall, Turn } from '../core/model-server'
import type { Announcement } from '../tools/tool'
import { CATALOG, describeEntry, functionSpecs } from './catalog'
import type { Effect } from './catalog'
import { callTool, renderOutcome } from './execute'
import type { ToolHost } from './execute'

/* ---------------------------------- trace --------------------------------- */

export type StepStatus = 'running' | 'done' | 'failed' | 'declined'

/**
 * One tool call, as the UI shows it and as it happened.
 *
 * The same object is emitted twice — once `running`, once settled — with the
 * same `id`, so a view can replace a row in place rather than appending a second
 * one. That is what makes the list read as a sequence of things happening rather
 * than a log of things that happened.
 */
export type AgentStep = {
  id: string
  /** The registry name, `application.create`, not the wire spelling. */
  name: string
  title: string
  /**
   * `'unknown'` when the model named a tool that does not exist.
   *
   * Not defaulted to `'read'`, which is what this did and which is a claim
   * rather than an absence: the trace showed a hallucinated tool name under a
   * chip reading "read", asserting the call was harmless when nothing was known
   * about it at all. Caught by running the loop against a server that names a
   * tool wrong on purpose.
   */
  effect: Effect | 'unknown'
  destructive: boolean
  args: unknown
  status: StepStatus
  /** What went back to the model. Shown to the user too — they should see it. */
  detail?: string
  /**
   * The tool's own return value, unserialised.
   *
   * `detail` is what the MODEL reads and is a string by necessity. A screen has
   * no such constraint, and one screen needs the difference: the Graph page
   * renders a `graph.query` answer as a highlighted subgraph and a table, which
   * it cannot do from prose it would have to parse back. Present on success
   * only.
   */
  output?: unknown
  /** The sentence the app's own toast would have shown for this write. */
  announcement?: Announcement
  /** Present and non-null when this step can be taken back. */
  undo?: (() => void) | null
}

export type AgentEvent =
  /** Narration the model produced alongside tool calls, before the final answer. */
  | { type: 'note'; text: string }
  | { type: 'step'; step: AgentStep }
  | { type: 'answer'; text: string }
  | { type: 'error'; reason: string }

/* ---------------------------------- prompt -------------------------------- */

/**
 * What the model is told before anything else.
 *
 * Short on purpose. The tool list is already several thousand tokens and a
 * system prompt competing with it for attention makes both worse. Every line
 * here earns its place by preventing a failure seen in practice: models inventing
 * ids, models writing before reading, and models deleting something because the
 * user said the word "remove" in a sentence about something else.
 */
export const SYSTEM_PROMPT = [
  'You are jojo, a job-search tracker. Every record is on this device and nothing leaves it.',
  'You act by calling tools. Do not describe what you would do — do it, then say what you did.',
  'Ids are never invented. Read a record before acting on it: memory.overview, then memory.search or memory.list, gives you the id.',
  // This line used to read "Ask before deleting anything… wait for the person to
  // agree", and a live run showed why that was wrong. Told to delete an
  // application, the model searched, found it, and asked in PROSE — then the
  // approval gate would have asked a second time on the next turn. Two
  // confirmations for one delete, the first of which is the weaker: it costs a
  // round trip, it cannot show which record is meant, and a model is free to
  // skip it. The gate is code and cannot be talked out of, so it is the only one
  // — and the model is told it exists so it stops inventing its own.
  'To delete something, call the delete tool. The person is shown exactly what it would remove and approves it before anything happens, so you do not need to ask them first.',
  'If you cannot find a record, say so. Never create one so that there is something to act on.',
  'When you are finished, answer in plain prose: what changed, in one or two sentences. No markdown headings, no bullet lists of tool names.',
].join(' ')

/* ----------------------------------- loop --------------------------------- */

/** The one effect the loop needs, supplied by whoever is allowed to have it. */
export type LlmTurnFn = (
  messages: readonly ChatMessage[],
  tools: readonly unknown[],
) => Promise<Turn>

/**
 * Anything carrying an `aborted` flag.
 *
 * Declared structurally rather than naming `AbortSignal`, which is a DOM global
 * this package deliberately does not have — `types/portable-globals.d.ts`
 * re-declares the handful of names the portable layers may use, one at a time,
 * and each has to be defensible on web, Hermes and Electron. A real
 * `AbortSignal` satisfies this without being named, so the apps pass
 * `controller.signal` and a test passes a two-key object.
 */
export type Cancellation = { readonly aborted: boolean }

export type AgentOptions = {
  host: ToolHost
  llm: LlmTurnFn
  /** The conversation so far, WITHOUT the system message. */
  history: readonly ChatMessage[]
  /** What the person just said. */
  prompt: string
  onEvent: (event: AgentEvent) => void
  /**
   * A hard ceiling on model round trips.
   *
   * Eight is measured against the work this app asks for — the longest honest
   * plan is overview, search, read, write, verify — and a model still going at
   * eight is looping rather than working. It stops with a sentence rather than
   * silently: a run that ends without saying why is indistinguishable from a
   * crash.
   */
  maxSteps?: number
  /**
   * Consulted before every destructive call. Absent means "allow", which is the
   * right default for a headless test and the wrong one for a UI — both apps
   * pass one.
   */
  approve?: (step: AgentStep) => boolean | Promise<boolean>
  signal?: Cancellation
  /**
   * The tools to offer this run, by registry name. All of them when absent.
   *
   * A screen that exists to answer ONE kind of question should not hand the
   * model sixty-seven ways to answer it. The Graph page's card is the case that
   * asked for this: it needs `graph.query` and a way to find a name, and the
   * other sixty-five are a bigger prompt, a slower first token, and sixty-five
   * chances to do something the card cannot render. Unknown names are ignored
   * rather than throwing — a caller naming a tool that has been renamed should
   * lose that tool, not the whole feature.
   */
  tools?: readonly string[]
}

export type AgentRun = {
  /** The full exchange, ready to be the next call's `history`. */
  messages: ChatMessage[]
  answer: string | null
  steps: AgentStep[]
  stopped: 'answered' | 'cap' | 'error' | 'aborted'
}

const DEFAULT_MAX_STEPS = 8

/** The whole catalog, or the named subset of it. */
const toolsFor = (only: readonly string[] | undefined) => {
  const all = functionSpecs()
  if (!only) return all
  const wanted = new Set(only.map((n) => CATALOG.find((e) => e.name === n || e.wireName === n)?.wireName))
  return all.filter((t) => wanted.has(t.function.name))
}

export async function runAgent(options: AgentOptions): Promise<AgentRun> {
  const { llm, onEvent, signal } = options
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS
  const tools = toolsFor(options.tools)

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...options.history,
    { role: 'user', content: options.prompt },
  ]
  const steps: AgentStep[] = []
  let counter = 0

  const finish = (
    stopped: AgentRun['stopped'],
    answer: string | null = null,
  ): AgentRun => ({ messages, answer, steps, stopped })

  for (let round = 0; round < maxSteps; round++) {
    if (signal?.aborted) return finish('aborted')

    const turn = await llm(messages, tools)
    if (!turn.ok) {
      onEvent({ type: 'error', reason: turn.reason })
      return finish('error')
    }
    if (signal?.aborted) return finish('aborted')

    // No calls: the model is done talking and this is the answer.
    if (turn.toolCalls.length === 0) {
      const answer = turn.text ?? ''
      onEvent({ type: 'answer', text: answer })
      messages.push({ role: 'assistant', content: answer })
      return finish('answered', answer)
    }

    // Narration alongside calls. Emitted as a note rather than an answer: the
    // model is still working, and showing "let me look that up" as the reply
    // would make the run look finished when it is not.
    if (turn.text) onEvent({ type: 'note', text: turn.text })

    // The assistant's own turn goes in BEFORE the results. OpenAI-compatible
    // servers reject a `tool` message whose `tool_call_id` has no preceding
    // assistant turn asking for it, and the rejection names neither.
    messages.push({
      role: 'assistant',
      content: turn.text,
      tool_calls: turn.toolCalls.map((c) => ({
        id: c.id,
        type: 'function' as const,
        function: { name: c.name, arguments: c.raw },
      })),
    })

    for (const call of turn.toolCalls) {
      counter += 1
      const step = await performCall(options, call, `s${String(counter)}`)
      steps.push(step)
      // Every call gets a reply, including the ones that failed. A model left
      // waiting on a result it never receives will re-issue the same call
      // forever.
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: step.detail ?? 'Done.',
      })
    }
  }

  // The cap. Said out loud, because a run that ends without explaining itself is
  // indistinguishable from a crash.
  const reason = `Stopped after ${String(maxSteps)} rounds without finishing. Nothing further was run — what did happen is listed above.`
  onEvent({ type: 'error', reason })
  return finish('cap')
}

/**
 * One tool call: describe it, ask permission if it is destructive, run it.
 *
 * Emits twice — `running` then settled — so the UI can show a row appear and
 * then resolve. Both carry the same id.
 */
async function performCall(
  options: AgentOptions,
  call: ToolCall,
  id: string,
): Promise<AgentStep> {
  const { host, onEvent, approve } = options
  const entry = CATALOG.find((e) => e.wireName === call.name || e.name === call.name)

  const base: AgentStep = {
    id,
    name: entry?.name ?? call.name,
    title: entry?.title ?? call.name,
    effect: entry?.effect ?? 'unknown',
    destructive: entry?.destructive ?? false,
    args: call.args,
    status: 'running',
  }
  onEvent({ type: 'step', step: base })

  const settle = (step: AgentStep): AgentStep => {
    onEvent({ type: 'step', step })
    return step
  }

  // Arguments that were not JSON. Quoted back rather than guessed at: the model
  // is the only thing that knows what it meant, and a repair here would be a
  // silent edit to what the user is about to be told happened.
  if (call.args === null) {
    return settle({
      ...base,
      status: 'failed',
      detail: `Error: the arguments were not valid JSON. You sent: ${call.raw.slice(0, 200)}`,
    })
  }

  if (base.destructive && approve) {
    const allowed = await approve(base)
    if (!allowed) {
      return settle({
        ...base,
        status: 'declined',
        detail:
          'The person declined this. Do not try it again in this turn; ask them what they would like instead.',
      })
    }
  }

  const outcome = callTool(host, call.name, call.args)
  const detail = renderOutcome(outcome)
  if (!outcome.ok) return settle({ ...base, status: 'failed', detail })
  // Spread conditionally: under `exactOptionalPropertyTypes` an explicit
  // `undefined` is not the same as an absent key, and `AgentStep` declares both
  // of these optional rather than optional-or-undefined.
  return settle({
    ...base,
    status: 'done',
    detail,
    output: outcome.result,
    ...(outcome.announcement ? { announcement: outcome.announcement } : {}),
    ...(outcome.undo ? { undo: outcome.undo } : {}),
  })
}

/**
 * Every catalogued tool as one block of text.
 *
 * For a settings screen or a guide page that wants to show what the model can
 * reach — not for the model, which gets the structured `tools` array. It exists
 * because "what can this thing actually do to my records" deserves an answer a
 * person can read.
 */
export const catalogSummary = () =>
  CATALOG.map((e) => ({
    name: e.name,
    title: e.title,
    effect: e.effect,
    destructive: e.destructive,
    undoable: e.undoable,
    description: describeEntry(e),
  }))
