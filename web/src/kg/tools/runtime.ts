/**
 * L3 — run / check / can / undo / redo / forNode. The only `catch` in the layer.
 *
 * `run` is five stages in about forty readable lines: parse -> available -> open
 * transaction -> run -> commit + journal + describe, or discard the buffer
 * entirely. A command bus with pluggable middleware buys nothing over that.
 *
 * An exception that is not a ToolFailure is a programmer error: the buffer is
 * discarded and it is RE-THROWN to the ErrorBoundary rather than laundered into a
 * user-facing message that hides a bug.
 *
 * The transaction buffer also serves the reads. `ctx.memory` is the committed
 * snapshot with this transaction's writes layered over it, because a composite
 * tool cannot see its own work otherwise: `application.create` mints an
 * organisation and then links to it, and against the committed snapshot alone
 * that link would point at a node that does not exist yet and fail EDGE_SCHEMA.
 *
 * The buffer itself is `runtime-buffer.ts`, reading it is `runtime-overlay.ts`
 * and writing it is `runtime-tx.ts`. What is left here is the five stages, the
 * nesting rules, and the one place a buffer becomes a journal entry.
 */

import type { EdgeId, Instant, NodeId, NodeType, StoredEdge, StoredNode } from '@/kg/core/model'
import { newNodeId, slugify, uniqueSlug } from '@/kg/core/ref'
import type { Parsed } from '@/kg/core/schema'
import type { RecordDelta } from '@/kg/repo/journal'
import type { Repository } from '@/kg/repo/repository'
import { TOOLS } from './index'
import type { InputOf, OutputOf, ToolName } from './index'
import { newBuffer, slugOf } from './runtime-buffer'
import type { Buffer } from './runtime-buffer'
import { overlay } from './runtime-overlay'
import { makeTx } from './runtime-tx'
import { ToolFailure, isToolFailure } from './tool'
import type { AnyTool, Announcement, Availability, ToolContext, ToolError } from './tool'

export type ChangeSet = {
  created: NodeId[]
  updated: NodeId[]
  deleted: NodeId[]
  edges: EdgeId[]
}

export type ToolResult<O> =
  | {
      ok: true
      output: O
      announcement: Announcement
      changed: ChangeSet
      journalId: string
      undo: (() => void) | null
    }
  | { ok: false; errors: readonly ToolError[] }

export interface ToolRuntime {
  run<N extends ToolName>(name: N, input: InputOf<N>): ToolResult<OutputOf<N>>
  /** Parse only. Lets a form validate on blur without touching memory. */
  check<N extends ToolName>(name: N, input: unknown): Parsed<InputOf<N>>
  can<N extends ToolName>(name: N, input?: Partial<InputOf<N>>): Availability
  /** Throws on failure. Seeding and imports only, where a failure is a bug. */
  runOrThrow<N extends ToolName>(name: N, input: InputOf<N>): OutputOf<N>
  undo(): ToolResult<void>
  redo(): ToolResult<void>
  /** Tools whose `touches` includes this node's type and whose `available` says yes. */
  forNode(id: NodeId): readonly AnyTool[]
}

/** Deep enough that no honest composite reaches it, shallow enough to stop a runaway. */
const MAX_DEPTH = 8

/**
 * `InputOf<N>` stays deferred while `N` is generic, so it reads as `unknown` and
 * will not pass through `AnyTool`'s erased `available` signature. The tool's own
 * declaration is what type-checks its `available`; this is only the crossing.
 */
const asPartial = (input: unknown) => input as Parameters<NonNullable<AnyTool['available']>>[1]

/* -------------------------------- the runtime ------------------------------ */

