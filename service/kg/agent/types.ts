/**
 * The agent loop's public shapes: what a run is given, what it emits while it
 * runs, and what it hands back.
 *
 * Types only, so every module of the loop can name them without a value edge
 * back to `loop.ts`. `loop.ts` re-exports all of them, and that is where every
 * caller outside this directory imports them from.
 */

import type { ChatMessage, Turn } from '../core/model-server'
import type { Announcement } from '../tools/tool'
import type { Effect } from './catalog'
import type { CompactDeps, ThreadRef } from './compact'
import type { ToolHost } from './execute'
import type { RepairKind } from './repair'
import type { ChooserDeps } from './retrieve-llm'

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
  /**
   * What `repair.ts` had to fix about the arguments before this ran. Absent when
   * nothing was wrong, which is the overwhelming majority of calls.
   *
   * The KINDS rather than the prose, and that is what makes it worth carrying:
   * the prose is already on screen as an app note, and what the benchmark needs
   * is a countable channel. `repairs.length` per run is the number that says
   * whether a prompt change or a model change moved the FORMAT channel, which
   * Aider measures separately from the capability channel precisely because the
   * two move independently.
   *
   * Present on the settled step only. The `running` emission carries the
   * repaired `args` — a person watching the row appear should see what will
   * actually run — but not yet the note about them.
   */
  repairs?: readonly RepairKind[]
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
  /**
   * Something said mid-run. `app: true` means THIS APP said it, not the model.
   *
   * The distinction decides whether it is replayed to the model next turn. The
   * model's narration was its own speech and should be; "this conversation was
   * trimmed" was never said by it, and a model that reads that back as its own
   * prior words will reason from it.
   */
  | { type: 'note'; text: string; app?: true }
  | { type: 'step'; step: AgentStep }
  | { type: 'answer'; text: string }
  | { type: 'error'; reason: string }
  /**
   * A fragment of what the model is thinking before it answers, as it streams.
   * Same contract as `delta`: an optimisation, with `thought` as the truth.
   */
  | { type: 'thinking'; text: string }
  /**
   * Everything the model thought in one round, once the round has settled.
   * For the person to read; it is never replayed to the model.
   */
  | { type: 'thought'; text: string }

