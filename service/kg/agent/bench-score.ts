/**
 * How an agent run is scored, on three axes that disagree with each other. L3.
 *
 * They disagree on purpose. A model can pick the right tool and wreck the
 * store; it can reach the right final state by a route nobody should trust; and
 * it can behave impeccably and be judged a failure by a rubric that only
 * accepted one spelling. Reporting one number would hide all three.
 *
 *   1. TOOL CHOICE — did this turn call something defensible, and nothing
 *      forbidden. Per turn. The cheapest signal and the least interesting.
 *
 *   2. TRAJECTORY — is the SEQUENCE sound. Did a write that needs an id have
 *      one available; did the model look before writing; did any call fail
 *      because it invented something. Only exists across turns, which is why
 *      the single-turn suite cannot see it.
 *
 *   3. FINAL STATE — is the store right afterwards. The only axis a person
 *      would recognise as mattering, and the only one that catches a model that
 *      did the task AND something else.
 *
 * Everything here is pure. The runner does the network and the store; this
 * takes what happened and says what it was worth, so the rubric itself can be
 * tested rather than trusted.
 */

import type { NodeType } from '../core/model'
import { GROUPS } from './bench-conversations'
import type { Conversation, StateCheck, Turn } from './bench-conversations'
import { NEEDS, NEEDS_ANY, PRODUCERS } from './tool-graph'

/** One tool call the agent actually made. */
export type CallRecord = {
  readonly turn: number
  readonly name: string
  readonly effect: string
  /** False when the call was refused — a bad id, a schema violation, a block. */
  readonly ok: boolean
  /**
   * The arguments, serialised, so a repeat can be told from ordinary work.
   *
   * Optional because older reports do not carry it and a scorer that threw on
   * one would make every stored run unreadable.
   */
  readonly args?: string
}

/** A record as the scorer sees it. Flattened by the runner from the real store. */
/**
 * One record, flattened into the shape the rubric asks questions about.
 *
 * ## The derived props, and why they are part of the contract
 *
 * Some of what a check wants to assert is not a prop at all. An application's
 * employer is a separate `organisation` node joined by an `AT` edge, because
 * `application.create` mints the org itself; a document filed under an
 * application is a `FILED_UNDER` edge. A rubric written against the literal
 * store would have to talk about edges and ids, which is unreadable and would
 * make every check depend on how the tools happen to model things today.
 *
 * So the harness resolves a fixed, small set of edges into props before
 * scoring, and checks may rely on exactly these:
 *
 *   - `org`        — the name of the node on the other end of an `AT` edge.
 *   - `filedUnder` — a label for the node an outgoing `FILED_UNDER` points at,
 *                    which for an application is its employer and role
 *                    together, so a check can match on either half.
 *   - `keywords`   — names on incoming `TAGS` edges (its own field, since
 *                    `tagged` is a first-class check kind).
 *
 * This list was folklore until a check that needed `filedUnder` was simply left
 * out, and `file-under-application` ended up scored so that a model which did
 * nothing at all passed its entire state axis. Anything added here should be
 * added to this comment in the same commit.
 */
export type BenchNode = {
  readonly type: string
  readonly props: Readonly<Record<string, unknown>>
  /** Names of the keywords attached to it. */
  readonly keywords: readonly string[]
}

const isWrite = (effect: string) => effect !== 'read' && effect !== 'unknown'

/* -------------------------------------------------------------------------- */
/* 1. Tool choice                                                             */
/* -------------------------------------------------------------------------- */

export type TurnScore = {
  readonly correct: boolean
  /** Named so a report can say what went wrong rather than just that it did. */
  readonly failure?:
    | 'no-required-call'
    | 'forbidden-call'
    | 'wrote-on-a-question'
    | 'acted-when-it-should-have-asked'
    | 'said-nothing'
  readonly detail?: string
}

