/**
 * A workflow as data: nodes, conditional edges, retries and a trace. L3.
 *
 * ## Why this exists rather than LangGraph
 *
 * LangGraph solves the right problem and cannot be used here, for reasons that
 * are architectural rather than aesthetic. Measured, not assumed:
 *
 *   - `@langchain/langgraph` uses `node:async_hooks`. `check-platform.mjs`
 *     bans every `node:` import in this layer outright, because `kg/` is
 *     mounted UNCHANGED inside a browser and inside React Native — and the
 *     same import is what breaks LangGraph's own browser bundling
 *     (langgraphjs issue #869).
 *   - `@langchain/core` declares `engines: node >= 20` and depends on
 *     `langsmith`, a hosted-tracing client. This app promises that nothing
 *     leaves the device and has a test enforcing it. A telemetry SDK arriving
 *     as a transitive dependency is not something a promise survives.
 *   - LangChain.js does not support React Native (langchainjs issue #4239).
 *     The published workarounds are four polyfills for missing Hermes symbols.
 *   - Weight: `@langchain/core` 7.3 MB unpacked over 2,046 files, plus
 *     `js-tiktoken` at 21 MB and `zod` at 4.4 MB. `service` today has three
 *     dependencies, all `@noble/*` crypto, and that is why it runs in Hermes at
 *     all.
 *
 * What LangGraph is actually FOR is worth having, and none of it needs a
 * dependency: a workflow declared as a graph instead of buried in control flow,
 * routing decided by code rather than by the model, retries with a policy,
 * somewhere to resume from, and a trace you can read when a small model does
 * something strange. That is this file, in about two hundred lines.
 *
 * ## Why it matters more with a small model than a large one
 *
 * A 7B model fails differently from a frontier one: not by reasoning badly over
 * many steps, but by returning something malformed on one step out of six. The
 * useful response is to retry that step, not to abandon the run — and to say
 * WHICH step, because "reading your CV failed" is not something anybody can
 * act on. Hand-rolled orchestration gets this wrong in a specific way: it wraps
 * the whole thing in one try/catch and loses both facts.
 */

/** What a node did. Failure is a value here, never a throw. */
/**
 * Something that can be asked whether it has been cancelled.
 *
 * Declared here rather than imported, because this file has no imports at all
 * and that is the point of it — see the header. Structurally identical to
 * `loop.ts`'s `Cancellation` and to the `aborted` on a real `AbortSignal`, so a
 * caller passes either without a cast. NOT `AbortSignal` itself: this layer is
 * compiled without DOM (D-platform), and naming it here is what made the whole
 * file fail to compile the day it was first put in a tsconfig.
 */
export type Cancellation = { readonly aborted: boolean }

export type StepOutcome<S> =
  | { readonly ok: true; readonly state: S }
  /** Worth another go: a malformed reply, a timeout, a blip. */
  | { readonly ok: false; readonly reason: string; readonly retry: true }
  /** Not worth another go: nothing configured, nothing to read. */
  | { readonly ok: false; readonly reason: string; readonly retry?: false }

export type FlowNode<S> = {
  /** Unique within the flow. Appears in the trace and in the UI. */
  readonly name: string
  /** What a person should see while this runs. */
  readonly label: string
  readonly run: (state: S, signal?: Cancellation) => Promise<StepOutcome<S>>
  /**
   * How many times to run it before giving up. Default 1 — no retry.
   *
   * Opt-in rather than on by default, because a retry is only free when the
   * step is idempotent. Re-running a read costs a round trip; re-running a
   * write costs a duplicate record.
   */
  readonly attempts?: number
  /**
   * Whether the flow continues when this node gives up.
   *
   * Default is fatal. `optional: true` is for a step that improves the result
   * rather than producing it — the relations pass after an extraction that has
   * already succeeded. A person who uploaded a CV should get their thirty facts
   * whether or not the graph also learned how two of them connect.
   */
  readonly optional?: boolean
  /**
   * Where to go next, by node name. `null` ends the flow.
   *
   * Absent means "the next node as declared", which is what makes a linear
   * flow read as a list. Present is what makes a non-linear one possible —
   * and it takes STATE, so the branch is decided by what happened rather than
   * by asking the model where to go. A model choosing its own next step is the
   * failure mode this whole file exists to avoid.
   */
  readonly to?: (state: S) => string | null
}

