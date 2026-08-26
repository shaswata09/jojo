/**
 * L4 — the conversations that are still going, keyed by which conversation.
 *
 * THE DEFECT THIS EXISTS TO FIX, in one sentence: a run used to be stored in a
 * hook, so its lifetime was a component's lifetime. Every symptom followed from
 * that, and they were not all the same symptom:
 *
 *   - Leaving the Assistant page ORPHANED the run. The promise kept going and
 *     the exchange still saved, but the UI was gone — so coming back mid-run
 *     showed a thread with the question missing (it had never been stored) and
 *     a live composer, and asking again overwrote the first exchange when it
 *     finally landed. `assistant.thread.set` replaces the entry list wholesale;
 *     there is no merge and no version check.
 *   - Opening a second conversation ABORTED the first, and then `onSettled`
 *     wrote the first thread's transcript into the second, because it read
 *     "which thread is open now" at settle time rather than "which thread was
 *     this run for". That was unreachable only because every thread button in
 *     the list was `disabled` while anything was running — which is the user's
 *     actual complaint, spelled as an attribute.
 *   - A destructive step reached after the page closed DEADLOCKED. The approval
 *     promise resolved from a button inside the trace, so once that trace was
 *     unmounted nothing could ever resolve it; the loop parked on
 *     `await approve(...)` forever and the exchange was never saved.
 *
 * So a run lives here instead, in a registry mounted above the router, and the
 * screen becomes a view of it. Nothing about `runAgent` changes — it was always
 * headless, and takes its cancellation as a plain `{aborted}` object.
 *
 * WHAT IS DELIBERATELY NOT HERE. No clock, no storage, no `runtime`: the caller
 * hands over a `ToolHost` and an `onSettled`, so this file can be tested by
 * driving it with a two-line fake llm. It is the same reason `runAgent` takes
 * the model call as a parameter.
 *
 * THE SHAPE is `repo/queue.ts`'s, because that is this codebase's answer to
 * "mutable state that outlives a render and drives React": a factory closure,
 * locals rather than fields, a `Set` of listeners, and a getter returning a
 * value stable between notifications so `useSyncExternalStore` can compare it.
 */

import { kgError } from '../log'
import { runAgent } from '../agent/loop'
import type { AgentOptions } from '../agent/loop'
import type { AgentStep, Cancellation, LlmTurnFn } from '../agent/loop'
import type { ToolHost } from '../agent/execute'
import type { ChatMessage } from '../core/model-server'
import type { NodeId } from '../core/model'

/**
 * Every tool this conversation has already called.
 *
 * Read off the transcript rather than remembered in memory, because memory does
 * not survive a reload and the transcript does — it is stored in the graph. A
 * set rebuilt without these would drop a tool the replayed history shows being
 * used, which reads to the model as a capability being taken away mid-thread.
 */
function namesCalledIn(history: readonly ChatMessage[]): string[] {
  const out = new Set<string>()
  for (const message of history) {
    if (message.role !== 'assistant') continue
    for (const call of message.tool_calls ?? []) out.add(call.function.name)
  }
  return [...out]
}

/** One line of a conversation as a screen draws it. */
export type AgentEntry =
  | { kind: 'you'; id: string; text: string }
  /** Narration the model produced while still working. */
  | { kind: 'note'; id: string; text: string }
  | { kind: 'step'; id: string; step: AgentStep }
  | { kind: 'answer'; id: string; text: string }
  | { kind: 'error'; id: string; text: string }

/**
 * A destructive call waiting on a person.
 *
 * It lives on the RUN rather than in the screen that started it, which is the
 * whole point: the question outlives the page, so whatever is on screen when
 * the user comes back can answer it. A run parked here is not lost, it is
 * waiting — and `stop` resolves it rather than abandoning it, because a promise
 * nobody will ever settle is a run that can never be cleaned up.
 */
export type PendingApproval = {
  step: AgentStep
  decide: (allowed: boolean) => void
}

/** One conversation's live state. Frozen between notifications. */
export type AgentRun = {
  threadId: NodeId
  entries: readonly AgentEntry[]
  busy: boolean
  pending: PendingApproval | null
  /**
   * What the last turn was offered, for the next turn to start from.
   *
   * The retriever's carry is grow-only and was never used: this was hard-wired
   * to `null`, so turn one sent a narrowed set and turn two — "yes, do that",
   * which matches no seed and makes the retriever abstain — sent everything.
   * A conversation whose prompt prefix changes size between turns cannot be
   * prefix-cached, and on a small model the second message is where the window
   * runs out.
   *
   * Kept per THREAD rather than globally: two conversations about different
   * things should not inherit each other's tools.
   */
  offered: readonly string[] | null
}

