/**
 * L3 — the conversations, as records.
 *
 * A thread is a node and its turns are a prop on it, rather than a node per
 * message with an edge back. The trade is deliberate: a message has no identity
 * anybody refers to — nothing links to "the fourth thing I said" — so a node per
 * turn would multiply the store by the length of every conversation to buy an
 * addressability nothing uses. `core/model.ts` states the rule this follows: a
 * value earns a node iff the user can rename or annotate it, and a turn is
 * neither renamed nor annotated.
 *
 * What that costs is that appending rewrites the node. On IndexedDB that is one
 * row; on AsyncStorage `rn-driver.ts` rewrites the whole document for any commit
 * at all, so the marginal cost of a long thread is the thread's own bytes and
 * nothing more. The measurement that would change this is a conversation long
 * enough for its own serialisation to be felt, and `TURN_CAP` below is what
 * stops one existing.
 */

import { s } from '../core/schema'
import type { NodeId, ThreadEntry } from '../core/model'
import { defineTool } from './tool'

/**
 * The most turns a thread keeps.
 *
 * Not a limit anybody should meet: two hundred turns is a conversation nobody
 * has had with a job tracker. It exists because the alternative to a cap is an
 * unbounded prop on a node the whole store is rewritten for, and a bound nobody
 * reaches is cheaper than the day somebody does. The OLDEST go, because a
 * conversation is read from the bottom.
 */
const TURN_CAP = 200

/** Untitled threads take their name from the first thing said, trimmed short. */
const TITLE_MAX = 60

