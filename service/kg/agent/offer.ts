/**
 * Choosing the tools one run is offered: the caller's explicit list, or the
 * lexicon's pick, narrowed by the chooser only when that pick does not fit.
 *
 * The answer is used twice — to build the prompt's tool block and to refuse a
 * call outside it — which is why it is computed once, here, and carried on the
 * turn state rather than re-derived where each use happens.
 */

import { CATALOG, functionSpecs } from './catalog'
import { fitsWindow } from './budget'
import { EVERYTHING_SAFE, inCatalogOrder, offeredFor, select } from './retrieve'
import { pickTools } from './retrieve-llm'
import type { AgentOptions } from './types'

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

/** The function specs a run sends, in the model's own shape. */
export type ToolSpecs = ReturnType<typeof toolsFor>

/** What a run may call, decided once before the first round. */
export type OfferedTools = {
  /** What this run was allowed to call. `null` is the whole catalog. */
  readonly offered: Set<string> | null
  /** The same set as the specs the model is shown. */
  readonly tools: ToolSpecs
  /** True when the list is a boundary rather than the retriever's guess. */
  readonly enforced: boolean
}

type Retrieve = NonNullable<AgentOptions['retrieve']>

/** The conversation's carried set, as `offeredFor` wants it. A fresh Set per call. */
const carriedSet = (retrieve: Retrieve): Set<string> | null =>
  retrieve.carried ? new Set(retrieve.carried) : null

/** The tools the lexicon alone would offer, or the caller's list when it gave one. */
export function lexicalChoice(options: AgentOptions) {
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
      ? offeredFor(options.prompt, carriedSet(options.retrieve), options.retrieve.fromHistory ?? [])
      : undefined

  return (
    options.tools ??
    (options.retrieve ? inCatalogOrder(lexicalSet ?? new Set(EVERYTHING_SAFE)) : undefined)
  )
}

/**
 * Whether the chooser should be asked to narrow the lexicon's list.
 *
 * Measured on the SCHEMAS, not the names.
 *
 * The names are a few hundred characters and the schemas are sixteen
 * thousand tokens — measuring the wrong one would mean the chooser never runs
 * on the model that most needs it.
 */
function needsNarrowing(options: AgentOptions, lexical: ReturnType<typeof lexicalChoice>): boolean {
  return (
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
  )
}

/** The list this run is offered, once the chooser has (or has not) spoken. */
function finalChoice(options: AgentOptions, picked: readonly string[] | null) {
  return (
    options.tools ??
    (options.retrieve
      ? inCatalogOrder(
          offeredFor(
            options.prompt,
            carriedSet(options.retrieve),
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
  )
}

/**
 * The chooser's pick, in flight — or `null` when the chooser is not asked.
 *
 * Returned as the pending call rather than awaited here, so a run that does not
 * ask the chooser reaches its first model round without yielding: the caller
 * awaits only when there is something to wait for, which is what the loop did
 * when this was inline.
 */
export function chooserPick(
  options: AgentOptions,
  lexical: ReturnType<typeof lexicalChoice>,
): ReturnType<typeof pickTools> | null {
  const { signal } = options
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
   * The request ALREADY in flight is the signal's job, not this check's: the
   * chooser and the summariser are both handed `signal` and pass it to their
   * own `ask`, so an app that hooks `onAbort` to its request cancels it there,
   * and an answer that comes back after Stop is discarded either way. Until
   * 2026-11 neither was given it, and a Stop during either waited out a full
   * round trip — on the summariser's path, then persisted the summary too.
   */
  return needsNarrowing(options, lexical) && !signal?.aborted
    ? pickTools(options.chooser!, options.prompt, signal)
    : null
}

/** The tools this run is offered, and whether that list is a boundary. */
export function offerFor(options: AgentOptions, picked: readonly string[] | null): OfferedTools {
  /*
   * An explicit list wins outright; the retriever only speaks when nobody else
   * has. `offeredFor` returns null for a message it does not understand, which
   * lands back on "offer everything" — the behaviour this app had before the
   * retriever existed, so being unsure costs tokens and never an answer.
   */
  const chosen = finalChoice(options, picked)

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

  return { offered, tools, enforced }
}
