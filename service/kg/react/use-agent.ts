/**
 * L4 — useAgent(): one conversation, as the screen showing it sees it.
 *
 * It used to OWN the run. Every piece of a run — the transcript, the busy flag,
 * the abort object, the pending approval — was state on this hook, which made a
 * run's lifetime a component's lifetime, and produced three separate failures
 * that all read as "the chat stopped":
 *
 *   - Leaving the page orphaned the run: the work carried on and still saved,
 *     but nothing rendered it, and coming back mid-run showed a conversation
 *     with the question missing and a live composer. Asking again then
 *     overwrote the first exchange, because `assistant.thread.set` replaces the
 *     entry list wholesale.
 *   - Opening another conversation aborted this one, and its answer was then
 *     written into the conversation now on screen. Unreachable only because the
 *     thread list disabled every row while anything ran — which is precisely
 *     the thing a person wanted to do.
 *   - A destructive step reached after the page closed parked `runAgent` on a
 *     promise resolved by a button that no longer existed. Forever.
 *
 * The run lives in `agent-runs.ts` now, in a registry above the router, keyed by
 * conversation. This reads it. What is left here is the part that genuinely is
 * per-screen: which conversation is being shown, and what to fall back to when
 * it is not running — the stored transcript.
 *
 * WHAT IT KEEPS THAT THE LOOP THROWS AWAY. The registry keeps the steps, so
 * their `undo` stays callable after the run has finished. An agent whose work
 * cannot be taken back once it has stopped running is an agent nobody should
 * let write.
 */

import { useCallback, useMemo } from 'react'
import type { AgentStep, LlmTurnFn } from '../agent/loop'
import type { ToolHost } from '../agent/execute'
import { dayOf } from '../core/project'
import type { ChatMessage } from '../core/model-server'
import type { NodeId } from '../core/model'
import { useAgentRun, useAgentRuns } from './agent-runs-context'
import type { AgentEntry, RunSignal } from './agent-runs'
import { useKg } from './kg-context'
import type { ToolName } from '../tools/index'

export type { AgentEntry } from './agent-runs'

export type AgentState = {
  entries: readonly AgentEntry[]
  /** True from the moment a prompt is sent until the run settles. */
  busy: boolean
  send: (prompt: string) => void
  stop: () => void
  clear: () => void
  /** Every step of this conversation that can still be taken back, newest first. */
  undoable: readonly AgentStep[]
}

export type UseAgentOptions = {
  /**
   * The model call, built per run, or null when nothing is connected.
   *
   * A FACTORY rather than the function itself, so each run can close over its
   * own cancellation and abort its own HTTP request — pressing Stop used to
   * leave the socket open to its sixty-second timeout with the UI already
   * saying the run had stopped. See `RunSignal`.
   *
   * Null rather than a throwing stub: "is there a model" is a question the
   * screen has to answer anyway to decide what to render, and a hook that
   * pretends otherwise until you press send is a hook that fails late.
   */
  llm: ((signal: RunSignal) => LlmTurnFn) | null
  maxSteps?: number
  /** Offer the model only these tools, by registry name. See `loop.ts`. */
  tools?: readonly string[]
  /**
   * Turns a stored document into Markdown, when the app has a reader configured.
   *
   * Passed in rather than built here for the reason `execute.ts` gives: both
   * halves — finding the bytes and sending them — are platform work this package
   * may not do.
   */
  convert?: ToolHost['convert']
  /**
   * The conversation on screen, and what is stored for it.
   *
   * `id` is null for a conversation nobody has started yet. It used to be an
   * opaque `key`, which was enough to notice a swap and not enough to key a run
   * — a run has to know which conversation it belongs to, or its answer lands
   * in whichever one happens to be open when it finishes.
   */
  thread: {
    id: NodeId | null
    entries: readonly AgentEntry[]
    history: readonly ChatMessage[]
    /**
     * Whether this conversation may be written to without asking.
     *
     * Off means every write stops and asks — not just deletes. That is the
     * point: "asks before it deletes" left editing a file, retagging a record
     * and rewriting a note as things that simply happened.
     */
    autoApprove?: boolean
  }
  /**
   * Mints a conversation for a first question, and returns its id.
   *
   * Called at SEND rather than at settle, which is the ordering that fixes two
   * things at once: the run gets a stable key before its first token, and the
   * question is stored immediately, so an interrupted run leaves the question
   * behind rather than nothing at all.
   *
   * The old comment here argued the opposite — that creating up front would
   * change the loaded thread's key mid-exchange and the reload would replace
   * the live turns with the empty ones just written. That was true while the
   * transcript came from storage. It comes from the run now, so a reload of the
   * stored thread cannot overwrite anything live.
   */
  startThread?: (prompt: string) => NodeId | null
  /**
   * Called once when an exchange settles, with the conversation it was FOR.
   *
   * The id is handed back rather than read from "which is open now", which is
   * what used to let one conversation's answer overwrite another's.
   */
  onSettled?: (
    threadId: NodeId,
    entries: readonly AgentEntry[],
    history: readonly ChatMessage[],
  ) => void
}