export function createToolRuntime(deps: { repo: Repository; now: () => Instant }): ToolRuntime {
  const { repo, now } = deps

  const toolOf = (name: ToolName): AnyTool => TOOLS[name]

  const errorsOf = (parsed: Parsed<unknown>): readonly ToolError[] =>
    parsed.ok
      ? []
      : parsed.issues.map((i) => ({ message: i.message, ...(i.path ? { field: i.path } : {}) }))

  function makeContext(buf: Buffer, stack: ToolName[], instant: Instant): ToolContext {
    const read = () => overlay(repo.getSnapshot(), buf)

    const fail: ToolContext['fail'] = (message, opts) => {
      throw new ToolFailure([{ message, ...opts }])
    }

    const tx = makeTx(read, buf, instant, fail)

    return {
      get memory() {
        return read()
      },
      tx,
      now: instant,
      fail,

      call(name, input) {
        buf.calls.push(name)
        return execute(name, input, buf, stack, instant)
      },

      require<T extends NodeType>(type: T, id: NodeId) {
        const node = read().node(id, type)
        if (!node) fail('That record is no longer here.', { code: 'graph/not-found' })
        return node
      },

      mintSlug(type: NodeType, base: string) {
        const taken = read()
          .ofType(type)
          .map((n) => slugOf(n) ?? '')
        // The pending set matters: two files dropped in one gesture both call
        // this before either is attached to a node, and without it both take the
        // same slug — the bug `FilesTool.tsx:198-221` works around by hand.
        const slug = uniqueSlug(slugify(base) || type, [...taken, ...buf.minted])
        buf.minted.add(slug)
        return slug
      },

      // The transaction's own instant, never `Date.now()`. An id minted off the
      // wall clock while `updatedAt` is stamped from `ctx.now` produces a record
      // whose id and timestamp disagree, and ids are what `ofType` sorts by.
      newId: (type: NodeType) => newNodeId(type, Date.parse(instant)),
    }
  }

  /**
   * One transaction, however many tools deep.
   *
   * Nested `ctx.call` reuses this buffer and this instant, so "create an
   * application with a deadline and two keywords" is one commit, one journal row
   * and one Undo — rather than four toasts and an undo that puts back a third of
   * what the user just did.
   */
  function execute<N extends ToolName>(
    name: N,
    input: InputOf<N>,
    buf: Buffer,
    stack: ToolName[],
    instant: Instant,
  ): OutputOf<N> {
    const tool = toolOf(name)

    if (stack.includes(name)) {
      throw new ToolFailure([{ message: `${tool.title} called itself.`, code: 'graph/invariant' }])
    }
    if (stack.length >= MAX_DEPTH) {
      throw new ToolFailure([{ message: 'Too many nested operations.', code: 'graph/invariant' }])
    }

    const parsed = tool.input.parse(input) as Parsed<InputOf<N>>
    if (!parsed.ok) throw new ToolFailure(errorsOf(parsed))

    const ctx = makeContext(buf, [...stack, name], instant)
    const available = tool.available?.(ctx.memory, asPartial(parsed.value))
    if (available && !available.ok) {
      throw new ToolFailure([{ message: available.reason, code: 'tool/refused' }])
    }

    return tool.run(ctx, parsed.value) as OutputOf<N>
  }

  function deltas(buf: Buffer) {
    const nodes: RecordDelta<StoredNode>[] = []
    const edges: RecordDelta<StoredEdge>[] = []
    const changed: ChangeSet = { created: [], updated: [], deleted: [], edges: [] }

    for (const [id, cell] of buf.nodes) {
      // Created and deleted inside the same transaction: nothing to persist and
      // nothing to undo, so it must not reach the journal as a phantom row.
      if (cell.before === null && cell.after === null) continue
      nodes.push({ id, before: cell.before, after: cell.after })
      if (cell.before === null) changed.created.push(id)
      else if (cell.after === null) changed.deleted.push(id)
      else changed.updated.push(id)
    }

    for (const [id, cell] of buf.edges) {
      if (cell.before === null && cell.after === null) continue
      edges.push({ id, before: cell.before, after: cell.after })
      changed.edges.push(id)
    }

    return { nodes, edges, changed }
  }

  /**
   * Undo and redo are the same call against a different ring.
   *
   * `repo.revert` is itself a commit, so the entry it writes is the one redo
   * reverts — there is no second code path and no inverse-of-an-inverse to get
   * wrong.
   */
  function step(dir: 'undo' | 'redo'): ToolResult<void> {
    // `undoable` and `redoable` read NEWEST FIRST — the order the Undo menu and
    // the audit log render in (`journal.ts:169`). Taking the last entry undid
    // the oldest write in the session instead of the one just made.
    const ring = dir === 'undo' ? repo.undoable : repo.redoable
    const target = ring[0]
    if (!target) {
      return { ok: false, errors: [{ message: `Nothing to ${dir}.`, code: 'tool/refused' }] }
    }

    const entry = repo.revert(target.id)
    const changed: ChangeSet = { created: [], updated: [], deleted: [], edges: [] }
    for (const d of entry.nodes) {
      if (d.before === null) changed.created.push(d.id)
      else if (d.after === null) changed.deleted.push(d.id)
      else changed.updated.push(d.id)
    }
    for (const d of entry.edges) changed.edges.push(d.id)

    return {
      ok: true,
      output: undefined,
      announcement: { title: dir === 'undo' ? 'Undone' : 'Redone', description: target.label },
      changed,
      journalId: entry.id,
      undo: null,
    }
  }

  const runtime: ToolRuntime = {
    run<N extends ToolName>(name: N, input: InputOf<N>): ToolResult<OutputOf<N>> {
      const tool = toolOf(name)
      const buf = newBuffer()
      const instant = now()

      let output: OutputOf<N>
      try {
        output = execute(name, input, buf, [], instant)
      } catch (e) {
        // The buffer is discarded either way; the difference is who hears about
        // it. A ToolFailure is a refusal the user can act on. Anything else is a
        // bug, and a bug that arrives as a polite toast is a bug that ships.
        if (isToolFailure(e)) return { ok: false, errors: e.errors }
        throw e
      }

      const { nodes, edges, changed } = deltas(buf)
      // The OVERLAY, not the committed snapshot: `describe` for a create has to
      // name the record that was just made, and the commit has not happened yet.
      // Reordering so the commit ran first is not open either — the commit needs
      // the label that `describe` returns.
      const announcement = tool.describe(input, output, overlay(repo.getSnapshot(), buf))

      const entry = repo.commit({
        tool: name,
        input,
        label: announcement.title,
        calls: buf.calls,
        nodes,
        edges,
      })

      // `undoable: false` is enforced on the STACK, not on the journal.
      // `repo.commit` is the only path from a transaction buffer to the durable
      // op list (D19), so an admin tool has to go through it — and after a reset
      // no earlier before-image is safe to replay anyway, which is the same
      // reason a remote commit clears the stack (D23).
      const undoable = tool.undoable !== false
      if (!undoable) repo.clearHistory()

      return {
        ok: true,
        output,
        announcement,
        changed,
        journalId: entry.id,
        undo: undoable ? () => void repo.revert(entry.id) : null,
      }
    },

    check: <N extends ToolName>(name: N, input: unknown) =>
      toolOf(name).input.parse(input) as Parsed<InputOf<N>>,

    can<N extends ToolName>(name: N, input?: Partial<InputOf<N>>) {
      return toolOf(name).available?.(repo.getSnapshot(), asPartial(input)) ?? { ok: true }
    },

    runOrThrow<N extends ToolName>(name: N, input: InputOf<N>) {
      const result = runtime.run(name, input)
      if (!result.ok) throw new ToolFailure(result.errors)
      return result.output
    },

    undo: () => step('undo'),
    redo: () => step('redo'),

    forNode(id: NodeId) {
      const memory = repo.getSnapshot()
      const node = memory.node(id)
      if (!node) return []
      const tools: AnyTool[] = Object.values(TOOLS)
      return tools.filter(
        (t) =>
          t.internal !== true &&
          t.touches.includes(node.type) &&
          (t.available?.(memory, undefined) ?? { ok: true }).ok,
      )
    },
  }

  return runtime
}