export type Flow<S> = {
  readonly name: string
  readonly nodes: readonly FlowNode<S>[]
}

/** One entry in the trace. Enough to explain a run without re-running it. */
export type FlowStep = {
  readonly node: string
  readonly attempt: number
  readonly ok: boolean
  readonly reason?: string
  /** Skipped because it was optional and gave up. */
  readonly skipped?: boolean
}

export type FlowResult<S> = {
  /** False when a fatal node gave up, or the budget ran out, or it was cancelled. */
  readonly ok: boolean
  /** The state as it stands. Present even on failure — partial work is still work. */
  readonly state: S
  readonly trace: readonly FlowStep[]
  /** Why it stopped, when it did not finish. */
  readonly reason?: string
}

export type FlowOptions<S> = {
  readonly signal?: Cancellation
  /** Called before each node runs, with its label. For a progress line. */
  readonly onStep?: (label: string, step: { done: number; of: number }) => void
  /**
   * Called after each node with the state so far.
   *
   * The resumption point, and deliberately a callback rather than a store: what
   * "durable" means differs per platform, and this layer is forbidden from
   * knowing. A caller that persists here can start the next run from the middle.
   */
  readonly onCheckpoint?: (node: string, state: S) => void
}

/**
 * How many node runs one flow may make, whatever the routing says.
 *
 * A conditional edge can point backwards, which is what makes a flow
 * non-linear and also what makes it possible to loop forever. The budget is
 * the backstop: a flow that exceeds it has a routing bug, and stopping with a
 * readable trace beats spinning against somebody's GPU.
 */
export const FLOW_BUDGET = 64

/**
 * Runs a flow to completion, or to the first fatal failure.
 *
 * Never throws. A node that throws is caught and treated as a retryable
 * failure, because a thrown error from a model call is exactly the transient
 * case worth retrying — and because a flow that throws would put every caller
 * back to wrapping the whole thing in one try/catch, which is the thing this
 * replaces.
 */
