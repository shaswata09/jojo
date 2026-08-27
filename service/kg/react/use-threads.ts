import { useCallback, useMemo } from 'react'
import type { ChatMessage } from '../core/model-server'
import type { ApprovalMode, NodeId, StoredNode, ThreadEntry } from '../core/model'
import { approvalOf } from '../core/model'
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
  /** How much this conversation may do without being asked. */
  approval: ApprovalMode
  /**
   * What a compaction established, and how many entries it covers.
   *
   * Absent on almost every conversation — only one that outgrew the model's
   * window has ever been compacted. See `ThreadProps.context`.
   */
  context?: string
  contextThrough: number
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
          approval: approvalOf(node.props),
          ...(node.props.context === undefined ? {} : { context: node.props.context }),
          // Zero, not undefined: every caller slices with it, and a default of
          // zero means "nothing summarised yet" without a check at each site.
          contextThrough: node.props.contextThrough ?? 0,
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

  /** Sets how much one conversation may do unasked. See `ThreadProps.approval`. */
  const setApproval = useCallback(
    (id: NodeId, mode: ApprovalMode) => runtime.run('assistant.thread.auto.set', { id, mode }),
    [runtime],
  )

  /**
   * Remember what a compacted conversation established.
   *
   * `throughMessages` is what the loop counted; `entriesForMessages` turns it
   * into a count of entries, because that is what a thread stores and the two
   * are not one-to-one. It rounds down, so the boundary never claims more than
   * the summary actually saw.
   */
  const setContext = useCallback(
    (id: NodeId, context: string, throughMessages: number) => {
      const thread = threads.find((t) => t.id === id)
      if (!thread) return
      const through = nextContextThrough(thread.entries, thread.contextThrough, throughMessages)
      return runtime.run('assistant.thread.context.set', { id, context, through })
    },
    [runtime, threads],
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

  return { threads, create, save, rename, file, remove, setApproval, setContext }
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
    // `app` carried, not rebuilt away. It is what stops `toTranscript` replaying
    // this app's own words to the model as the model's; see `ThreadEntry`.
    if (e.kind === 'note') {
      return { kind: 'note', id, text: e.text, ...(e.app === true ? { app: true as const } : {}) }
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
      : e.kind === 'note'
        ? // The other half of the same carry. This is the one that was losing
          // it: a live run holds `app` on the entry, and rebuilding the note
          // from `kind` and `text` alone is what made the flag survive exactly
          // until the conversation was saved — which is to say, never.
          { kind: 'note', text: e.text, ...(e.app === true ? { app: true as const } : {}) }
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
      /*
       * An APP note is not replayed. It is this app talking to the person —
       * "this conversation was trimmed", "the model hit its output limit" — and
       * the model never said it. Replaying it as assistant speech puts words in
       * its mouth that it will then reason from, and spends context doing it.
       *
       * The person still sees it: it stays in the transcript, it just does not
       * go back to the model.
       */
      if (entry.kind === 'note' && entry.app === true) {
        i += 1
        continue
      }
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

/**
 * How many ENTRIES produce at most `messages` transcript messages.
 *
 * The loop compacts in messages and a thread stores entries, and the two are
 * not one-to-one: a run of consecutive `step` entries collapses into a single
 * assistant turn plus one `tool` message each. So the translation belongs
 * here, beside the walk that creates the mismatch, rather than being
 * approximated by whoever needs it.
 *
 * Rounds DOWN — it returns a boundary at or before `messages`, never past it.
 * Overshooting would mark entries as summarised that the summary never saw,
 * and those exchanges would then be dropped from the next turn's history with
 * nothing standing in for them.
 */
export function entriesForMessages(
  entries: readonly ThreadEntry[],
  messages: number,
): number {
  if (messages <= 0) return 0
  let count = 0
  for (let i = 1; i <= entries.length; i += 1) {
    const produced = toTranscript(entries.slice(0, i)).length
    if (produced > messages) return count
    count = i
  }
  return entries.length
}

/**
 * Where a summary now reaches, given where the last one did.
 *
 * The loop counts MESSAGES, and the messages it counted were made from
 * `entries.slice(contextThrough)` — not from the whole thread. So the new
 * boundary is the old one PLUS however many of the remaining entries those
 * messages cover.
 *
 * Measuring against the full list instead moved the boundary BACKWARDS on every
 * compaction after the first: a thread summarised through entry 6 that then
 * dropped 4 more messages stored `contextThrough: 4`, un-covering two entries
 * the summary had already replaced — so they were sent again, beside a summary
 * that already contained them.
 *
 * Extracted from the hook because that is the only way it can be tested: a hook
 * cannot be mounted here (D20), and arithmetic nobody can run is arithmetic
 * nobody has checked.
 */
export function nextContextThrough(
  entries: readonly ThreadEntry[],
  from: number,
  throughMessages: number,
): number {
  const start = Math.max(0, Math.min(from, entries.length))
  return start + entriesForMessages(entries.slice(start), throughMessages)
}