export const titleFor = (text: string) => {
  const clean = text.trim().replace(/\s+/g, ' ')
  if (clean.length === 0) return 'New conversation'
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1)}…` : clean
}

/**
 * The turns, as opaque values.
 *
 * `s.unknown()` for the same reason `validate.ts` uses it for the stored prop —
 * `ThreadEntry` is a union of five shapes and `core/schema.ts` has no union
 * combinator, deliberately, because `FieldMeta` must stay drawable as a form.
 * The typed surface is `useThreads`, which is the only thing that builds these.
 */
const entries = s.array(s.unknown(), { label: 'Messages' })

const threadId = s.id('thread', { label: 'Conversation' })

export const threadCreate = defineTool({
  name: 'assistant.thread.create',
  title: 'Start a conversation',
  summary: 'Opens a new conversation with the assistant, kept on this device.',
  effect: 'create',
  touches: ['thread'],
  input: s.object({
    title: s.optional(s.string({ label: 'Title' })),
    entries: s.optional(entries),
    applicationId: s.optional(s.id('application', { label: 'Application' })),
  }),
  run(ctx, input): NodeId {
    const id = ctx.newId('thread')
    const title = titleFor(input.title ?? '')
    ctx.tx.put({
      id,
      type: 'thread',
      props: {
        slug: ctx.mintSlug('thread', title),
        title,
        entries: (input.entries ?? []) as ThreadEntry[],
      },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    if (input.applicationId) {
      ctx.require('application', input.applicationId)
      ctx.tx.link(id, 'FILED_UNDER', input.applicationId)
    }
    return id
  },
  describe: () => ({ title: 'Conversation started' }),
})

/**
 * Replaces the turns wholesale.
 *
 * Set, not append, and the difference matters for undo. A turn arrives as the
 * last of several the agent produced in one exchange — a note, three tool steps,
 * an answer — and an append-per-turn would write six journal rows for one thing
 * the user did. One write per exchange is one undo, which is the contract
 * `tool.ts` opens with.
 */
export const threadSet = defineTool({
  name: 'assistant.thread.set',
  title: 'Save the conversation',
  summary:
    'Records what has been said in a conversation so far. The app calls this as the conversation happens — you never need to, and calling it would rewrite the record of what you did.',
  effect: 'update',
  touches: ['thread'],
  // Kept off the undo stack. A conversation saving itself as you talk is not an
  // action anybody undoes, and an undo entry per exchange would bury the writes
  // the agent made INSIDE that exchange — which are the ones worth taking back.
  //
  // It IS journalled and audited: the write goes through `repo.commit` like
  // every other, and `undoable: false` now resolves to `{ stack: false }` there.
  // It used to resolve to `clearHistory()`, which meant asking one question
  // emptied the undo and redo stacks outright — see the note in `runtime.ts`.
  undoable: false,
  input: s.object({ id: threadId, entries }),
  run(ctx, input): void {
    ctx.require('thread', input.id)
    const kept = input.entries.slice(-TURN_CAP) as ThreadEntry[]
    ctx.tx.patch<'thread'>(input.id, { entries: kept })
  },
  describe: () => ({ title: 'Conversation saved' }),
})

export const threadRename = defineTool({
  name: 'assistant.thread.rename',
  title: 'Rename conversation',
  summary: 'Changes what a conversation is called in the list.',
  effect: 'update',
  touches: ['thread'],
  input: s.object({ id: threadId, title: s.string({ min: 1, label: 'Title' }) }),
  run(ctx, input): void {
    ctx.require('thread', input.id)
    ctx.tx.patch<'thread'>(input.id, { title: titleFor(input.title) })
  },
  describe: (input) => ({ title: 'Renamed', description: titleFor(input.title) }),
})

/**
 * Files a conversation under an application, or unfiles it.
 *
 * `null` unfiles. The same contract `vault.file.move` uses for the same edge,
 * and the same reason: absent means "leave it alone", which is what a patch of
 * one other field has to mean.
 */
export const threadFile = defineTool({
  name: 'assistant.thread.file',
  title: 'File conversation under a job',
  summary: 'Attaches a conversation to an application, or detaches it.',
  effect: 'move',
  touches: ['thread'],
  input: s.object({
    id: threadId,
    applicationId: s.nullable(s.id('application', { label: 'Application' })),
  }),
  run(ctx, input): void {
    ctx.require('thread', input.id)
    ctx.tx.unlinkAll(input.id, { rel: 'FILED_UNDER' })
    if (input.applicationId !== null) {
      ctx.require('application', input.applicationId)
      ctx.tx.link(input.id, 'FILED_UNDER', input.applicationId)
    }
  },
  describe: (input) => ({
    title: input.applicationId === null ? 'Unfiled' : 'Filed under the application',
  }),
})

/**
 * Lets the agent write in this conversation without stopping to ask.
 *
 * A conversation-level permission, not a global one — the granularity people
 * actually want is "this one is a cleanup session". It is the same shape as
 * `scout.pipeline.update`'s `auto`, including the part that matters: the tool
 * only records the preference, and the GATE is at the point of use, in the
 * agent loop. A tool that tried to enforce it would still be one commit away
 * from a graph that disagreed with it.
 *
 * Deliberately undoable and journalled like any other edit. Turning it on is a
 * decision worth being able to see and take back.
 */
export const threadAutoSet = defineTool({
  name: 'assistant.thread.auto.set',
  title: 'Act without asking',
  summary: 'Lets the assistant make changes in this conversation without asking first.',
  effect: 'update',
  touches: ['thread'],
  input: s.object({
    id: threadId,
    auto: s.boolean({ label: 'Act without asking' }),
  }),
  run(ctx, input): void {
    ctx.require('thread', input.id)
    ctx.tx.patch<'thread'>(input.id, { autoApprove: input.auto })
  },
  describe: (input) => ({
    title: input.auto ? 'Acting without asking' : 'Asking before each change',
    description: input.auto
      ? 'Changes in this conversation happen straight away.'
      : 'You will be asked before each change.',
  }),
})

export const threadDelete = defineTool({
  name: 'assistant.thread.delete',
  title: 'Delete conversation',
  summary: 'Removes a conversation and everything said in it.',
  effect: 'delete',
  touches: ['thread'],
  input: s.object({ id: threadId }),
  run(ctx, input): void {
    ctx.require('thread', input.id)
    ctx.tx.del(input.id)
  },
  describe: () => ({ title: 'Conversation deleted', tone: 'danger' }),
})
