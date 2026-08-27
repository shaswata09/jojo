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
import { EVERYTHING_SAFE, NEVER_IMPLICIT, inCatalogOrder, offeredFor, select } from './retrieve'
import { fitHistory, fitsWindow, summarisedNote, trimNote } from './budget'
import { pickTools, type ChooserDeps } from './retrieve-llm'
import { asMessage, compact, type CompactDeps } from './compact'
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
  /*
   * The other half of that sentence, and it was missing.
   *
   * The prompt said what to do when nothing matches and nothing about what to
   * do when SEVERAL do. Measured on the multi-turn benchmark: given two
   * applications to the same university and told to "close the UT one",
   * GPT-OSS 120B picked one and advanced its stage — closing a live
   * application on a guess.
   *
   * Nothing else stops that. A stage change is `effect: 'move'`, not
   * destructive, so no approval gate stands in front of it; the only defence
   * afterwards is an undo that does not survive a reload. The cheapest place
   * to intervene is here, before the call.
   *
   * Phrased as "name them" rather than "ask" because a model told merely to ask
   * writes "which one did you mean?" with no list, and the person then has to
   * go and look the records up themselves.
   */
  'If you have to pick one record to do what they asked and more than one matches, do not pick. Name the ones you found and ask which they meant — guessing is worse than asking, because they cannot see that you guessed.',
  /*
   * The second half, and it cost a conversation to learn.
   *
   * With only the first sentence, "remind me to email the Rice search committee
   * on the 20th" made Gemma find two Rice applications and stop to ask which —
   * for a reminder that does not need one. `applicationIds` is optional on
   * `timeline.item.create`; the ambiguity was real and blocked nothing. Three
   * models failed `reschedule` this way, on the turn BEFORE the one it tests.
   *
   * So the rule is about the record you must CHOOSE, not any record that
   * happens to be ambiguous. Asking about an optional link is the same refusal
   * to act, wearing caution.
   */
  'When the ambiguity is only about something optional — which application to file a reminder under, say — do the thing they asked for and leave the optional part off. They can say later.',
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
  gate?: 'destructive' | 'writes' | 'none'
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
   */
  compacted?: { readonly context: string; readonly messages: number }
}

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

const DEFAULT_MAX_STEPS = 8

/**
 * How many identical calls before the run is stopped.
 *
 * Three: the first is work, the second is a mistake, the third is a loop. The
 * second gets a warning appended to its result — which is the intervention
 * most likely to break the cycle, because the model's own transcript already
 * holds the answer and what it has not been told is that it is repeating.
 */
