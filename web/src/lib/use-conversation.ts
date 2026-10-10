import { useCallback, useMemo } from 'react'
import { focusLine } from '@jojo/service/agent/focus'
import type { Application, NodeId } from '@jojo/service/core/model'
import type { ChatMessage } from '@jojo/service/core/model-server'
import { contextOf } from '@jojo/service/core/provider'
import type { RunSignal } from '@jojo/service/react/agent-runs'
import type { AgentEntry } from '@jojo/service/react/use-agent'
import { useAgent } from '@jojo/service/react/use-agent'
import { useApplications } from '@jojo/service/react/use-applications'
import {
  historyFor,
  toAgentEntries,
  toThreadEntries,
  useThreads,
} from '@jojo/service/react/use-threads'
import { agentTurn, isConfigured } from '@/lib/llm'
import { useModelSettings } from '@/lib/model-settings-context'
import { useReadDocument } from '@/lib/read-document'

/**
 * One conversation with the agent, wired the way every chat surface needs it.
 *
 * The Assistant page and each window of the floating chat dock show the same
 * kind of thing — a conversation that can run tools — and used to be one
 * screen. The wiring under it is long and easy to get subtly different: the
 * per-run abort, the chooser and summariser, the reader, which conversation a
 * settled run saves into, when a first question mints the conversation. So it
 * lives here once, and each surface keeps only what is genuinely its own: which
 * conversation is showing, and what happens when a new one is minted.
 *
 * THE SUBJECT. A conversation filed under an application is ABOUT it, and the
 * model is told so (`focusLine`): "draft a follow-up for this one" then has a
 * referent. A conversation not yet started takes its subject from
 * `applicationId` — the record that was open when it was begun — and is filed
 * under it the moment it is minted, so the subject sticks to the conversation
 * rather than to whatever happens to be open later.
 */
export function useConversation({
  threadId,
  applicationId = null,
  onStarted,
}: {
  threadId: NodeId | null
  /** For a conversation not started yet: the application it will be about and filed under. */
  applicationId?: string | null
  /** A first question minted the conversation; the surface now shows it. */
  onStarted: (id: NodeId) => void
}) {
  const { settings, reader } = useModelSettings()
  const { threads, create, save, setContext } = useThreads()
  const { byId } = useApplications()
  const configured = isConfigured(settings)

  const thread = threads.find((t) => t.id === threadId) ?? null
  const subjectId = thread ? thread.applicationId : applicationId
  const subject: Application | undefined = subjectId ? byId.get(subjectId) : undefined
  const focus = subject
    ? focusLine({ id: subject.id, org: subject.org, role: subject.role })
    : undefined

  /**
   * Built per RUN, so Stop cancels the request rather than only the loop. The
   * controller lives here because `AbortController` is a platform global the
   * shared layer may not name.
   */
  const llm = useCallback(
    (run: RunSignal) => {
      const controller = new AbortController()
      run.onAbort(() => {
        controller.abort()
      })
      return (
        messages: Parameters<typeof agentTurn>[1],
        tools: Parameters<typeof agentTurn>[2],
        onDelta?: (text: string) => void,
      ) => agentTurn(settings, messages, tools, controller.signal, onDelta)
    },
    [settings],
  )

  /** The tool chooser and the summariser: the same transport, much easier work. */
  const chooser = useMemo(
    () => ({ ask: (messages: readonly ChatMessage[]) => agentTurn(settings, messages, []) }),
    [settings],
  )

  const convert = useReadDocument()

  /**
   * Mints the conversation for a first question, before the run starts — so
   * the run is keyed by its conversation from its first token, and an
   * interrupted run leaves the question behind rather than nothing.
   */
  const startThread = useCallback(
    (asked: string) => {
      const made = create({
        title: asked,
        entries: [{ kind: 'you', text: asked }],
        ...(applicationId === null ? {} : { applicationId: applicationId as NodeId }),
      })
      if (!made.ok) return null
      onStarted(made.output)
      return made.output
    },
    [create, applicationId, onStarted],
  )

  /** Saved into the conversation the run was FOR, which the registry hands back. */
  const onSettled = useCallback(
    (id: NodeId, settled: readonly AgentEntry[]) => {
      save(id, toThreadEntries(settled))
    },
    [save],
  )

  const agent = useAgent({
    llm: configured ? llm : null,
    chooser,
    summariser: chooser,
    onSettled,
    startThread,
    window: contextOf(settings),
    ...(reader ? { convert } : {}),
    onCompacted: setContext,
    thread: {
      id: threadId,
      entries: thread ? toAgentEntries(thread.entries) : [],
      history: thread ? historyFor(thread.entries, thread.contextThrough).history : [],
      ...(thread?.context === undefined ? {} : { context: thread.context }),
      approval: thread?.approval ?? 'manual',
      ...(focus === undefined ? {} : { focus }),
    },
  })

  return { ...agent, thread, subject, configured, model: settings.model }
}