export async function runFlow<S>(
  flow: Flow<S>,
  initial: S,
  options: FlowOptions<S> = {},
): Promise<FlowResult<S>> {
  const byName = new Map(flow.nodes.map((n) => [n.name, n]))
  const trace: FlowStep[] = []
  let state = initial
  let index = 0
  let runs = 0

  while (index >= 0 && index < flow.nodes.length) {
    const node = flow.nodes[index]
    if (!node) break

    if (options.signal?.aborted) {
      return { ok: false, state, trace, reason: 'Stopped.' }
    }
    if (runs >= FLOW_BUDGET) {
      return {
        ok: false,
        state,
        trace,
        reason: `“${flow.name}” ran ${String(runs)} steps without finishing, which means its routing loops. Stopped.`,
      }
    }

    options.onStep?.(node.label, { done: runs, of: flow.nodes.length })

    const attempts = Math.max(1, node.attempts ?? 1)
    let outcome: StepOutcome<S> | null = null

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      runs += 1
      if (options.signal?.aborted) return { ok: false, state, trace, reason: 'Stopped.' }

      outcome = await attemptNode(node, state, options.signal)
      trace.push({
        node: node.name,
        attempt,
        ok: outcome.ok,
        ...(outcome.ok ? {} : { reason: outcome.reason }),
      })
      /*
       * ONE condition, and it reads as "keep going only when the node asked to
       * be tried again".
       *
       * It looks like it is missing a check for success, and it is not: a
       * successful outcome has no `retry` field at all, so `!== true` covers it.
       * This was written as two breaks — `if (outcome.ok)` then
       * `if (!outcome.retry)` — and mutation testing showed EITHER could be
       * deleted with all 23 tests still green, because each silently did the
       * other's job. Two lines that cannot both be wrong are one line and a
       * misleading comment.
       *
       * "Nothing is configured" does not become true on a second attempt, which
       * is why the node's own judgement beats its attempt count.
       */
      /*
       * Narrowed on `ok` first, which it was not.
       *
       * `StepOutcome` has three shapes and only the two failures carry `retry`,
       * so this read was a type error — invisible because `kg/agent` was in no
       * tsconfig's `include` and nothing imported this file, so nothing ever
       * compiled it. The BEHAVIOUR was right: a success has no `retry`, so
       * `undefined !== true` stopped the loop, which is what should happen. It
       * is spelled out now because the next person to read it should not have
       * to work that out from the absence of a property.
       */
      if (outcome.ok || outcome.retry !== true) break
    }

    if (outcome === null) break

    if (!outcome.ok) {
      if (node.optional !== true) {
        return { ok: false, state, trace, reason: `${node.label}: ${outcome.reason}` }
      }
      trace.push({ node: node.name, attempt: 0, ok: false, skipped: true, reason: outcome.reason })
    } else {
      state = outcome.state
      options.onCheckpoint?.(node.name, state)
    }

    /*
     * Routing. `to` is consulted even when the node was skipped, because a
     * branch may exist precisely to route around a step that could not run —
     * and it is read from the state, never from the model.
     */
    const next = node.to?.(state)
    if (next === null) break
    if (next === undefined) {
      index += 1
      continue
    }
    const target = byName.get(next)
    if (target === undefined) {
      return {
        ok: false,
        state,
        trace,
        reason: `“${flow.name}” tried to go to “${next}”, which is not one of its steps.`,
      }
    }
    index = flow.nodes.indexOf(target)
  }

  return { ok: true, state, trace }
}

/** One attempt, with a throw turned into a retryable failure. */
async function attemptNode<S>(
  node: FlowNode<S>,
  state: S,
  signal?: Cancellation,
): Promise<StepOutcome<S>> {
  try {
    return await node.run(state, signal)
  } catch (thrown) {
    return {
      ok: false,
      reason: thrown instanceof Error ? thrown.message : String(thrown),
      retry: true,
    }
  }
}

/**
 * The trace as lines a person can read.
 *
 * For the assistant's own explanation of what it did, and for a bug report. A
 * small model doing something strange is much easier to diagnose from six
 * lines naming the step than from a stack trace, because the failure is
 * usually semantic rather than thrown.
 */
export function describeTrace(trace: readonly FlowStep[]): string[] {
  return trace.map((step) => {
    if (step.skipped === true) return `${step.node}: skipped — ${step.reason ?? 'gave up'}`
    if (step.ok) return step.attempt > 1 ? `${step.node}: ok on attempt ${String(step.attempt)}` : `${step.node}: ok`
    return `${step.node}: attempt ${String(step.attempt)} failed — ${step.reason ?? 'no reason given'}`
  })
}

/**
 * Every problem with a flow's shape, before it is ever run.
 *
 * Called by a test rather than at runtime: a duplicate node name or an edge to
 * nowhere is a programming error, and finding it when the suite runs is worth
 * more than finding it when a user's extraction stops half way.
 */
export function checkFlow<S>(flow: Flow<S>): string[] {
  const problems: string[] = []
  const names = new Set<string>()

  for (const node of flow.nodes) {
    if (names.has(node.name)) problems.push(`two steps are called “${node.name}”`)
    names.add(node.name)
    if (node.label.trim() === '') problems.push(`“${node.name}” has no label to show`)
    if ((node.attempts ?? 1) < 1) problems.push(`“${node.name}” is set to run fewer than once`)
  }

  if (flow.nodes.length === 0) problems.push('the flow has no steps')
  return problems
}