/**
 * Whether one turn did something defensible.
 *
 * The order of the checks is the order of severity, so a turn that both wrote
 * something forbidden and failed to call the right thing is reported as the
 * forbidden write. A report that named the lesser fault would send somebody to
 * the wrong problem.
 */
export function scoreTurn(turn: Turn, calls: readonly CallRecord[], answered: boolean): TurnScore {
  const names = calls.map((c) => c.name)

  for (const name of names) {
    if (turn.mustNotCall?.includes(name)) {
      return { correct: false, failure: 'forbidden-call', detail: name }
    }
  }

  const writes = calls.filter((c) => isWrite(c.effect))

  if (turn.shouldAsk) {
    /*
     * The ambiguity turns. Acting at all is the failure — not acting WRONGLY,
     * acting. The world holds two records matching the sentence, so there is no
     * correct write, and a model that picked one has done the thing that
     * silently corrupts somebody's records.
     */
    if (writes.length > 0) {
      const first = writes[0]?.name
      return {
        correct: false,
        failure: 'acted-when-it-should-have-asked',
        // Spread, because `exactOptionalPropertyTypes` distinguishes "no
        // detail" from "a detail that is undefined", and indexing gives the
        // second where we mean the first.
        ...(first === undefined ? {} : { detail: first }),
      }
    }
    // It must also have SAID something. Silence is not a question.
    return answered ? { correct: true } : { correct: false, failure: 'said-nothing' }
  }

  if (turn.readOnly && writes.length > 0) {
    const first = writes[0]?.name
    return {
      correct: false,
      failure: 'wrote-on-a-question',
      ...(first === undefined ? {} : { detail: first }),
    }
  }

  if (turn.mustCallOneOf && !names.some((n) => turn.mustCallOneOf?.includes(n))) {
    // A read-only turn that answered from context without calling anything is
    // acceptable; a turn that was supposed to DO something is not.
    if (turn.readOnly && answered) return { correct: true }
    return { correct: false, failure: 'no-required-call', detail: names[0] ?? '(nothing)' }
  }

  return { correct: true }
}

/* -------------------------------------------------------------------------- */
/* 2. Trajectory                                                              */
/* -------------------------------------------------------------------------- */

export type TrajectoryScore = {
  /** Writes whose required ids could have come from somewhere earlier. */
  readonly grounded: number
  readonly writes: number
  /** Writes that had at least one read before them in the conversation. */
  readonly lookedFirst: number
  /** Calls the runtime refused — an invented id, a schema violation, a block. */
  readonly refused: number
  readonly calls: number
  /** The same tool with the same effect called twice running. */
  readonly repeats: number
}

/**
 * Whether the SEQUENCE was sound, using the same graph the retriever uses.
 *
 * `NEEDS` says which node types a tool cannot run without and `NEEDS_ANY` says
 * which it needs ONE of; `PRODUCERS` says what mints them. A write is GROUNDED
 * when every type in the first is obtainable and at least one type in the
 * second is — either because a read happened earlier in the conversation, which
 * is how ids enter a trajectory at all, or because an earlier call produced
 * that type directly.
 *
 * Both maps, and reading only the first was a real hole for a while. When the
 * polymorphic slots moved out of `NEEDS` into `NEEDS_ANY`, this kept reading
 * only `NEEDS` — so `keyword.attach`, whose whole difficulty is that it needs
 * something to attach TO, scored as fully grounded no matter what came before
 * it. The metric said the trajectory was sound precisely where it was least
 * likely to be.
 *
 * This is the tool graph acting as a judge rather than as a filter, which is
 * the same fact read the other way round: a graph that can tell a retriever
 * what to offer can tell a scorer whether a trajectory made sense.
 *
 * Deliberately generous. It asks whether an id was OBTAINABLE, not whether the
 * model used the one it obtained — proving the latter would mean tracing ids
 * through tool results, and a scorer that strict starts failing correct runs
 * for reasons its author cannot explain.
 */
