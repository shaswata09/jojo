/**
 * L4 — usePipelines(): the thing that actually runs a pipeline.
 *
 * Everything below this file is pure or transactional. This is where the two
 * impure facts live: a clock, and the decision to start a model round.
 *
 * WHERE THIS IS MOUNTED, AND WHY IT MATTERS. Above the router, through
 * `pipelines-context.ts` — not from the Job Scout page. Calling it from the page
 * made a pipeline's lifetime that page's lifetime: the cleanup below cleared the
 * interval and aborted the round in flight the moment you navigated away, while
 * the panel went on telling the user they "work while this tab is open". The
 * promise is the correct one; owning the engine above the router is what makes
 * it true.
 *
 * WHAT "RUNS IN THE BACKGROUND" MEANS HERE, EXACTLY. It means "while jojo is
 * open". Neither platform can do better and nothing installed pretends
 * otherwise: the web app has no service worker and a hidden tab's timers are
 * throttled to the point of uselessness; the phone app is bare React Native
 * with no background-task module, and its JavaScript is suspended outright when
 * the app leaves the foreground. So a pipeline is a loop that ticks while the
 * app is running, and every piece of state it needs to resume — when it last
 * ran, how many empty rounds it has had, what it has proposed — is in the
 * graph rather than in this hook. Close the tab mid-round and the round is
 * lost; reopen it and the pipeline picks up from the last thing it committed.
 * The UI says this in words, because a toggle that implies a daemon is a
 * promise the app cannot keep.
 *
 * ONE AT A TIME. `busy` is a ref, not state, and it gates every round. Two
 * pipelines against one local model would interleave two conversations through
 * one context window and halve the speed of both; and two agents proposing at
 * once produce a queue where the user cannot tell which suggestion came from
 * which search. The tick loop is a scheduler with a lock, which is the smallest
 * thing that is correct.
 *
 * WHY A TICKING INTERVAL AND NOT AN EFFECT PER PIPELINE. The obvious version
 * re-runs an effect whose deps include the pipeline list — and the pipeline
 * list changes on every graph write, including the writes the running pipeline
 * is making. That effect would tear down and restart mid-round, forever. So
 * there is one interval, keyed on the model connection alone, and it reads
 * current state off a ref that every render refreshes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { runAgent } from '../agent/loop'
import type { AgentStep, Cancellation } from '../agent/loop'
import type { LlmTurnFn } from '../agent/loop'
import type { ToolHost } from '../agent/execute'
import { PIPELINE_PROMPTS, proposingHost, toolsForKind } from '../agent/pipelines'
import { dayOf } from '../core/project'
import { AUTO_CAPABLE, WORKING_GAP_MS, isDue, shouldOfferShutdown } from '../core/proposal'
import { parseSources } from '../core/board'
import { twinBriefing, twinState } from '../core/twin'
import type { GraphSnapshot } from '../core/snapshot'
import type { Instant, Pipeline, PipelineKind, Proposal } from '../core/model'
import type { ToolName } from '../tools/index'
import type { ToolRuntime } from '../tools/runtime'
import { useGraph, useKg } from './kg-context'
import { useRun } from './use-tool'

/**
 * How often the scheduler looks at the clock. Not how often a pipeline runs.
 *
 * Matched to `WORKING_GAP_MS`, which is the shortest gap `isDue` can ask for: a
 * tick slower than that would stretch every gap to the tick, and a tick faster
 * would be date comparisons nobody reads. The cadence that matters is the
 * pipeline's own `schedule`, and `isDue` decides when that applies.
 */
const TICK_MS = WORKING_GAP_MS

/** A line in the action log. What an unattended pipeline leaves behind. */
export type PipelineLogEntry = {
  id: string
  pipelineId: string
  at: Instant
  text: string
  tone: 'applied' | 'suggested' | 'error' | 'note'
}

/** The most log lines kept in memory. Oldest go; this is a session's record. */
const LOG_CAP = 200