const REPEAT_LIMIT = 3

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
  /*
   * In the order the caller ASKED for, not catalog order.
   *
   * This filtered `functionSpecs()`, so whatever order it was handed came back
   * as catalog order. Harmless today — `inCatalogOrder` sorts before calling —
   * but it meant the block's order was not something a caller could decide, and
   * the order is what a KV prefix cache is keyed on: a tool inserted in the
   * middle of the block invalidates every token after it, where one appended at
   * the end costs nothing.
   *
   * `resolveOffered` inserts each name and its wire spelling in the order it was
   * given, and a Set iterates in insertion order, so this preserves whatever the
   * caller chose while still emitting each spec exactly once.
   */
  const byName = new Map(all.map((t) => [t.function.name, t]))
  const out: typeof all = []
  const seen = new Set<string>()
  for (const name of offered) {
    const spec = byName.get(name)
    if (spec && !seen.has(spec.function.name)) {
      seen.add(spec.function.name)
      out.push(spec)
    }
  }
  return out
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
  /*
   * The chooser runs first, and its answer is an INPUT to the same pipeline.
   *
   * A second, smaller agent reads the request and a couple of recent lines and
   * says which tools it needs — see `retrieve-llm.ts` for why that is affordable
   * (a name and a line each is ~2,600 tokens against ~16,000 for the schemas)
   * and why it is separate (it never sees the conversation, so it stays cheap
   * and stable as the chat grows, and cannot be talked out of its answer).
   *
   * `null` covers every way it can not work — unreachable, refused, prose
   * instead of JSON, an empty pick — and lands on `undefined` below, which is
   * `offeredFor`'s "use the lexicon". That fallback is offline and cannot fail,
   * so a chooser that is down costs a round trip and never an answer.
   */
  /*
   * The chooser runs only when the lexicon's own list does not fit.
   *
   * Measured, and this is the whole argument. The lexicon alone scores 30/30 on
   * the multi-turn suite, twice. The chooser in front of it scores 28–29 — it
   * under-picks writes, and an assistant given only read tools does not say it
   * cannot act, it says it DID: "I have updated the application to the closed
   * stage", having called nothing. It also halves the context, 8.2k → 2.9k on
   * the first message.
   *
   * Halving the context is worth nothing in an app where a wrong write costs a
   * record — until the alternative is not working at all. On an 8k model the
   * lexicon's thirty-odd schemas genuinely do not fit, and then a slightly
   * riskier narrowing is the only thing that makes the turn possible.
   *
   * So: the safe path when it fits, and the chooser exactly when it does not.
   * It also costs nothing when it is not needed — no round trip, no latency.
   */
  /*
   * The retriever's own answer, BEFORE abstention is turned into a fallback.
   *
   * `null` here means "no opinion at all" — nothing recognised AND nothing
   * carried — which is a different fact from "it chose everything", so the two
   * must not be flattened into one list first. It is NOT a test of whether the
   * lexicon recognised the message; see the gate below, which asks `select`
   * that question itself because this value cannot answer it.
   */
  const lexicalSet =
    options.tools === undefined && options.retrieve
      ? offeredFor(
          options.prompt,
          options.retrieve.carried ? new Set(options.retrieve.carried) : null,
          options.retrieve.fromHistory ?? [],
        )
      : undefined

  const lexical =
    options.tools ??
    (options.retrieve ? inCatalogOrder(lexicalSet ?? new Set(EVERYTHING_SAFE)) : undefined)

  /*
   * Measured on the SCHEMAS, not the names.
   *
   * The names are a few hundred characters and the schemas are sixteen
   * thousand tokens — measuring the wrong one would mean the chooser never runs
   * on the model that most needs it.
   */
  const needsNarrowing =
    options.chooser !== undefined &&
    options.retrieve !== undefined &&
    options.tools === undefined &&
    options.window !== undefined &&
    /*
     * NOT when the retriever abstained, and this is the whole of the second fix.
     *
     * Abstention makes `lexical` the entire safe catalog, which fits no window
     * anyone runs — so a gate that only asks "does it fit" fires the chooser
     * EXACTLY on abstention and nowhere else. That is backwards. Abstention is
     * the case where the chooser is the sole source rather than a supplement:
     * `offeredFor` unions its picks with the lexicon's when there is one and
     * REPLACES with them when there is not, so a chooser that returns only read
     * tools leaves a model with no way to act — and a model with no way to act
     * does not say it cannot, it says it did. Measured: "I am withdrawing from
     * Baylor" abstains, and the reply claimed the application had been closed
     * having called nothing.
     *
     * So abstention keeps the answer that scores 30/30 — everything safe. On a
     * window too small to hold it the request is refused by `guardTruncation`
     * or by Ollama's `shift:false`, which is a failure somebody can see. A
     * hallucinated write is not.
     *
     * AND ABSTENTION IS `select`'S ANSWER, NOT `offeredFor`'S.
     *
     * This clause read `lexicalSet !== null`, which is a different question:
     * `offeredFor` returns null only when the lexicon abstained AND nothing
     * was carried AND no wipe was asked for. A conversation carries something
     * from turn two onwards, so the merged set is never null after the first
     * message and the guard above held for exactly one turn of each chat — the
     * one turn where abstention is least likely, because an opener is where a
     * person says what they want.
     *
     * Measured on the follow-up that matters most. "yes, do that" recognises
     * no tool word, so on a small window the chooser ran, and with the lexicon
     * abstaining `offeredFor` REPLACES with its picks rather than unioning
     * them: a turn offered 33 tools for "add a reminder for the Rice
     * interview" came back with 22, `timeline.item.reschedule` among the
     * eleven that went — the tool the conversation was about, on the turn that
     * said yes to it.
     */
    select(options.prompt) !== null &&
    !fitsWindow(toolsFor(resolveOffered(lexical)), options.window)

  /*
   * Stop is read HERE, and again before the summariser, rather than only once
   * the round loop starts.
   *
   * The first `signal?.aborted` check was inside that loop, which is two model
   * round trips too late: the chooser and the summariser each ask a model, so
   * pressing Stop bought a disabled composer and up to two full, untimed round
   * trips on somebody's own GPU after the UI had said it was stopping.
   *
   * Skipped rather than returned from, because `finish` and the `messages` it
   * reports do not exist yet. The loop's existing check then ends the run as
   * `aborted` having called no model at all.
   *
   * ## What this check does NOT do, which is worth being exact about
   *
   * This particular read cannot fire for any caller in the app today: nothing
   * above it awaits, so `aborted` is whatever it was when `runAgent` was
   * entered, and `agent-runs.ts` mints the signal on the line before. It earns
   * its place as a floor for a caller that hands in a signal already aborted,
   * and it would start mattering the moment anything above it awaits. The
   * summariser's copy is the reachable one — the chooser's round trip runs
   * before it.
   *
   * And neither cuts off a request ALREADY in flight. `ask` is built as
   * `(messages) => agentTurn(settings, messages, [])` and `agentTurn` takes an
   * `AbortSignal` it is never given, so a Stop pressed mid-call still waits for
   * that answer and then discards it. That costs one wasted request on two
   * paths that are themselves rare — the chooser only runs when the tool list
   * will not fit the window, the summariser only on a compaction — so it is
   * left as a known limit rather than threaded through both dep types and both
   * apps. Fix it by giving `ChooserDeps`/`CompactDeps` the run's cancellation
   * if either path ever becomes common.
   */
  const picked =
    needsNarrowing && !signal?.aborted ? await pickTools(options.chooser!, options.prompt) : null

  const chosen =
    options.tools ??
    (options.retrieve
      ? inCatalogOrder(
          offeredFor(
            options.prompt,
            options.retrieve.carried ? new Set(options.retrieve.carried) : null,
            options.retrieve.fromHistory ?? [],
            picked === null ? undefined : new Set(picked),
            /*
             * NOT the whole catalog. Abstention means the retriever recognised
             * nothing — the first message of a new conversation, most often —
             * and the old fallback handed a small model every tool there is,
             * including the two that empty the store. `offeredFor` strips those
             * only on the branch it did not take.
             */
          ) ?? new Set(EVERYTHING_SAFE),
        )
      : undefined)

  // Resolved ONCE, and used twice: to build the prompt's tool list, and to
  // refuse a call for anything outside it. One list, so the offer and the
  // enforcement cannot describe different sets.
  const offered = resolveOffered(chosen)
  const tools = toolsFor(offered)

  /*
   * Whether the list is a BOUNDARY or a SUGGESTION, and the distinction is the
   * whole of this fix.
   *
   * An explicit `options.tools` is a boundary. A pipeline is handed the tools
   * its kind may use and must not reach outside them, and refusing is the only
   * correct answer — that is what `check-compositions` and `mayPropose` are
   * protecting and it stays exactly as strict as it was.
   *
   * The RETRIEVER'S set is not a boundary. It is a token optimisation: a guess
   * at which of eighty-odd tools this question needs, made from the words the
   * person happened to use. When it guesses wrong the model asks for something
   * real, safe and appropriate — and the old code refused it with "No tool is
   * called vault.person.create", about a tool that exists, is not destructive,
   * and works perfectly the moment the retriever happens to offer it.
   *
   * That turned an optimisation into a failure, and an intermittent one: the
   * same request succeeded or failed depending on whether the person wrote "add
   * a person" or "add Dr Chen as a referee". Nothing about the second is less
   * safe.
   *
   * A miss now falls through to the approval gate below, which is the real
   * control: with approvals on the person is asked, and with them off a delete
   * still stops. Nothing runs unseen that would not have run before.
   */
  const enforced = options.tools !== undefined

  /*
   * The date, which the model did not have.
   *
   * `host.today()` reached the TOOLS and never the model, so every relative
   * date a person speaks — "the 20th", "next Tuesday", "in two weeks" — was
   * resolved against whatever the weights believe today is. Measured on the
   * benchmark: asked to be reminded "on the 20th" in a world dated 2026-09-14,
   * Gemma filed it under **2025-05-20**. The reminder was created correctly,
   * rescheduled correctly, and landed sixteen months in the past.
   *
   * Appended rather than baked into `SYSTEM_PROMPT`, because that constant is
   * a constant and this is not — and because `core` has no clock (D26), so the
   * only honest source is the host that was injected one.
   */
  const system: ChatMessage = {
    role: 'system',
    content: `${SYSTEM_PROMPT} Today is ${options.host.today()}.`,
  }
  const question: ChatMessage = { role: 'user', content: options.prompt }

  /*
   * Trimmed before sending, rather than truncated by the server after.
   *
   * Nothing bounded a conversation. Measured over ten ordinary follow-ups
   * against a real model, the request went 8,227 → 21,062 tokens: the history
   * is never cut, the carried tool set grows monotonically (33 → 62 schemas),
   * and no one compared the total to the window. On an 8k model that stopped
   * being answerable at turn 2.
   *
   * What happened then is the worst way to fail: the SERVER truncates, and
   * servers truncate from the front — which is this system message, with the
   * rules about not inventing ids, about asking when several records match, and
   * about what today is. Nothing reports it and the reply reads normally.
   *
   * `window` is the person's own number when they gave one, and the provider's
   * default otherwise. Both local defaults claim 32,768, which is optimistic
   * for Ollama specifically (its `num_ctx` is 4,096 unless changed) — so this
   * is a floor on the damage rather than a guarantee, and `guardTruncation`
   * still runs afterwards for the case where the guess was too generous.
   */
  const fitted = options.window === undefined
    ? { history: options.history, dropped: 0, summarisable: true, overflows: false }
    : fitHistory(options.history, [system, question, tools], options.window)

  /*
   * What was dropped, summarised back in — so a long chat loses DETAIL rather
   * than memory.
   *
   * A plain trim is the floor and it is not enough on its own: at turn twelve
   * the assistant would have no idea that at turn three you said which Rice
   * application you meant, or that it already filed the CV, or that you told it
   * to leave Baylor alone. It asks again, or acts as though none of it
   * happened.
   *
   * One system note takes their place — system, not assistant, because a model
   * defends its own prior speech and this is context rather than something it
   * said. It is asked for only when a trim actually drops something, so an
   * ordinary conversation never pays for it, and it is allowed to fail: without
   * it the trim is a plain one, which is what happened before this existed.
   *
   * `RESERVED_FOR_REPLY` already left room, and the summary is capped, so
   * putting it back cannot re-overflow what the trim just fixed.
   */
  let recovered: ChatMessage | null = null
  let written: { context: string; messages: number } | undefined
  // The abort check also covers a Stop pressed DURING the chooser call above,
  // which is the only window in which that call is running and cancellable by
  // nothing. See there for why this is skipped rather than returned from.
  if (fitted.dropped > 0 && fitted.summarisable && options.summariser && !signal?.aborted) {
    /*
     * The exchanges being dropped, PLUS whatever a previous compaction already
     * summarised — so the new summary supersedes the old rather than sitting
     * beside it. Without this the thread would accumulate summaries, which is
     * the growth this whole mechanism exists to stop.
     */
    const earlier: ChatMessage[] =
      options.context === undefined
        ? []
        : [{ role: 'user', content: `Earlier still: ${options.context}` }]
    const summary = await compact(options.summariser, [
      ...earlier,
      ...options.history.slice(0, fitted.dropped),
    ])
    if (summary !== null) {
      // `asMessage` owns the prefix; the thread stores the summary itself. See
      // `compact` for the doubling this avoids.
      recovered = asMessage(summary)
      written = { context: summary, messages: fitted.dropped }
    }
  }

  /*
   * A summary from a PREVIOUS turn, when this turn did not write a new one.
   *
   * The common case once a conversation has been compacted once: it fits now,
   * nothing is dropped, and what the model still needs is the note about the
   * part that is no longer here.
   */
  const carriedContext: ChatMessage | null =
    recovered === null && options.context !== undefined
      ? asMessage(options.context)
      : null

  if (fitted.dropped > 0) {
    onEvent({
      type: 'note',
      app: true,
      text: recovered === null ? trimNote(fitted.dropped) : summarisedNote(fitted.dropped),
    })
  }
  if (fitted.overflows) {
    onEvent({
      type: 'note',
      app: true,
      text: 'The tool list alone is larger than this model can hold. Narrow what the assistant may reach for, or raise the context window in Settings if your server allows it.',
    })
  }

  const messages: ChatMessage[] = [
    system,
    ...(recovered === null ? [] : [recovered]),
    ...(carriedContext === null ? [] : [carriedContext]),
    ...fitted.history,
    question,
  ]
  const steps: AgentStep[] = []
  let counter = 0

  /**
   * Identical calls made in this run, and how often.
   *
   * Per run rather than per round: the loop a small model gets into spans
   * rounds — call, misread the refusal, call again — and a per-round counter
   * would never see it.
   */
  const repeats = new Map<string, number>()

  const finish = (stopped: AgentRun['stopped'], answer: string | null = null): AgentRun => ({
    messages,
    answer,
    steps,
    stopped,
    offered: offered === null ? null : [...offered],
    // Reported on every outcome, including a failure: a compaction that
    // happened is a fact about the thread whether or not the turn then worked,
    // and losing it would mean summarising the same exchanges again next time.
    ...(written === undefined ? {} : { compacted: written }),
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
    if (turn.finishReason === 'length') {
      onEvent({
        type: 'note',
        app: true,
        text: 'The model stopped mid-reply because it hit its own output limit. Anything below this may be incomplete — a shorter question, or a larger reply limit on the server, usually fixes it.',
      })
    }

    // No calls: the model is done talking and this is the answer.
    if (turn.toolCalls.length === 0) {
      const answer = turn.text ?? ''

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
      const looksLikeCall = toolCallInText(answer, offered)
      if (looksLikeCall !== null) {
        onEvent({
          type: 'error',
          reason: `The model tried to call “${looksLikeCall}” by writing it out as text rather than as a tool call. That usually means the server is running without a tool template for this model — in llama.cpp it is the --jinja flag, and in LM Studio it is the prompt template on the model's page. Nothing was run.`,
        })
        return finish('error')
      }

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
      if (answer.trim() === '' && steps.length === 0) {
        onEvent({
          type: 'error',
          reason:
            turn.finishReason === 'length'
              ? 'The model used its whole reply budget without answering or calling anything. Models that reason before they speak — Qwen3, GPT-OSS, DeepSeek-R1 — do this when the server’s reply limit is small: raise it, or run the model with thinking turned off. Nothing was changed.'
              : 'The model returned an empty reply and did not call anything, so nothing was changed. Asking again, more specifically, usually works.',
        })
        return finish('error')
      }

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
      const step = await performCall(
        options,
        call,
        `s${String(counter)}`,
        offered,
        enforced,
        turn.finishReason === 'length',
      )
      steps.push(step)

      /*
       * How many times this exact call has been made in this run.
       *
       * Nothing watched for repetition, and a small model that has misread a
       * refusal will re-issue the identical call every round until the cap —
       * eight rounds at an 18k-token prompt is minutes of somebody's GPU spent
       * discovering nothing. Keyed on name AND arguments, because calling the
       * same tool with different arguments is ordinary work.
       */
      const fingerprint = `${call.name}\u0000${call.raw}`
      const seen = (repeats.get(fingerprint) ?? 0) + 1
      repeats.set(fingerprint, seen)

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
      const left = maxSteps - round - 1
      const budget =
        left <= 1
          ? `\n\n${left === 0 ? 'This was your last step.' : 'You have one step left.'} Answer now with what you have, and say plainly what you could not finish.`
          : ''

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content:
          seen >= 2
            ? /*
               * Told, rather than silently answered the same way again. The
               * model's own transcript already contains the first answer; what
               * it has not been told is that it is going in circles, and a
               * repeated identical result reads to it as confirmation.
               */
              `${step.detail ?? 'Done.'}\n\nNote: this is the ${seen === 2 ? 'second' : 'third'} time you have called ${step.name} with exactly these arguments in this conversation, and the answer has not changed. Do something different, or tell the user what is blocking you.${budget}`
            : `${step.detail ?? 'Done.'}${budget}`,
      })

      if (seen >= REPEAT_LIMIT) {
        // `step.name` rather than `call.name`: the step carries the registry
        // name the rest of the app shows, and the wire spelling with underscores
        // appears nowhere a person reads.
        const reason = `The model called ${step.name} with the same arguments ${String(seen)} times without getting anywhere. Stopped, so it does not keep going. What did run is listed above.`
        onEvent({ type: 'error', reason })
        return finish('error')
      }
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
  /** True when the list is a boundary rather than the retriever's guess. */
  enforced: boolean,
  /**
   * The reply carrying this call stopped at the model's output limit.
   *
   * Changes the DIAGNOSIS, not the outcome: a truncated `arguments` string is
   * invalid JSON, and telling the model its JSON was malformed invites it to
   * send the same oversized call again.
   */
  truncated = false,
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
  /*
   * `enforced`, OR one of the two tools that cannot be undone.
   *
   * The retriever's set is a suggestion — a miss falls through to the approval
   * gate, and the comment above `enforced` says why that was safe: "with
   * approvals on the person is asked, and with them off a delete still stops".
   *
   * THAT SENTENCE STOPPED BEING TRUE when `auto` was added. `gate: 'none'`
   * stops nothing, so the last control under it was gone, and a run narrowed by
   * the retriever would execute a `memory.clear` the model produced from
   * nowhere — proven with a probe: prompt "what applications do I have at
   * Rice", no mention of wiping, whole store emptied, `undoable: false`.
   *
   * `NEVER_IMPLICIT` is stripped by `offeredFor` precisely because these two are
   * the only un-undoable operations in the app. Making that strip REAL rather
   * than advisory is the fix, and it is not an approval prompt in disguise: the
   * model asked for a name that was never offered, and `auto` still runs
   * everything that WAS. A person who says "wipe everything" gets `asksToWipe`,
   * the tool in `offered`, and no refusal here.
   */
  const neverImplicit = entry !== undefined && NEVER_IMPLICIT.includes(entry.name)
  if (entry && offered && (enforced || neverImplicit) && !offered.has(entry.name)) {
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

  /*
   * Arguments that were not JSON. Quoted back rather than guessed at: the model
   * is the only thing that knows what it meant, and a repair here would be a
   * silent edit to what the user is about to be told happened.
   *
   * TRUNCATION IS A DIFFERENT FAILURE and gets a different sentence. A reply cut
   * off at the model's output limit leaves `arguments` ending mid-string, which
   * reaches `safeParse` as invalid JSON — so the model was told its JSON was
   * malformed, which is not what happened and invites it to send the SAME
   * oversized call again. Reported from a CV import: `profile.background.add`
   * with thirty facts in one array, cut off partway through the second title.
   *
   * The remedy has to be in the sentence, because the model cannot see its own
   * output limit. "Send fewer" is the only thing that works, and the bulk tools
   * are precisely the ones that can be split.
   */
  if (call.args === null) {
    return settle({
      ...base,
      status: 'failed',
      detail: truncated
        ? `Error: your reply hit the model's output limit partway through the arguments, so they could not be read. Send the same call again with FEWER items — a third of them — and then call it again for the rest. You sent: ${call.raw.slice(0, 200)}`
        : `Error: the arguments were not valid JSON. You sent: ${call.raw.slice(0, 200)}`,
    })
  }

  /*
   * `'unknown'` is excluded deliberately: it means the model named a tool that
   * does not exist, and `callTool` refuses it a line later regardless. Asking a
   * person to approve a call that cannot happen is asking them to rubber-stamp.
   */
  /*
   * Three settings, and the middle one is where the interesting failure lives.
   *
   *   writes       — every non-read step (82 of 92 tools)
   *   destructive  — only `delete` and `admin` effects (15 of 92)
   *   none         — nothing, and the person chose that explicitly
   *
   * `destructive` is not "the dangerous ones", it is "the ones that remove a
   * record". Closing an application is a `move`, so it passes here — which is
   * the measured gap this exists to be honest about, not a bug in this line.
   */
  const mode = options.gate ?? 'destructive'
  const gated =
    mode === 'none'
      ? false
      : mode === 'writes'
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
