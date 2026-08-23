import { useCallback, useMemo, useRef, useState } from 'react'
import type { ChatMessage } from '../core/model-server'
import { runAgent } from '../agent/loop'
import type { AgentStep, Cancellation, LlmTurnFn } from '../agent/loop'
import type { ToolHost } from '../agent/execute'
import type { ToolName } from '../tools/index'
import { useKg } from './kg-context'

/**
 * L4 — the agent, as one hook both apps drive.
 *
 * Everything platform-specific was already pushed out before this file existed:
 * the model call is a function the caller supplies (`loop.ts` explains why), the
 * tools come from the registry, and the transcript is plain data. What is left
 * is React state, which is identical on a phone and in a browser — so it is
 * written once here rather than twice in two `src/lib` folders that would then
 * drift. `check-no-copies` would not have caught that drift either: two hooks
 * that agree on 90% of their lines are not twins, they are a fork.
 *
 * WHY THE TRANSCRIPT IS ONE FLAT LIST. What the user asked for is to see what
 * the agent is doing, in order — so the thing the UI renders is the order.
 * Notes, tool calls and the answer go into one array as they happen rather than
 * into three collections a view would have to interleave, because an
 * interleaving computed at render time is one that can be computed wrongly.
 *
 * WHAT IT KEEPS THAT THE LOOP THROWS AWAY. `runAgent` returns the model-facing
 * transcript; this keeps it as `history` so the next question continues the same
 * conversation, and keeps the steps so their `undo` stays callable after the run
 * has finished. An agent whose work cannot be taken back once it has stopped
 * running is an agent nobody should let write.
 */

export type AgentEntry =
  | { kind: 'you'; id: string; text: string }
  /** Narration the model produced while still working. */
  | { kind: 'note'; id: string; text: string }
  | { kind: 'step'; id: string; step: AgentStep }
  | { kind: 'answer'; id: string; text: string }
  | { kind: 'error'; id: string; text: string }

export type AgentState = {
  entries: readonly AgentEntry[]
  /** True from the moment a prompt is sent until the run settles. */
  busy: boolean
  send: (prompt: string) => Promise<void>
  stop: () => void
  clear: () => void
  /** Every step of this session that can still be taken back, newest first. */
  undoable: readonly AgentStep[]
}

export type UseAgentOptions = {
  /**
   * The model call, or null when nothing is connected.
   *
   * Null rather than a throwing stub: "is there a model" is a question the
   * screen has to answer anyway to decide what to render, and a hook that
   * pretends otherwise until you press send is a hook that fails late.
   */
  llm: LlmTurnFn | null
  /** Asked before every destructive call. See `loop.ts`. */
  approve?: (step: AgentStep) => boolean | Promise<boolean>
  maxSteps?: number
  /** Offer the model only these tools, by registry name. See `loop.ts`. */
  tools?: readonly string[]
}

export function useAgent({ llm, approve, maxSteps, tools }: UseAgentOptions): AgentState {
  const { repo, runtime } = useKg()
  const [entries, setEntries] = useState<readonly AgentEntry[]>([])
  const [busy, setBusy] = useState(false)
  /** The model-facing transcript, so a follow-up means something. */
  const history = useRef<ChatMessage[]>([])
  /**
   * A mutable flag rather than an `AbortController`.
   *
   * `AbortController` is a DOM global this package does not have — see
   * `types/portable-globals.d.ts` — and the loop only ever reads `.aborted`, so
   * a one-key object does the whole job on every platform.
   */
  const abort = useRef<{ aborted: boolean } | null>(null)
  const seq = useRef(0)
  const nextId = () => `e${String((seq.current += 1))}`

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
      check: (name, input) => runtime.check(name as ToolName, input) as never,
      run: (name, input) => runtime.run(name as ToolName, input as never) as never,
    }),
    [repo, runtime],
  )

  const send = useCallback(
    async (prompt: string) => {
      const clean = prompt.trim()
      if (!clean || busy || !llm) return

      const cancel = { aborted: false }
      abort.current = cancel
      setBusy(true)
      setEntries((prev) => [...prev, { kind: 'you', id: nextId(), text: clean }])

      /**
       * A step arrives twice — running, then settled — under one id.
       *
       * Replaced in place rather than appended, which is the whole reason
       * `AgentStep.id` is stable: appending would show the same call twice and
       * make a two-tool run look like a four-tool one.
       */
      const onStep = (step: AgentStep) => {
        setEntries((prev) => {
          const at = prev.findIndex((e) => e.kind === 'step' && e.step.id === step.id)
          if (at === -1) return [...prev, { kind: 'step', id: `s-${step.id}`, step }]
          const next = [...prev]
          next[at] = { kind: 'step', id: `s-${step.id}`, step }
          return next
        })
      }

      const run = await runAgent({
        host,
        llm,
        history: history.current,
        prompt: clean,
        ...(maxSteps === undefined ? {} : { maxSteps }),
        ...(tools === undefined ? {} : { tools }),
        ...(approve ? { approve } : {}),
        signal: cancel satisfies Cancellation,
        onEvent: (event) => {
          if (event.type === 'step') onStep(event.step)
          else if (event.type === 'note')
            setEntries((prev) => [...prev, { kind: 'note', id: nextId(), text: event.text }])
          else if (event.type === 'answer')
            setEntries((prev) => [...prev, { kind: 'answer', id: nextId(), text: event.text }])
          else setEntries((prev) => [...prev, { kind: 'error', id: nextId(), text: event.reason }])
        },
      })

      // Kept whatever the outcome, including after the cap or an error: the
      // model needs to see what it already did, or a follow-up starts by
      // repeating it.
      history.current = run.messages.slice(1)
      abort.current = null
      setBusy(false)
    },
    [approve, busy, host, llm, maxSteps, tools],
  )

  const stop = useCallback(() => {
    if (abort.current) abort.current.aborted = true
  }, [])

  const clear = useCallback(() => {
    if (abort.current) abort.current.aborted = true
    history.current = []
    setEntries([])
  }, [])

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

  return { entries, busy, send, stop, clear, undoable }
}
