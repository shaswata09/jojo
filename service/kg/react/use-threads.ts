import { useCallback, useMemo } from 'react'
import type { ChatMessage } from '../core/model-server'
import type { NodeId, StoredNode, ThreadEntry } from '../core/model'
import { toWireName } from '../agent/catalog'
import type { AgentEntry } from './use-agent'
import { useGraph, useKg } from './kg-context'

/**
 * L4 — the conversations, for a screen.
 *
 * The store is the graph, so this is thin by design: no cache, no local copy,
 * no second source of truth. `useGraph` re-reads on every commit, so a thread
 * saved in one tab is in the list in the other without anything here knowing
 * that tabs exist.
 *
 * WHAT IT OWNS THAT NOTHING ELSE DOES is the two readings of a stored thread.
 * A conversation is kept once, as the turns a person reads; the model needs the
 * same conversation as OpenAI messages, with `tool_calls` and their results
 * paired by id. `toTranscript` derives the second from the first, so continuing
 * an old thread and reading it are the same data — rather than two stored
 * shapes kept in step by hand, which drift only in old threads nobody reopens.
 */

export type Thread = {
  id: NodeId
  title: string
  entries: ThreadEntry[]
  /** The application it is filed under, if any. */
  applicationId: NodeId | null
  /** The agent may write in this conversation without asking first. */
  autoApprove: boolean
  updatedAt: string
}

/**
 * The turns that are actually turns.
 *
 * `validate.ts` checks `entries` as an array and not as entries, for the reason
 * written there: a transcript is append-only history, and a strict schema means
 * a thread written by a newer build is DROPPED by an older one. This is the
 * other half of that bargain — the reader is where junk stops, and it stops by
 * being left out rather than by throwing.
 */
const KINDS = new Set(['you', 'note', 'answer', 'error', 'step'])

const entriesOf = (node: StoredNode<'thread'>): ThreadEntry[] =>
  node.props.entries.filter(
    (e): e is ThreadEntry =>
      typeof e === 'object' && e !== null && KINDS.has((e as { kind?: unknown }).kind as string),
  )

export function useThreads() {
  const graph = useGraph()
  const { runtime } = useKg()

  const threads = useMemo<Thread[]>(
    () =>
      graph
        .ofType('thread')
        .map((node) => ({
          id: node.id,
          title: node.props.title,
          entries: entriesOf(node),
          applicationId: graph.one(node.id, 'FILED_UNDER', 'application')?.id ?? null,
          autoApprove: node.props.autoApprove === true,
          updatedAt: node.updatedAt,
        }))
        // Most recently touched first: a list of conversations is read like an
        // inbox, and the one you were just in is the one you want back.
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [graph],
  )

  const create = useCallback(
    (opts: { title?: string; applicationId?: NodeId; entries?: readonly ThreadEntry[] } = {}) =>
      runtime.run('assistant.thread.create', {
        ...(opts.title === undefined ? {} : { title: opts.title }),
        ...(opts.applicationId === undefined ? {} : { applicationId: opts.applicationId }),
        // The first exchange goes in with the record, so a conversation is never
        // stored empty and then filled — one commit, one row in the journal.
        ...(opts.entries === undefined ? {} : { entries: [...opts.entries] }),
      }),
    [runtime],
  )

  /** Turns asking on or off for one conversation. See `ThreadProps.autoApprove`. */
  const setAuto = useCallback(
    (id: NodeId, auto: boolean) => runtime.run('assistant.thread.auto.set', { id, auto }),
    [runtime],
  )

  const save = useCallback(
    (id: NodeId, entries: readonly ThreadEntry[]) =>
      runtime.run('assistant.thread.set', { id, entries: [...entries] }),
    [runtime],
  )

  const rename = useCallback(
    (id: NodeId, title: string) => runtime.run('assistant.thread.rename', { id, title }),
    [runtime],
  )

  const file = useCallback(
    (id: NodeId, applicationId: NodeId | null) =>
      runtime.run('assistant.thread.file', { id, applicationId }),
    [runtime],
  )

  const remove = useCallback(
    (id: NodeId) => runtime.run('assistant.thread.delete', { id }),
    [runtime],
  )

  return { threads, create, save, rename, file, remove, setAuto }
}