export type PipelinesState = {
  pipelines: readonly Pipeline[]
  /** Every proposal, newest last. Filter with `pendingFor`. */
  proposals: readonly Proposal[]
  pendingFor: (pipelineId: string) => readonly Proposal[]
  /** The pipeline mid-round, if any. At most one. */
  running: string | null
  /** What the running pipeline last said about what it is doing. */
  activity: string | null
  log: readonly PipelineLogEntry[]
  /** Set when a pipeline has run out of work and wants to be switched off. */
  shutdownOffer: Pipeline | null
  /** True when no model is reachable, so nothing can run. */
  paused: boolean
  approve: (id: string) => void
  discard: (id: string) => void
  approveAll: (pipelineId: string) => void
  sweep: (pipelineId: string) => void
  setEnabled: (pipeline: Pipeline, enabled: boolean) => void
  setAuto: (pipeline: Pipeline, auto: boolean) => void
  runNow: (pipelineId: string) => void
  acceptShutdown: () => void
  dismissShutdown: () => void
}

export const kindOf = (p: Pipeline): PipelineKind => p.kind ?? 'scout'

/** Auto is a property of the pipeline AND of its kind. Both, every time. */
export const isAuto = (p: Pipeline): boolean => p.auto === true && AUTO_CAPABLE[kindOf(p)]