/**
 * A run's cancellation, as the app that supplies the model call sees it.
 *
 * `Cancellation` in `loop.ts` is a bare `{aborted}` flag, deliberately — the
 * portable layers may not name `AbortSignal`, and the loop only ever reads the
 * flag between rounds. But a flag cannot cancel a socket: nothing can subscribe
 * to it, so pressing Stop left the HTTP request running to its 60-second
 * timeout with the UI already showing a stopped run.
 *
 * So the flag grows a subscription, and `AbortController` stays where it is
 * allowed to be — in the apps. They build one per run, hook it to `onAbort`,
 * and hand its signal to their own `agentTurn`.
 */
export type RunSignal = {
  readonly aborted: boolean
  /** Fires once when the run is stopped. Fires immediately if already stopped. */
  onAbort: (fn: () => void) => void
}

export type StartOptions = {
  /**
   * The conversation this run belongs to, decided BEFORE the first token.
   *
   * The old code minted the thread when the exchange settled, which is what
   * made a run rebindable to the wrong conversation. An id up front is what
   * lets everything here be keyed, and it is what lets the question be stored
   * immediately — so a run interrupted by a reload leaves the question behind
   * rather than nothing at all.
   */
  threadId: NodeId
  prompt: string
  /** The model-facing transcript so far. */
  history: readonly ChatMessage[]
  /**
   * Built per RUN rather than passed per render, so it can close over this
   * run's cancellation and abort its own request. See `RunSignal`.
   */
  llm: (signal: RunSignal) => LlmTurnFn
  host: ToolHost
  /** Which steps to stop and ask about. See `AgentOptions.gate`. */
  gate?: 'destructive' | 'writes' | 'none'
  /**
   * The conversation as it is stored, for a run the registry has never seen.
   *
   * Only read when there is no live run for the thread — see `start`. Stored
   * entries carry `t0…tn` ids and the registry mints `e0…en`, so the two can
   * never collide.
   */
  entries?: readonly AgentEntry[]
  tools?: readonly string[]
  maxSteps?: number
  /** The model's context window, so the loop can trim before the server does. */
  window?: number
  /** The tool chooser and the conversation summariser — both optional. */
  chooser?: AgentOptions['chooser']
  summariser?: AgentOptions['summariser']
  /** A previous compaction's summary, and where to report a new one. */
  context?: string
  onCompacted?: (threadId: NodeId, context: string, throughMessages: number) => void
  /**
   * Called once, with the thread this run was FOR.
   *
   * The id is passed back rather than read from the app's "currently open"
   * state, which is the bug that let one conversation overwrite another.
   */
  onSettled?: (threadId: NodeId, entries: readonly AgentEntry[], history: ChatMessage[]) => void
}

export type AgentRuns = {
  /** Ignored when that thread is already running. One run per conversation. */
  start: (options: StartOptions) => void
  stop: (threadId: NodeId) => void
  /** Forgets a settled run. A running one is stopped first. */
  forget: (threadId: NodeId) => void
  /** Answers a parked approval. Nothing happens if it is no longer waiting. */
  decide: (threadId: NodeId, allowed: boolean) => void
  get: (threadId: NodeId) => AgentRun | undefined
  /** Every conversation with something in flight, so a list can say so. */
  busyThreads: () => readonly NodeId[]
  /** Everything parked on a person, so a root-level host can render it. */
  waiting: () => readonly AgentRun[]
  subscribe: (listener: () => void) => () => void
  /** Stops everything. For a store that is being torn down or replaced. */
  stopAll: () => void
}

/**
 * A place to send a throw that has no other home.
 *
 * A port rather than an import, because this layer may not reach into an app —
 * and because the two apps send it to different places: the phone has
 * Crashlytics and the browser does not.
 *
 * Optional, and absent means the console. Every existing test constructs this
 * registry with no arguments and none of them is about reporting.
 */
export type ErrorPort = (thrown: unknown) => void