/* ---------------------------------- ports --------------------------------- */

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
  /** The same for the model's thinking, where the server separates it. */
  onReasoning?: (text: string) => void,
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
export type Cancellation = {
  readonly aborted: boolean
  /**
   * Fires once when the run is stopped, for a caller that has a request to
   * cancel rather than a flag to read — the chooser's and the summariser's
   * model calls, a document conversion. Optional: a flag alone still stops the
   * loop between steps. `agent-runs.ts` and the pipeline rounds supply it.
   */
  readonly onAbort?: (fn: () => void) => void
}

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
   * `destructive` is delete and admin, plus the tools that declare themselves
   * so — 19 of the 96 catalog entries, the ones whose catalog description
   * already warns the model about them. `writes` is every step that is not a
   * read: 86 of them, which is what "ask me before it changes anything"
   * actually means.
   *
   * The policy is the CALLER'S, which is why it is here rather than widening
   * `destructive` in `catalog.ts`. That flag is load-bearing elsewhere — it
   * fills MCP's `destructiveHint` and appends "this removes a record" to the
   * description the model reads — and marking every create destructive would
   * lie to both.
   */
  gate?: 'destructive' | 'writes' | 'none'
  /**
   * One line naming the record this conversation is about — `focusLine` in
   * `focus.ts` — appended to the system message so "this application" has a
   * referent. Absent for a conversation about nothing in particular, which is
   * every caller but the two chat surfaces, and the benchmark among them: a
   * run without it sends exactly the system message it always did.
   */
  focus?: string
  /**
   * The model's context window, in tokens.
   *
   * Absent means "do not trim", which is what every caller did implicitly
   * before this existed and what a test that does not care still wants. A
   * caller that HAS a number should pass it: see the trim in the body for what
   * happens without one.
   */
  window?: number
  /**
   * A second, smaller agent that chooses which tools this turn may use.
   *
   * Runs before the first model call, against its own short transcript — the
   * request and a few recent lines, never the conversation. Its picks go
   * through exactly the same closure and strip as a lexical pick, so it can
   * narrow and cannot widen past what is safe. See `retrieve-llm.ts`.
   *
   * Optional, and allowed to fail: `retrieve.ts` is offline and cannot, so a
   * chooser that is down costs latency and never capability.
   */
  chooser?: ChooserDeps
  /**
   * Summarises the exchanges a trim would otherwise drop.
   *
   * Only consulted when the conversation does not fit, so a short chat never
   * pays for it. Allowed to fail the same way: without it the trim is a plain
   * one, which is what happened before this existed. See `compact.ts`.
   */
  summariser?: CompactDeps
  /**
   * What this conversation established earlier, from a previous compaction.
   *
   * Stored on the thread (`ThreadProps.context`) rather than recomputed, which
   * is the difference between a chat that runs long and one that pays a
   * summarisation call every turn once it is big. The caller passes the summary
   * AND the history it does not cover; this puts the summary in front.
   */
  context?: string
  /**
   * The conversation this run belongs to, for the summary's pointer line.
   *
   * A compaction summary ends by saying where the verbatim exchange still is,
   * so a model that needs a detail the summary left out can read it back with
   * `memory.get` instead of guessing. That needs the thread's id, and the loop
   * does not have one of its own: `agent-runs.ts` does (`StartOptions.threadId`,
   * decided before the first token) and can pass `{ id: threadId }`; the bench
   * runner runs against a host with no thread node, so it passes nothing.
   * Absent means no pointer line — never an id the model could not read.
   */
  thread?: ThreadRef
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
  /**
   * `'stuck'` is its own outcome and not a flavour of `'error'`, and the
   * separation is the point rather than tidiness.
   *
   * The three ways a run can end badly want three different reactions. `'error'`
   * is the transport or the server — retrying is reasonable. `'cap'` is the
   * round budget — the work may have been nearly done and a bigger `maxSteps`
   * would finish it. `'stuck'` is the model going in circles, and it is the one
   * where retrying the same request unchanged is known not to help. Folding it
   * into `'error'`, which is what this did, told every caller the least useful
   * of the three.
   */
  stopped: 'answered' | 'cap' | 'error' | 'stuck' | 'aborted'
  /**
   * The tools this run was actually offered, for the next turn to carry.
   *
   * Reported because the retriever's `carried` set has to come from somewhere,
   * and the only honest source is what the previous turn used. Without it every
   * caller passed `null` and the grow-only carry the retriever was built for
   * was never exercised: turn one sent a narrowed set and turn two — "yes, do
   * that", which matches no seed — sent the entire catalog. The prompt prefix
   * changed size between turns, which destroys any prefix cache and blows a
   * small model's window at exactly the moment it is being asked to follow up.
   *
   * `null` means everything was offered, matching `resolveOffered`.
   */
  offered: readonly string[] | null
  /**
   * A summary written this turn, for the caller to persist on the thread.
   *
   * Absent unless a compaction happened, which is rare. `messages` is how many
   * of the history messages it accounts for — the caller translates that back
   * into its own entries (see `entriesForMessages`) and stores both, so the
   * next turn sends the summary and only the part it does not cover.
   *
   * `kept` is the person's own turns from inside that covered part, verbatim
   * and in order. They were SENT this turn — the budget carries them ahead of
   * the surviving tail rather than paraphrasing them — but they are not in
   * `context`: the summariser never sees a user turn, by design (see
   * `budget.ts` for the measurement). So a caller that advances its stored
   * boundary by `messages` has to carry `kept` forward itself, or the next
   * turn's history starts after them and the fact the person stated in turn
   * one is gone with nothing standing in for it. Reported here rather than
   * folded into `context` because folding would feed the person's words to
   * the next compaction's summariser as "earlier notes", which is the exact
   * path this design closed.
   */
  compacted?: {
    readonly context: string
    readonly messages: number
    readonly kept: readonly string[]
  }
}