export function scoreTrajectory(calls: readonly CallRecord[]): TrajectoryScore {
  let grounded = 0
  let lookedFirst = 0
  let repeats = 0
  const writes = calls.filter((c) => isWrite(c.effect))

  /*
   * Calls already made, by name AND arguments.
   *
   * This counted adjacent same-NAME calls, which is not what "repeat" means to
   * anybody reading the report: searching twice in a row for two different
   * things scored as going in circles, and Gemma's first run reported 19
   * repeats out of 84 calls almost entirely from legitimate consecutive reads.
   *
   * The definition that matters — and the one `loop.ts`'s own repeat guard
   * uses — is the same call with the same arguments, anywhere in the run. That
   * is a model stuck; two searches are a model working.
   */
  const madeBefore = new Set<string>()

  for (const [index, call] of calls.entries()) {
    const previous = calls.slice(0, index)
    const fingerprint = `${call.name}\u0000${call.args ?? ''}`
    if (madeBefore.has(fingerprint)) repeats += 1
    madeBefore.add(fingerprint)
    if (!isWrite(call.effect)) continue

    const sawRead = previous.some((c) => !isWrite(c.effect))
    if (sawRead) lookedFirst += 1

    // A read can surface a record of any type, so one read grounds them all.
    const obtainable = (type: NodeType) =>
      sawRead || previous.some((c) => (PRODUCERS.get(type) ?? new Set<string>()).has(c.name))

    const needs = NEEDS.get(call.name) ?? new Set<NodeType>()
    const anyOf = NEEDS_ANY.get(call.name) ?? new Set<NodeType>()
    // Every required type, and at least one of the alternatives. An empty
    // `anyOf` is vacuously satisfied; an empty `needs` likewise.
    const satisfied =
      [...needs].every(obtainable) && (anyOf.size === 0 || [...anyOf].some(obtainable))
    if (satisfied) grounded += 1
  }

  return {
    grounded,
    writes: writes.length,
    lookedFirst,
    refused: calls.filter((c) => !c.ok).length,
    calls: calls.length,
    repeats,
  }
}

/* -------------------------------------------------------------------------- */
/* 3. Final state                                                             */
/* -------------------------------------------------------------------------- */

const text = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : '')

const matches = (node: BenchNode, where: { prop: string; contains: string }) =>
  text(node.props[where.prop]).includes(where.contains.toLowerCase())

export type CheckResult = { readonly check: StateCheck; readonly pass: boolean; readonly saw: string }

/**
 * One claim about the store, answered against what is actually in it.
 *
 * `count` is doing more work than it looks. Most of the damage a confused agent
 * does is ADDITIVE — a second Rice application, a duplicate reminder, a cover
 * letter it invented — and a count is the only assertion that catches the thing
 * nobody thought to look for.
 */