export function createAgentRuns(onError?: ErrorPort): AgentRuns {
  /** The live state per conversation, replaced wholesale on every change. */
  const runs = new Map<NodeId, AgentRun>()
  /** The mutable bookkeeping a run needs and a reader must never see. */
  const inner = new Map<NodeId, { cancel: { aborted: boolean; fire: () => void }; seq: number }>()
  const listeners = new Set<() => void>()

  /*
   * Rebuilt only when something changed, because `useSyncExternalStore` compares
   * by reference and a getter that mints a fresh array every call re-renders
   * forever. `queue.ts` and `kg-context.ts` both make the same promise about
   * their getters, and for the same reason.
   */
  let busySnapshot: readonly NodeId[] = []
  let waitingSnapshot: readonly AgentRun[] = []

  function notify(): void {
    busySnapshot = [...runs.values()].filter((r) => r.busy).map((r) => r.threadId)
    waitingSnapshot = [...runs.values()].filter((r) => r.pending !== null)
    // Copied before iterating: a listener that unsubscribes itself while being
    // notified would otherwise mutate the set mid-loop.
    // eslint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...listeners]) listener()
  }

  const patch = (threadId: NodeId, change: Partial<AgentRun>): void => {
    const current = runs.get(threadId)
    if (!current) return
    runs.set(threadId, { ...current, ...change })
    notify()
  }

  /**
   * Adds or replaces one entry, by id.
   *
   * A step arrives twice under one id — running, then settled — so appending
   * would show a two-tool run as a four-tool one. This is the same rule the
   * hook used to implement twice, once for React state and once for the copy it
   * kept for saving; there is one list now, so there is one rule.
   */
  const record = (threadId: NodeId, entry: AgentEntry): void => {
    const current = runs.get(threadId)
    if (!current) return
    const at = current.entries.findIndex((e) => e.id === entry.id)
    const entries =
      at === -1
        ? [...current.entries, entry]
        : current.entries.map((e, i) => (i === at ? entry : e))
    runs.set(threadId, { ...current, entries })
    notify()
  }

  function start(options: StartOptions): void {
    const { threadId, prompt, history, llm, host, onSettled } = options
    const clean = prompt.trim()
    if (clean.length === 0) return
    // One run per conversation. A second send while the first is still going is
    // a mis-click, not an instruction — and two runs sharing one transcript
    // would each answer a different version of the conversation.
    if (runs.get(threadId)?.busy === true) return

    /*
     * A flag plus its listeners. `satisfies Cancellation` below still holds —
     * extra keys are fine on a variable reference, and the loop reads only
     * `aborted`.
     */
    const listeners: (() => void)[] = []
    const cancel = {
      aborted: false,
      onAbort: (fn: () => void) => {
        if (cancel.aborted) {
          fn()
          return
        }
        listeners.push(fn)
      },
      fire: () => {
        for (const fn of listeners.splice(0)) fn()
      },
    }
    /*
     * A run starts from what is ALREADY IN THE CONVERSATION, not only from what
     * this session happens to remember.
     *
     * The registry lives in memory above the router, which is what lets a run
     * survive navigation — and what empties it on a reload. `entries` used to be
     * seeded from `runs.get(threadId)` alone, so a conversation opened after a
     * reload (or after Clear, or simply picked from the list without having been
     * run this session) started with an empty list. `onSettled` then hands that
     * list to `assistant.thread.set`, which REPLACES the stored entries — and
     * `threadSet` is `undoable: false`.
     *
     * So: reload, ask a follow-up, and every earlier turn was destroyed on
     * screen and on disk, with no undo and nothing to indicate it. Measured — a
     * conversation of two questions and two answers came back as one question
     * and one answer, while the model still answered correctly because `history`
     * was passed separately and was right.
     *
     * `options.entries` is the stored transcript. It is used only when the
     * registry has nothing, because an in-session run already holds those turns
     * and taking both would duplicate them.
     */
    const existing = runs.get(threadId)
    const before = existing?.entries ?? options.entries ?? []
    const seq = (inner.get(threadId)?.seq ?? before.length) + 1
    inner.set(threadId, { cancel, seq })

    const nextId = () => {
      const state = inner.get(threadId)
      if (!state) return 'e0'
      state.seq += 1
      return `e${String(state.seq)}`
    }

    runs.set(threadId, {
      threadId,
      entries: [...before, { kind: 'you', id: `e${String(seq)}`, text: clean }],
      busy: true,
      pending: null,
      // Carried from the previous turn of THIS thread, not reset. Resetting it
      // here would put the second message back to offering everything, which is
      // the whole defect.
      offered: runs.get(threadId)?.offered ?? null,
    })
    notify()

    /*
     * The loop's step id -> this thread's entry id, for THIS run only.
     * See the note at the `step` event below for why both halves are needed.
     */
    const stepEntries = new Map<string, string>()
    const entryForStep = (stepId: string): string => {
      const seen = stepEntries.get(stepId)
      if (seen !== undefined) return seen
      const minted = nextId()
      stepEntries.set(stepId, minted)
      return minted
    }

    /**
     * The approval gate, parked on the RUN.
     *
     * Resolved by `decide`, which anything holding the registry can call — a
     * root-level host, a toast, the Assistant page if it happens to be open.
     * `stop` also resolves it, with a refusal, so a run can always be ended.
     */
    const approve = (step: AgentStep): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        if (cancel.aborted) {
          resolve(false)
          return
        }
        let settled = false
        const decide = (allowed: boolean) => {
          if (settled) return
          settled = true
          patch(threadId, { pending: null })
          resolve(allowed)
        }
        patch(threadId, { pending: { step, decide } })
      })

    /*
     * `try/finally` around the whole run, and the `finally` is the point.
     *
     * Everything below can throw, and until this wrapper existed nothing caught
     * it: the promise was driven by a bare `void (async () => …)()`, so a throw
     * anywhere under `runAgent` left `busy: true` set forever. The composer
     * stayed disabled, the spinner never stopped, `onSettled` never fired, and
     * `stop()` could not clear it because the run had already left the loop it
     * polls. The exchange was simply lost, with no error on screen.
     *
     * Two reachable throws found it — a message containing the word
     * "constructor" (see `agent/retrieve.ts`) and a `graph.query` for a path
     * with an endpoint missing. Both are fixed at their source, and neither fix
     * would have prevented the NEXT one. A thread that cannot get stuck is a
     * property of this function, not of the code beneath it.
     *
     * The error is recorded as an entry as well as being cleared, because a
     * conversation that silently stops answering reads as a broken app rather
     * than as a failed request.
     */
    /*
     * The prose currently streaming, or null between rounds.
     *
     * Per RUN rather than per registry, so two conversations streaming at once
     * cannot append each other's fragments — which is the bug the run token
     * further down exists to prevent in the settle path.
     */
    let draft: { id: string; text: string } | null = null

    void (async () => {
      try {
        const run = await runAgent({
          host,
          llm: llm(cancel),
          history,
          prompt: clean,
          ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
          ...(options.window === undefined ? {} : { window: options.window }),
          ...(options.chooser === undefined ? {} : { chooser: options.chooser }),
          ...(options.summariser === undefined ? {} : { summariser: options.summariser }),
          ...(options.tools === undefined ? {} : { tools: options.tools }),
          /*
           * The retriever, on for the Assistant and nothing else.
           *
           * `tools` wins outright when a caller named one — AskBox and the
           * pipelines choose deliberately, and this must not second-guess them.
           * The Assistant names nothing, which is exactly the surface that was
           * sending all 82 tools on every request.
           *
           * `fromHistory` is a correctness condition rather than a nicety. Thread
           * entries live in the graph, so after a reload the transcript replays
           * tool calls from earlier turns — and a freshly chosen set that did not
           * contain one of them would leave the conversation naming a tool that is
           * no longer available.
           */
          retrieve: {
            // What the previous turn used, so a follow-up the retriever cannot
            // read keeps the tools the conversation was already working with
            // instead of falling back to all of them.
            carried: runs.get(threadId)?.offered ?? null,
            fromHistory: namesCalledIn(history),
          },
          ...(options.gate === undefined ? {} : { gate: options.gate }),
          approve,
          signal: cancel satisfies Cancellation,
          onEvent: (event) => {
            if (event.type === 'step') {
              // A step ends whatever prose was streaming before it: the model
              // has stopped talking and started calling. Settling the draft here
              // keeps the entries in the order they happened.
              draft = null
              /*
               * `nextId()`, NOT the loop's own step id.
               *
               * `runAgent`'s counter restarts at 0 every run, so turn two's
               * first step arrives as `s1` again — and `record` upserts by
               * entry id. Turn one's tool row was OVERWRITTEN IN PLACE and turn
               * two's step filed under turn one's question, then persisted
               * through `assistant.thread.set`, which is `undoable: false`.
               *
               * Reproduced: two turns each calling one tool left five entries
               * where there should be six, with the surviving step row holding
               * the wrong turn's call. `toTranscript` then replays to the model
               * a tool call it never made.
               *
               * But the shared id was doing real work: a step is recorded
               * twice — `running`, then `done` — and the upsert is what makes
               * those ONE row instead of two. Minting a fresh id per event
               * fixes the collision and splits every tool call into a running
               * row that never resolves and a done row beside it. (Observed:
               * the first attempt at this fix did exactly that.)
               *
               * So: mint on first sighting, remember, reuse — per run, so the
               * next turn cannot reach it.
               */
              record(threadId, { kind: 'step', id: entryForStep(event.step.id), step: event.step })
              return
            }

            /*
             * The streaming half.
             *
             * `record` upserts by entry id, so a fragment can grow ONE entry
             * rather than appending a hundred. The draft is written as an
             * `answer` because that is what it usually becomes and it needs no
             * new rendering — the text simply lengthens on screen.
             *
             * When the round settles, `note` or `answer` arrives carrying the
             * whole of that round's prose, and it REUSES THE DRAFT'S ID so it
             * replaces the growing entry instead of appearing beside it. That is
             * the difference between an answer that resolves and one that shows
             * up twice.
             */
            if (event.type === 'delta') {
              if (draft === null) draft = { id: nextId(), text: '' }
              draft.text += event.text
              record(threadId, { kind: 'answer', id: draft.id, text: draft.text })
              return
            }

            const id = draft?.id ?? nextId()
            draft = null
            record(
              threadId,
              event.type === 'note'
                ? {
                    kind: 'note',
                    id,
                    text: event.text,
                    // Carried, because `toTranscript` reads it to decide whether
                    // this is replayed to the model as its own speech.
                    ...(event.app === true ? { app: true as const } : {}),
                  }
                : event.type === 'answer'
                  ? { kind: 'answer', id, text: event.text }
                  : { kind: 'error', id, text: event.reason },
            )
          },
        })

        // Carried into the next turn. `null` means everything was offered, and
        // storing that faithfully matters: it is the difference between "we
        // narrowed to these" and "we could not narrow".
        patch(threadId, { offered: run.offered })

        /*
         * A compaction is reported before the answer is, and on purpose.
         *
         * It is a fact about the thread rather than about this turn: the
         * summary was written, and if it is not persisted the next turn
         * summarises the same exchanges again. Reported here so it survives
         * even a turn that then fails.
         */
        if (run.compacted !== undefined) {
          options.onCompacted?.(threadId, run.compacted.context, run.compacted.messages)
        }

        const finished = runs.get(threadId)
        // The run's OWN thread, not whichever one is on screen now.
        onSettled?.(threadId, finished?.entries ?? [], run.messages.slice(1))
      } catch (e) {
        /*
         * Reported as well as shown. The entry below tells the person their
         * question failed; this tells whoever maintains jojo that it did — and
         * a throw reaching here is by definition a bug rather than a model
         * saying no, because every expected refusal returns a value.
         */
        // `kgError`, not a bare `console.error`. `log.ts` claims every one of
        // these carries the `[kg]` prefix so a person asked to read their
        // console knows which lines matter, and can silence the group — this
        // was the one line in the package for which that was not true, and it
        // is the loudest of them.
        if (onError) onError(e)
        else kgError('Agent run threw', e, { thread: threadId })
        record(threadId, {
          kind: 'error',
          id: nextId(),
          text:
            e instanceof Error && e.message
              ? `Something went wrong answering that: ${e.message}`
              : 'Something went wrong answering that.',
        })
      } finally {
        patch(threadId, { busy: false, pending: null })
        inner.delete(threadId)
      }
    })()
  }

  function stop(threadId: NodeId): void {
    const state = inner.get(threadId)
    if (state) {
      state.cancel.aborted = true
      // The request in flight, not just the loop between rounds. Without this
      // Stop meant "finish this round first", which on a slow model is up to a
      // minute of the UI saying stopped while the socket was still open.
      state.cancel.fire()
    }
    // Resolved rather than abandoned: a run parked on an approval cannot see
    // the abort flag — `runAgent` checks it between rounds, and the gate is
    // inside a round. Declining is what unparks it so it can notice.
    runs.get(threadId)?.pending?.decide(false)
  }

  function forget(threadId: NodeId): void {
    stop(threadId)
    runs.delete(threadId)
    inner.delete(threadId)
    notify()
  }

  return {
    start,
    stop,
    forget,
    decide: (threadId, allowed) => {
      runs.get(threadId)?.pending?.decide(allowed)
    },
    get: (threadId) => runs.get(threadId),
    busyThreads: () => busySnapshot,
    waiting: () => waitingSnapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    stopAll: () => {
      // Copied deliberately: `stop` resolves a parked approval, which can
      // settle a run and mutate this map while it is being walked.
      // eslint-disable-next-line unicorn/no-useless-spread
      for (const threadId of [...runs.keys()]) stop(threadId)
    },
  }
}