export function usePipelines({
  llm,
  maxSteps,
  convert,
  scan,
  onError,
}: {
  /** `null` when no model is configured — the whole feature is then paused. */
  llm: LlmTurnFn | null
  maxSteps?: number
  convert?: ToolHost['convert']
  /**
   * Where a round that threw goes, beyond the pipeline's own log.
   *
   * Optional, and absent means the console only — every existing caller
   * constructed this hook without one.
   */
  onError?: (thrown: unknown) => void
  /**
   * Reads a job board, when this platform can. Absent is a supported state:
   * `board.search` then refuses with a sentence and the scout works from the
   * records instead.
   */
  scan?: ToolHost['scan']
}): PipelinesState {
  const graph = useGraph()
  const { repo, runtime, projections, now } = useKg()
  const run = useRun()

  const pipelines = projections.pipelines(graph)
  const proposals = projections.proposals(graph)

  const [running, setRunning] = useState<string | null>(null)
  const [activity, setActivity] = useState<string | null>(null)
  const [log, setLog] = useState<readonly PipelineLogEntry[]>([])

  /*
   * Current state for the tick loop, refreshed every render.
   *
   * The loop cannot close over `pipelines` — see the header. It reads this.
   */
  const state = useRef({ pipelines, proposals })
  state.current = { pipelines, proposals }

  const busy = useRef(false)
  const cancel = useRef<{ aborted: boolean } | null>(null)
  const logSeq = useRef(0)

  const note = useCallback(
    (pipelineId: string, text: string, tone: PipelineLogEntry['tone']) => {
      const entry: PipelineLogEntry = {
        id: `log-${String((logSeq.current += 1))}`,
        pipelineId,
        at: now(),
        text,
        tone,
      }
      setLog((prev) => (prev.length >= LOG_CAP ? [...prev.slice(1), entry] : [...prev, entry]))
    },
    [now],
  )

  /** The same three functions `useAgent` hands the assistant. */
  const host = useMemo<ToolHost>(
    () => ({
      memory: () => repo.getSnapshot(),
      // A getter, because a pipeline on a timer routinely outlives midnight.
      today: () => dayOf(now()),
      check: (name, input) => runtime.check(name as ToolName, input) as never,
      run: (name, input) => runtime.run(name as ToolName, input as never) as never,
      ...(convert ? { convert } : {}),
      ...(scan ? { scan } : {}),
    }),
    [convert, now, repo, runtime, scan],
  )

  /* --------------------------------- a round ------------------------------ */

  /*
   * The round itself is `runPipelineRound`, at module level.
   *
   * Not a tidying. Nothing in this package can render a hook, so for as long as
   * the round was a closure inside one, the `try`/`finally` that keeps the
   * engine-wide lock from being held forever had no test — and an untested
   * `finally` is the kind that gets deleted by the next person who reads the
   * function. The refs are plain `{current}` cells and the setters are plain
   * functions, so handing them over costs nothing.
   */
  const runRound = useCallback(
    async (pipeline: Pipeline) => {
      if (!llm) return
      await runPipelineRound(pipeline, {
        llm,
        host,
        runtime,
        note,
        busy,
        cancel,
        setRunning,
        setActivity,
        ...(maxSteps === undefined ? {} : { maxSteps }),
        ...(onError === undefined ? {} : { onError }),
        agent: runAgent,
      })
    },
    [host, llm, maxSteps, note, onError, runtime],
  )

  /* ------------------------------ the scheduler --------------------------- */

  const runRoundRef = useRef(runRound)
  runRoundRef.current = runRound

  useEffect(() => {
    if (!llm) return
    const tick = () => {
      if (busy.current) return
      const at = now()
      /*
       * Longest-waiting first, not first-in-the-list.
       *
       * `find` was wrong here and the way it was wrong is worth keeping: only
       * one pipeline runs at a time, so taking the first due one every tick
       * meant the first pipeline in the list ran every round and every other
       * one starved forever. With three switched on, two of them never ran at
       * all — which looked exactly like the feature not working, rather than
       * like a scheduler picking badly. A pipeline that has never run sorts
       * first, so a newly created one goes next rather than last.
       */
      const due = state.current.pipelines
        .filter((p) => p.enabled && isDue(p.schedule, p.lastRunAt, at, p.idleRounds ?? 0))
        .sort((a, b) => (a.lastRunAt ?? '').localeCompare(b.lastRunAt ?? ''))[0]
      if (due) void runRoundRef.current(due)
    }
    // Once immediately, so switching a pipeline on does something visible
    // rather than something that will happen within fifteen seconds.
    tick()
    const id = setInterval(tick, TICK_MS)
    return () => {
      clearInterval(id)
      abortInFlight(cancel)
    }
  }, [llm, now])

  /* -------------------------------- answering ----------------------------- */

  const approve = useCallback(
    (id: string) => {
      const result = run('pipeline.proposal.approve', { id })
      // The failure path writes the reason onto the card in a second commit —
      // see `pipeline.proposal.fail`. It has to be a second one: the approval
      // that failed rolled its own transaction back.
      if (!result.ok) {
        runtime.run('pipeline.proposal.fail', {
          id,
          error: result.errors.map((e) => e.message).join('; '),
        })
      }
    },
    [run, runtime],
  )

  const discard = useCallback((id: string) => void run('pipeline.proposal.discard', { id }), [run])

  const approveAll = useCallback(
    (pipelineId: string) => {
      /*
       * One at a time, not one transaction. They are independent decisions that
       * happen to have been made together, and a batch that rolls back because
       * the fourth card's application was deleted would discard three
       * approvals the user meant. Each is its own journal row and its own undo.
       */
      for (const p of state.current.proposals) {
        if (p.pipelineId === pipelineId && p.status === 'pending') approve(p.id)
      }
    },
    [approve],
  )

  const sweep = useCallback(
    (pipelineId: string) => void run('pipeline.proposal.sweep', { pipelineId }),
    [run],
  )

  /* -------------------------------- the toggle ---------------------------- */

  const setEnabled = useCallback(
    (pipeline: Pipeline, enabled: boolean) => {
      run('scout.pipeline.enable.set', { id: pipeline.id, enabled })
      // Switching one off mid-round stops the round too; the derived offer
      // falls away on its own, because a disabled pipeline is not a candidate.
      if (!enabled && running === pipeline.id) abortInFlight(cancel)
    },
    [run, running],
  )

  const setAuto = useCallback(
    (pipeline: Pipeline, auto: boolean) => void run('scout.pipeline.update', { id: pipeline.id, auto }),
    [run],
  )

  const runNow = useCallback(
    (pipelineId: string) => {
      const pipeline = state.current.pipelines.find((p) => p.id === pipelineId)
      if (pipeline) void runRoundRef.current(pipeline)
    },
    [],
  )

  const pendingFor = useCallback(
    (pipelineId: string) =>
      proposals.filter((p) => p.pipelineId === pipelineId && p.status === 'pending'),
    [proposals],
  )

  /**
   * Derived, not set at the end of a round — and the difference is a bug.
   *
   * Setting it when a round finishes asks the question once, at the one moment
   * the answer is most likely to be "no": the round that just went idle is
   * usually the round whose suggestions are still sitting unanswered, and
   * pending work correctly suppresses the offer. The user then clears the
   * queue, at which point the condition becomes true and nothing is watching —
   * and the next round that could notice is a whole schedule away.
   *
   * As a derived value it re-evaluates when the queue changes, so answering the
   * last card is what raises the question, which is also when it reads as a
   * sensible thing to be asked.
   *
   * Suppressed while a round is in flight: a pipeline that is working is not a
   * pipeline with nothing to do, whatever the counter said a moment ago.
   */
  const shutdownOffer = useMemo(
    () =>
      running === null
        ? (pipelines.find(
            (p) =>
              p.enabled &&
              shouldOfferShutdown(
                p.idleRounds ?? 0,
                proposals.filter((q) => q.pipelineId === p.id && q.status === 'pending').length,
              ),
          ) ?? null)
        : null,
    [pipelines, proposals, running],
  )

  const acceptShutdown = useCallback(() => {
    if (shutdownOffer) run('scout.pipeline.enable.set', { id: shutdownOffer.id, enabled: false })
  }, [run, shutdownOffer])

  /**
   * Dismissing resets the counter, so the same question is not asked again on
   * the very next round. "Not yet" has to mean something for at least one more
   * cycle, or the modal becomes a thing the user learns to click through.
   */
  const dismissShutdown = useCallback(() => {
    if (shutdownOffer) runtime.run('pipeline.run.record', { id: shutdownOffer.id, raised: 1 })
  }, [runtime, shutdownOffer])

  return {
    pipelines,
    proposals,
    pendingFor,
    running,
    activity,
    log,
    shutdownOffer,
    paused: !llm,
    approve,
    discard,
    approveAll,
    sweep,
    setEnabled,
    setAuto,
    runNow,
    acceptShutdown,
    dismissShutdown,
  }
}