export function checkState(check: StateCheck, nodes: readonly BenchNode[]): CheckResult {
  const ofType = nodes.filter((n) => n.type === check.type)

  switch (check.kind) {
    case 'count': {
      const saw = ofType.length
      return { check, pass: saw === check.is, saw: `${String(saw)} ${check.type}` }
    }
    case 'exists': {
      const found = ofType.some((n) => matches(n, check.where))
      return { check, pass: found, saw: found ? 'found' : 'not found' }
    }
    case 'absent': {
      const found = ofType.filter((n) => matches(n, check.where))
      return { check, pass: found.length === 0, saw: found.length === 0 ? 'absent' : 'present' }
    }
    case 'prop': {
      const node = ofType.find((n) => matches(n, check.where))
      if (!node) return { check, pass: false, saw: 'no such record' }
      const value = node.props[check.prop]
      if (check.is === null) {
        const cleared = value === undefined || value === null || value === ''
        return { check, pass: cleared, saw: cleared ? 'cleared' : String(value) }
      }
      const same = String(value) === check.is
      return { check, pass: same, saw: String(value ?? '(absent)') }
    }
    case 'tagged': {
      const node = ofType.find((n) => matches(n, check.where))
      if (!node) return { check, pass: false, saw: 'no such record' }
      const has = node.keywords.some((k) => k.toLowerCase() === check.keyword.toLowerCase())
      return { check, pass: has, saw: node.keywords.join(', ') || '(no keywords)' }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The report                                                                 */
/* -------------------------------------------------------------------------- */

export type ConversationScore = {
  readonly conversation: string
  readonly group: Conversation['group']
  readonly turns: readonly TurnScore[]
  readonly trajectory: TrajectoryScore
  readonly state: readonly CheckResult[]
  /** Every axis clean. The number a person would call "did it work". */
  readonly clean: boolean
}

export function scoreConversation(
  conversation: Conversation,
  perTurn: readonly { calls: readonly CallRecord[]; answered: boolean }[],
  nodes: readonly BenchNode[],
): ConversationScore {
  const turns = conversation.turns.map((turn, i) =>
    scoreTurn(turn, perTurn[i]?.calls ?? [], perTurn[i]?.answered ?? false),
  )
  const trajectory = scoreTrajectory(perTurn.flatMap((t) => t.calls))
  const state = conversation.finalState.map((check) => checkState(check, nodes))

  return {
    conversation: conversation.id,
    group: conversation.group,
    turns,
    trajectory,
    state,
    // Every turn defensible AND every state claim true. Deliberately strict:
    // this is the headline number, and a headline that forgave a wrong final
    // state would be the kind of benchmark score nobody should trust.
    clean: turns.every((t) => t.correct) && state.every((s) => s.pass),
  }
}

/** The metrics, rolled up across conversations. */
export function summarise(scores: readonly ConversationScore[]) {
  const turns = scores.flatMap((s) => s.turns)
  const state = scores.flatMap((s) => s.state)
  const traj = scores.map((s) => s.trajectory)

  const sum = (pick: (t: TrajectoryScore) => number) => traj.reduce((n, t) => n + pick(t), 0)
  const writes = sum((t) => t.writes)
  const calls = sum((t) => t.calls)

  return {
    conversationsClean: scores.filter((s) => s.clean).length,
    conversations: scores.length,
    turnsCorrect: turns.filter((t) => t.correct).length,
    turns: turns.length,
    stateChecksPassed: state.filter((s) => s.pass).length,
    stateChecks: state.length,
    /** Of writes that needed an id, how many could have had one. */
    grounded: writes === 0 ? 1 : sum((t) => t.grounded) / writes,
    /** Of writes, how many had a read before them. */
    lookedFirst: writes === 0 ? 1 : sum((t) => t.lookedFirst) / writes,
    /** Of all calls, how many the runtime refused. Lower is better. */
    refusalRate: calls === 0 ? 0 : sum((t) => t.refused) / calls,
    repeats: sum((t) => t.repeats),
    calls,
    writes,
    /** The failure modes, counted, so a report can name them. */
    failures: turns.reduce<Record<string, number>>((acc, t) => {
      if (t.failure) acc[t.failure] = (acc[t.failure] ?? 0) + 1
      return acc
    }, {}),
    /**
     * The same score, per category.
     *
     * The reason the categories exist at all. A model can be excellent at
     * fetching a record and hopeless at noticing what is missing from one — and
     * "what is missing" is most of what somebody wants from a tracker after the
     * first month. One overall number averages those into something that
     * describes neither.
     */
    byGroup: GROUPS.map((group) => {
      const mine = scores.filter((s) => s.group === group)
      const groupTurns = mine.flatMap((s) => s.turns)
      const groupState = mine.flatMap((s) => s.state)
      return {
        group,
        clean: mine.filter((s) => s.clean).length,
        conversations: mine.length,
        turnsCorrect: groupTurns.filter((t) => t.correct).length,
        turns: groupTurns.length,
        stateChecksPassed: groupState.filter((s) => s.pass).length,
        stateChecks: groupState.length,
      }
    }).filter((g) => g.conversations > 0),
  }
}