/* ------------------------------ the two readings --------------------------- */

/** What the screen renders, from what was stored. */
export const toAgentEntries = (entries: readonly ThreadEntry[]): AgentEntry[] =>
  entries.map((e, i) => {
    const id = `t${String(i)}`
    if (e.kind === 'step') {
      return {
        kind: 'step',
        id,
        step: {
          id,
          name: e.tool,
          title: e.title,
          effect: e.effect as never,
          destructive: false,
          args: e.args,
          status: e.status,
          ...(e.detail === undefined ? {} : { detail: e.detail }),
          // No `undo`: a closure cannot survive a reload, and the journal is
          // what takes an agent's writes back after the conversation is closed.
        },
      }
    }
    return { kind: e.kind, id, text: e.text }
  })

/** What a screen just did, in the shape that is stored. */
export const toThreadEntries = (entries: readonly AgentEntry[]): ThreadEntry[] =>
  entries.map((e) =>
    e.kind === 'step'
      ? {
          kind: 'step',
          tool: e.step.name,
          title: e.step.title,
          effect: e.step.effect,
          args: e.step.args,
          // `running` never reaches storage: an exchange is saved once it has
          // settled, and a step frozen mid-flight would read as a hang forever.
          status: e.step.status === 'running' ? 'failed' : e.step.status,
          ...(e.step.detail === undefined ? {} : { detail: e.step.detail }),
        }
      : { kind: e.kind, text: e.text },
  )

/**
 * The same conversation as OpenAI messages, for continuing it.
 *
 * The pairing is the whole job. A server rejects a `tool` message whose
 * `tool_call_id` has no preceding assistant turn asking for it, so each stored
 * step becomes BOTH halves — an assistant turn carrying the call, and the tool
 * turn carrying what it returned — with an id minted from the step's position.
 * Deterministic rather than random, so re-deriving the same thread twice
 * produces the same transcript.
 *
 * Consecutive steps collapse into one assistant turn with several `tool_calls`,
 * because that is how they arrived and a server that sees them split may answer
 * the wrong one.
 */
export function toTranscript(entries: readonly ThreadEntry[]): ChatMessage[] {
  const out: ChatMessage[] = []
  let i = 0
  while (i < entries.length) {
    const entry = entries[i]
    if (!entry) break
    if (entry.kind === 'you') {
      out.push({ role: 'user', content: entry.text })
      i += 1
      continue
    }
    if (entry.kind === 'answer' || entry.kind === 'note') {
      out.push({ role: 'assistant', content: entry.text })
      i += 1
      continue
    }
    if (entry.kind === 'error') {
      // The model's own failure, told back to it as an observation rather than
      // as something it said. An assistant turn reading "Nothing answered" is a
      // sentence it will helpfully repeat.
      out.push({ role: 'user', content: `[The previous attempt failed: ${entry.text}]` })
      i += 1
      continue
    }
    const run: { entry: Extract<ThreadEntry, { kind: 'step' }>; id: string }[] = []
    while (i < entries.length) {
      const step = entries[i]
      if (!step || step.kind !== 'step') break
      run.push({ entry: step, id: `call_${String(i)}` })
      i += 1
    }
    out.push({
      role: 'assistant',
      content: null,
      tool_calls: run.map((r) => ({
        id: r.id,
        type: 'function' as const,
        function: { name: toWireName(r.entry.tool), arguments: JSON.stringify(r.entry.args ?? {}) },
      })),
    })
    for (const r of run) {
      out.push({ role: 'tool', tool_call_id: r.id, content: r.entry.detail ?? 'Done.' })
    }
  }
  return out
}