/* ------------------------------- one round --------------------------------- */

/**
 * Stops the round in flight, if there is one.
 *
 * A function rather than two lines at each of its two call sites, because one
 * of those sites is an effect cleanup: `exhaustive-deps` cannot tell a ref
 * holding a cancellation flag from a ref holding a DOM node, and reading
 * `.current` in a cleanup is a real bug for the second kind. Reading it here
 * says which kind this is.
 */
const abortInFlight = (cancel: RoundDeps['cancel']): void => {
  if (cancel.current) cancel.current.aborted = true
}

/** Everything a round needs that only the hook can own. See `runPipelineRound`. */
export type RoundDeps = {
  llm: LlmTurnFn
  host: ToolHost
  runtime: Pick<ToolRuntime, 'run'>
  note: (pipelineId: string, text: string, tone: PipelineLogEntry['tone']) => void
  /** The engine-wide lock. A `useRef` cell, which is a plain `{current}` box. */
  busy: { current: boolean }
  /** The round in flight, so the scheduler's cleanup and the toggle can stop it. */
  cancel: { current: { aborted: boolean } | null }
  setRunning: (id: string | null) => void
  setActivity: (text: string | null) => void
  maxSteps?: number
  /**
   * `runAgent`, handed in rather than reached for.
   *
   * The hook is where the decision to start a model round lives (see the
   * header); this is the function that carries it out, and the two things a
   * test has to be able to say about a round — it was stopped, it threw — are
   * things only the agent can say.
   */
  agent: typeof runAgent
  /**
   * Where a round that threw goes, beyond the pipeline's own log.
   *
   * A port rather than an import: this layer may not reach into an app, and the
   * two send it to different places — the phone has Crashlytics and the browser
   * does not. Same shape as `createAgentRuns`.
   */
  onError?: (thrown: unknown) => void
}

/**
 * One round, for one pipeline. Takes the lock, releases it whatever happens.
 */
