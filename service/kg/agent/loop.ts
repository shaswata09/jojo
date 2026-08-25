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
import { CATALOG, functionSpecs } from './catalog'
import { inCatalogOrder, offeredFor } from './retrieve'
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
  /**
   * A fragment of the answer, as it is generated.
   *
   * Only when the transport streams — a relayed cloud call and a provider whose
   * stream this app cannot read both answer in one piece, and then the first
   * thing a listener sees is `answer`. So a listener has to treat deltas as an
   * optimisation and `answer` as the truth, never assume it saw every fragment.
   */
  | { type: 'delta'; text: string }
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
  // Deliberately NOT "nothing leaves this device". This string is sent to
  // whichever model is configured — which may be Anthropic, OpenAI, OpenRouter
  // or Groq — so on a cloud provider the sentence was transmitted to a third
  // party alongside the very records it claimed never left. What the model
  // needs from this line is the operating assumption, not a privacy promise it
  // is in no position to keep.
  'You are jojo, a job-search tracker. Every record lives in this one store — there is no server to ask and no other copy to reconcile with.',
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
  'Call the tool you mean directly. Depending on their settings the person may be shown exactly what it would change and asked to approve it before anything happens, so you never need to ask them first in prose.',
  'If you cannot find a record, say so. Never create one so that there is something to act on.',
  'When you are finished, answer in plain prose: what changed, in one or two sentences. No markdown headings, no bullet lists of tool names.',
].join(' ')

/* ----------------------------------- loop --------------------------------- */

/** The one effect the loop needs, supplied by whoever is allowed to have it. */
export type LlmTurnFn = (
  messages: readonly ChatMessage[],
  tools: readonly unknown[],
  /**
   * Called with each fragment of prose as it is generated, when the transport
   * streams. Optional on the implementing side: an app that does not stream
   * ignores the parameter and answers in one piece, and the loop's behaviour is
   * identical either way.
   */
  onDelta?: (text: string) => void,
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
  /**
   * Which steps have to be approved. Defaults to `destructive`.
   *
   * `destructive` is delete and admin — 13 of the 81 catalog entries, the ones
   * whose catalog description already warns the model about them. `writes` is
   * every step that is not a read: 73 of them, which is what "ask me before it
   * changes anything" actually means.
   *
   * The policy is the CALLER'S, which is why it is here rather than widening
   * `destructive` in `catalog.ts`. That flag is load-bearing elsewhere — it
   * fills MCP's `destructiveHint` and appends "this removes a record" to the
   * description the model reads — and marking every create destructive would
   * lie to both.
   */
  gate?: 'destructive' | 'writes'
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
   *
   * ## It is an ALLOWLIST, not a suggestion
   *
   * This used to narrow only the prompt. The executor resolved every call
   * against the whole catalog — `performCall` searched `CATALOG` and `callTool`
   * searched it again — so a tool that was never offered ran anyway if the model
   * named it. That is not a theoretical hole: the Graph page's card offers two
   * READS, and a model that answered "Ask the graph" with `application_create`
   * had the record written. A read-only card could write to the store.
   *
   * Narrowing the prompt is a hint to a model that may ignore it. Narrowing the
   * executor is the part that holds. Both happen here now, from one list, so
   * they cannot disagree about what was offered.
   */
  tools?: readonly string[]
  /**
   * Let the retriever choose the tools when the caller has not.
   *
   * Off by default and opt-in on purpose. A caller that already narrowed —
   * AskBox with two reads, the pipelines with `toolsForKind` — has made a
   * deliberate decision, and a retriever that second-guessed it would be
   * offering an opinion about a choice already made in code. `tools` therefore
   * always wins: this only ever applies to a caller that named nothing.
   *
   * See `retrieve.ts` for what it does and, more importantly, when it abstains.
   */
  retrieve?: {
    /** What the conversation has already accumulated. Only ever grows. */
    carried?: readonly string[] | null
    /** Names the stored transcript shows being called. Always kept. */
    fromHistory?: readonly string[]
  }
}

export type AgentRun = {
  /** The full exchange, ready to be the next call's `history`. */
  messages: ChatMessage[]
  answer: string | null
  steps: AgentStep[]
  stopped: 'answered' | 'cap' | 'error' | 'aborted'
}

const DEFAULT_MAX_STEPS = 8

/**
 * The registry names a caller offered, resolved and de-aliased.
 *
 * Both spellings are accepted — `application.create` and `application_create` —
 * because callers write the registry name and the wire carries the other, and a
 * caller that had to know which one this wanted would eventually pick wrong.
 * Unknown names drop out rather than throwing: a caller naming a tool that has
 * been renamed should lose that tool, not the whole feature.
 *
 * `undefined` in, `null` out, and `null` means "everything" everywhere below —
 * an empty Set would mean "nothing", and the two must never be confused.
 */
const resolveOffered = (only: readonly string[] | undefined): Set<string> | null => {
  if (!only) return null
  const out = new Set<string>()
  for (const name of only) {
    const entry = CATALOG.find((e) => e.name === name || e.wireName === name)
    if (entry) {
      out.add(entry.name)
      out.add(entry.wireName)
    }
  }
  return out
}