export function useAgent({
  llm,
  maxSteps,
  tools,
  convert,
  thread,
  startThread,
  onSettled,
}: UseAgentOptions): AgentState {
  const { repo, runtime, now } = useKg()
  const runs = useAgentRuns()
  const run = useAgentRun(thread.id)

  /**
   * The three functions the agent is allowed.
   *
   * `memory` is a getter, not a captured snapshot: the agent writes and then
   * reads within one run, and a snapshot taken when the hook rendered would
   * describe the graph as it was before its own first write.
   */
  const host = useMemo<ToolHost>(
    () => ({
      memory: () => repo.getSnapshot(),
      // A getter for the same reason `memory` is one: a conversation left open
      // overnight must not answer "is this overdue" against yesterday.
      today: () => dayOf(now()),
      check: (name, input) => runtime.check(name as ToolName, input) as never,
      run: (name, input) => runtime.run(name as ToolName, input as never) as never,
      ...(convert ? { convert } : {}),
    }),
    [convert, now, repo, runtime],
  )

  const send = useCallback(
    (prompt: string) => {
      const clean = prompt.trim()
      if (clean.length === 0 || !llm) return
      const id = thread.id ?? startThread?.(clean) ?? null
      if (id === null) return

      runs.start({
        threadId: id,
        prompt: clean,
        // The stored transcript, because an exchange only starts once the last
        // one settled and saved. One run per conversation is what makes that
        // true rather than hopeful.
        history: thread.history,
        /*
         * The same conversation as ENTRIES, for the registry to start from when
         * it has never seen this thread. `history` is what the model reads and
         * was always right; `entries` is what gets written back, and without
         * this it started empty after a reload and replaced the stored turns
         * with only the new one. See `agent-runs.ts` `start`.
         */
        entries: thread.entries,
        llm,
        host,
        ...(tools === undefined ? {} : { tools }),
        ...(maxSteps === undefined ? {} : { maxSteps }),
        gate: thread.autoApprove === true ? 'destructive' : 'writes',
        ...(onSettled ? { onSettled } : {}),
      })
    },
    [
      host,
      llm,
      maxSteps,
      onSettled,
      runs,
      startThread,
      thread.autoApprove,
      thread.entries,
      thread.history,
      thread.id,
      tools,
    ],
  )

  const stop = useCallback(() => {
    if (thread.id !== null) runs.stop(thread.id)
  }, [runs, thread.id])

  const clear = useCallback(() => {
    if (thread.id !== null) runs.forget(thread.id)
  }, [runs, thread.id])

  /*
   * The live run when there is one, the stored conversation otherwise.
   *
   * In that order, and it is the fix for the symptom people actually saw: come
   * back to a conversation mid-run and the run has the question and the answer
   * so far, while storage has neither — the exchange is written once, at the
   * end. Reading storage first is what made a working conversation look stopped.
   */
  const entries = run?.entries ?? thread.entries

  /**
   * Newest first, because undoing out of order is how a person un-does the
   * wrong thing. The most recent write is the one they meant.
   */
  const undoable = useMemo(
    () =>
      entries
        .filter((e): e is Extract<AgentEntry, { kind: 'step' }> => e.kind === 'step')
        .map((e) => e.step)
        .filter((s) => s.status === 'done' && typeof s.undo === 'function')
        .reverse(),
    [entries],
  )

  return { entries, busy: run?.busy ?? false, send, stop, clear, undoable }
}