export async function runPipelineRound(pipeline: Pipeline, deps: RoundDeps): Promise<void> {
  const { llm, host, runtime, note, busy, cancel, setRunning, setActivity, maxSteps, agent, onError } =
    deps
  if (busy.current) return
  busy.current = true
  setRunning(pipeline.id)
  setActivity(null)

  const kind = kindOf(pipeline)
  const auto = isAuto(pipeline)
  const stop = { aborted: false }
  cancel.current = stop

  // The model's own prose, kept so the proposing host can use the latest of
  // it as a rationale. See `ProposalSink.rationale`.
  let latest = ''

  /*
   * The boards THIS pipeline may open, from the field the person typed.
   *
   * Same `parseSources` call the prompt uses a few lines down, deliberately:
   * the model is told exactly the set it is allowed, so the allowlist and
   * the instructions cannot drift apart. Passed even when empty, because an
   * empty list is a real answer — a pipeline whose `source` is prose has no
   * board to read, and `board.search` says so rather than opening whatever
   * the model came up with instead. See `ToolHost.boards`.
   */
  const withBoards: ToolHost = { ...host, boards: parseSources(pipeline.source) }

  const agentHost = auto
    ? withBoards
    : proposingHost(withBoards, {
        pipelineId: pipeline.id as never,
        kind,
        rationale: () => latest,
      })

  /*
   * `try`/`finally` around the whole round, and the `finally` is the point.
   *
   * `busy` is ONE lock for the WHOLE engine — see "ONE AT A TIME" in the header
   * — and until this wrapper existed a single throw held it forever: the tick
   * loop returned at its first line on every tick, so every pipeline stopped,
   * `runNow` did nothing, and the panel went on showing the pipeline that
   * failed as working. Nothing short of a reload recovered it, and the person
   * saw a feature that had quietly stopped rather than an error.
   *
   * Both awaited things throw. `runAgent` does — `agent-runs.ts` documents the
   * two reachable ones it found, and says the same thing this does: fixing
   * either at its source would not have prevented the next. And
   * `pipeline.run.record` does, because `repo.commit` sits OUTSIDE the `try`
   * inside `runtime.run` and only a `ToolFailure` is turned into a result.
   */
  try {
    const result = await agent({
      host: agentHost,
      llm,
      history: [],
      // Through `host`, not `repo`: it is the seam the agent itself reads
      // the store through, and it is what the hook already hands down.
      prompt: promptFor(pipeline, kind, host.memory()),
      tools: toolsForKind(kind),
      ...(maxSteps === undefined ? {} : { maxSteps }),
      signal: stop satisfies Cancellation,
      onEvent: (event) => {
        if (event.type === 'note') {
          latest = event.text
          setActivity(event.text)
          return
        }
        if (event.type === 'error') {
          note(pipeline.id, event.reason, 'error')
          return
        }
        if (event.type === 'step') recordStep(pipeline.id, event.step, auto, note)
      },
    })

    // Reads do not count as work. A round that looked at everything and
    // proposed nothing is an idle round, which is the whole point of the
    // counter — a pipeline that keeps reading and never suggesting is exactly
    // the one that should offer to switch itself off.
    const raised = result.steps.filter((s) => s.status === 'done' && s.effect !== 'read').length
    if (result.answer && raised === 0) note(pipeline.id, result.answer, 'note')

    /*
     * A round that was STOPPED is not a round that found nothing.
     *
     * `pipeline.run.record` writes two things — `lastRunAt` and the idle
     * counter — and an abort corrupts both. Aborting is not rare: the tick
     * effect's cleanup fires on every change of `llm` identity, and that
     * identity is rebuilt from the model settings, which Settings saves as the
     * person types. So typing a server name while a pipeline is mid-round used
     * to bump its idle count and push `lastRunAt` forward: the pipeline lost a
     * whole schedule gap it had already waited for, and reached the "switch me
     * off?" offer a round earlier than it had earned. `stopped: 'aborted'` is
     * the loop saying it never got to the end, and it is the one outcome that
     * must leave the pipeline exactly as it found it.
     *
     * The throw path below is the same case for the same reason, and gets it
     * for free by never reaching this line.
     */
    if (result.stopped !== 'aborted') {
      runtime.run('pipeline.run.record', { id: pipeline.id, raised })
    }
  } catch (e) {
    // Written to the log, not only rethrown into nothing. The tick loop drops
    // this promise (`void runRoundRef.current(due)`), so without a line here a
    // round that threw is a pipeline that silently stopped producing anything
    // — and the log is the whole of what an unattended pipeline leaves behind.
    note(
      pipeline.id,
      e instanceof Error && e.message
        ? `That round did not finish: ${e.message}`
        : 'That round did not finish.',
      'error',
    )
    /*
     * AND reported, because catching it here took the only durable record away.
     *
     * The throw used to escape into the dropped promise at
     * `void runRoundRef.current(due)` and reach the app's `unhandledrejection`
     * listener, which writes to the console, to the crash ring the Diagnostics
     * panel reads, and to the one analytics event this app sends. Catching it
     * fixed a real problem — a rejected round left the schedule wedged — and
     * silently traded all three for a `note()` that is capped at two hundred
     * entries and gone on reload.
     *
     * A port rather than an import: this layer may not reach into an app, and
     * the two send it to different places — the phone has Crashlytics and the
     * browser does not. Same shape as `createAgentRuns`.
     */
    onError?.(e)
  } finally {
    busy.current = false
    cancel.current = null
    setRunning(null)
    setActivity(null)
  }
}