/** The whole catalog, or the named subset of it, in the model's own shape. */
const toolsFor = (offered: Set<string> | null) => {
  const all = functionSpecs()
  if (!offered) return all
  return all.filter((t) => offered.has(t.function.name))
}

export async function runAgent(options: AgentOptions): Promise<AgentRun> {
  const { llm, onEvent, signal } = options
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS
  // Resolved ONCE, and used twice: to build the prompt's tool list, and to
  // refuse a call for anything outside it. One list, so the offer and the
  // enforcement cannot describe different sets.
  /*
   * An explicit list wins outright; the retriever only speaks when nobody else
   * has. `offeredFor` returns null for a message it does not understand, which
   * lands back on "offer everything" — the behaviour this app had before the
   * retriever existed, so being unsure costs tokens and never an answer.
   */
  const chosen =
    options.tools ??
    (options.retrieve
      ? inCatalogOrder(
          offeredFor(
            options.prompt,
            options.retrieve.carried ? new Set(options.retrieve.carried) : null,
            options.retrieve.fromHistory ?? [],
          ) ?? new Set(CATALOG.map((e) => e.name)),
        )
      : undefined)

  // Resolved ONCE, and used twice: to build the prompt's tool list, and to
  // refuse a call for anything outside it. One list, so the offer and the
  // enforcement cannot describe different sets.
  const offered = resolveOffered(chosen)
  const tools = toolsFor(offered)

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...options.history,
    { role: 'user', content: options.prompt },
  ]
  const steps: AgentStep[] = []
  let counter = 0

  const finish = (stopped: AgentRun['stopped'], answer: string | null = null): AgentRun => ({
    messages,
    answer,
    steps,
    stopped,
  })

  for (let round = 0; round < maxSteps; round++) {
    if (signal?.aborted) return finish('aborted')

    /*
     * The delta sink, rebuilt per round so a fragment can never be attributed to
     * the round before it. `onDelta` is optional on the port: a caller that does
     * not stream simply never calls it.
     */
    const turn = await llm(messages, tools, (text) => {
      onEvent({ type: 'delta', text })
    })
    /*
     * Abort is checked BEFORE `!turn.ok`, and the order is the whole point.
     *
     * Stopping a run now cancels the HTTP request, and a cancelled fetch comes
     * back as a failed turn — so with the checks the other way round, pressing
     * Stop ended the run with a red error entry blaming the model for a failure
     * the user caused. Reading the flag first means a stop reads as a stop.
     */
    if (signal?.aborted) return finish('aborted')
    if (!turn.ok) {
      onEvent({ type: 'error', reason: turn.reason })
      return finish('error')
    }

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
      /*
       * Checked per CALL, not once per round.
       *
       * A turn routinely asks for several tools at once, and the check above
       * runs before the first of them — so a model that requested three writes
       * performed all three after the user pressed Stop. Only the destructive
       * ones were caught, and only because the approval gate happened to
       * decline them.
       */
      if (signal?.aborted) return finish('aborted')
      counter += 1
      const step = await performCall(options, call, `s${String(counter)}`, offered)
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
  /** What this run was allowed to call. `null` is the whole catalog. */
  offered: Set<string> | null,
): Promise<AgentStep> {
  const { host, onEvent, approve } = options
  const entry = CATALOG.find((e) => e.wireName === call.name || e.name === call.name)

  /*
   * Refused before anything is looked up, let alone run.
   *
   * A model handed two read tools can still emit a write — small models do,
   * and the whole point of `AgentOptions.tools` is the caller saying which
   * operations belong to this surface. Until this check existed the caller was
   * only asking politely, and `callTool` would happily resolve and RUN a tool
   * that was never on the list.
   *
   * The sentence is the same shape as the unknown-name one on purpose. From the
   * model's side these are the same fact — that name is not available here — and
   * a different phrasing would invite it to retry the same call expecting a
   * different answer. It is emphatically NOT told the tool exists elsewhere,
   * because a model told that will ask for it again.
   */
  if (entry && offered && !offered.has(entry.name)) {
    const step: AgentStep = {
      id,
      name: entry.name,
      title: entry.title,
      effect: entry.effect,
      destructive: entry.destructive,
      args: call.args,
      status: 'failed',
      detail: `No tool is called ${call.name}. Use one of the names given in the tool list, exactly as spelled.`,
    }
    onEvent({ type: 'step', step })
    return step
  }

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

  /*
   * `'unknown'` is excluded deliberately: it means the model named a tool that
   * does not exist, and `callTool` refuses it a line later regardless. Asking a
   * person to approve a call that cannot happen is asking them to rubber-stamp.
   */
  const gated =
    (options.gate ?? 'destructive') === 'writes'
      ? base.effect !== 'read' && base.effect !== 'unknown'
      : base.destructive

  if (gated && approve) {
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

  const outcome = await callTool(host, call.name, call.args)
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