/* --------------------------------- helpers -------------------------------- */

/**
 * What the pipeline is asked to do, this round.
 *
 * The kind's standing instructions plus this pipeline's own words. `filter` and
 * `source` are free text the user typed, which is why they arrive quoted and
 * described rather than interpolated as if they were commands.
 */
function promptFor(pipeline: Pipeline, kind: PipelineKind, memory: GraphSnapshot): string {
  const parts = [PIPELINE_PROMPTS[kind], `The saved search is called “${pipeline.name}”.`]
  if (pipeline.filter && pipeline.filter !== '—') {
    parts.push(`The person described what matters to them as: “${pipeline.filter}”.`)
  }
  if (kind === 'twin') {
    /*
     * Computed, not asked for. Absence is the one thing a language model is
     * reliably bad at noticing — it sees what is there — so the round arrives
     * already knowing which documents have never been read and which skills are
     * not yet keywords, and spends its judgement on what the documents mean.
     *
     * Empty when there is nothing to say, and appended unconditionally: a
     * prompt ending in "here is what is missing:" with nothing after it reads
     * as a truncated instruction and models treat it as one. `twinBriefing`
     * returns '' rather than a heading for exactly that reason.
     */
    const briefing = twinBriefing(twinState(memory))
    if (briefing) parts.push(briefing)
  }

  if (kind === 'scout') {
    /*
     * Parsed, not quoted. The model is being asked to call `board.search` with
     * one of these, so handing it the raw field would hand it "cra.org/ads,
     * the CRA board" and let it guess which half is an address. `parseSources`
     * is the first thing that ever read this field — both dialogs have promised
     * comma separation since the beginning and nothing split on one.
     */
    const boards = parseSources(pipeline.source)
    if (boards.length > 0) {
      parts.push(`The boards to read, one at a time: ${boards.join(', ')}.`)
    } else if (pipeline.source && pipeline.source !== '—') {
      parts.push(
        `They described where to look as “${pipeline.source}”, which is not an address you can open — work from the records instead.`,
      )
    }
  }
  return parts.join(' ')
}

/** One step, as a log line. Only writes are worth a line. */
function recordStep(
  pipelineId: string,
  step: AgentStep,
  auto: boolean,
  note: (pipelineId: string, text: string, tone: PipelineLogEntry['tone']) => void,
): void {
  if (step.status === 'running') return

  /*
   * Reads leave no line, with one exception, and the exception is the point.
   *
   * `memory.list` and friends are the agent thinking, and a log full of them
   * buries the two lines that matter. Reading a job board is different in kind:
   * it is the pipeline reaching OUT to somebody else's server, which is the one
   * thing on this page a person might reasonably want an account of. A feature
   * whose honesty story is "the log is what an unattended pipeline leaves
   * behind" cannot leave that out.
   */
  if (step.effect === 'read') {
    if (step.name !== 'board.search' || step.status !== 'done') return
    const url = (step.args as { url?: unknown } | null)?.url
    note(pipelineId, `Read ${typeof url === 'string' ? url : 'a job board'}`, 'note')
    return
  }
  if (step.status === 'failed') {
    note(pipelineId, step.detail ?? `${step.title} did not work.`, 'error')
    return
  }
  if (step.status !== 'done') return
  note(
    pipelineId,
    step.announcement?.description
      ? `${step.announcement.title} — ${step.announcement.description}`
      : (step.announcement?.title ?? step.title),
    auto ? 'applied' : 'suggested',
  )
}
