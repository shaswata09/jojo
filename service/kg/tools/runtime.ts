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

import type { EdgeId, Instant, NodeId, NodeType, StoredEdge, StoredNode } from '../core/model'
import { newNodeId, slugify, uniqueSlug } from '../core/ref'
import type { Parsed } from '../core/schema'
import type { RecordDelta } from '../repo/journal'
import type { Repository } from '../repo/repository'
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
        // same slug — one row with one keyword set that a single delete took out
        // together. `sortDrop` in `components/vault/files/intake.ts` used to work
        // that around by predicting this slug with a second copy of `slugify`;
        // the prediction is gone and it now dedupes on the folded name alone.
        //
        // Scoped to the type, like the `taken` read above it. It was one flat
        // set across the whole transaction, and `application.create` is a
        // composite: `org.ensure` minted 'rice' first, so the application landed
        // on 'rice-2' and `/applications/rice-2` was the address of the FIRST
        // job at a new employer. Slugs are unique per [type, slug], so the
        // collision it was avoiding did not exist.
        let pending = buf.minted.get(type)
        if (!pending) {
          pending = new Set<string>()
          buf.minted.set(type, pending)
        }
        const slug = uniqueSlug(slugify(base) || type, [...taken, ...pending, ...reserved(type)])
        pending.add(slug)
        return slug
      },

      // The transaction's own instant, never `Date.now()`. An id minted off the
      // wall clock while `updatedAt` is stamped from `ctx.now` produces a record
      // whose id and timestamp disagree, and ids are what `ofType` sorts by.
      newId: (type: NodeType) => newNodeId(type, Date.parse(instant)),
    }
  }

  /**
   * Slugs no node holds RIGHT NOW, but that an undo would put back.
   *
   * `mintSlug` read only the live graph, and a slug is freed the instant its
   * record is deleted — while the delete stays revertable for the whole undo
   * window, and the toast that announces it is holding a live `revert` handle
   * on that exact entry. Measured: create Rice ('rice'), delete it, create a
   * second Rice — which minted 'rice' again — then press Undo on the delete
   * toast. Two applications, both `slug: 'rice'`, and `bySlug('application',
   * 'rice')` answers with the restored one, so `/applications/rice` opens the
   * old record and the one just created cannot be reached by URL at all. Slug
   * uniqueness per [type, slug] is what routing rests on, and undo is the only
   * safety net in an app with no server copy — the two must not be able to
   * cancel each other out.
   *
   * Every non-null `before` image, not only the deletes: an undo replays
   * `before`, so that IS the set of records an undo can resurrect. Images whose
   * node is still live cost nothing — their slug is already in `taken`.
   *
   * THE REDO RING IS DELIBERATELY NOT HERE. Reserving from it would be wrong in
   * the other direction: `repo.commit` clears redo for any entry that changes
   * something, and a transaction that mints a slug always changes something, so
   * this very commit destroys the future those images described. Reserving them
   * would hold slugs against a redo that can no longer happen.
   *
   * Bounded by `UNDO_DEPTH` (50 entries), walked once per minted slug. The
   * audit ring reaches 200, but its UI offers Undo on the top row only — which
   * is the undo ring's top row.
   */
  function reserved(type: NodeType): string[] {
    const slugs: string[] = []
    for (const entry of repo.undoable) {
      for (const delta of entry.nodes) {
        const image = delta.before
        if (image === null || image.type !== type) continue
        const slug = slugOf(image)
        if (slug !== undefined) slugs.push(slug)
      }
    }
    return slugs
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
   * The transaction as `describe` has to read it: everything applied, except
   * that the nodes it DELETED are still readable.
   *
   * `describe` runs after `execute`, so on the plain overlay `m.node(id)`
   * answers `undefined` for anything `tx.del` staged and all thirteen delete
   * tools fell through to the fallback inside their own `describe` —
   * *"Keyword deleted"*, *"Item deleted"*, *"Application deleted"*. That string
   * is also the journal LABEL, so clearing three keywords wrote three
   * indistinguishable audit rows and an Undo menu with nothing in it to say
   * which record is about to come back.
   *
   * Only deletions are rewound, and among edges only the ones `dropIncident`
   * took along with a node that is going. Putting back EVERY staged edge would
   * be simpler and wrong: `scout.posting.update` with `applicationId: null` cuts
   * BECAME and keeps the posting, so a describe reading through that edge would
   * announce the link the user just severed as though it were still there. And
   * a node created AND deleted inside one transaction has no earlier image at
   * all — there was never anything to name.
   */
  function forDescribe(buf: Buffer): Buffer {
    const nodes = new Map(buf.nodes)
    const edges = new Map(buf.edges)
    const gone = new Set<NodeId>()

    for (const [id, cell] of nodes) {
      if (cell.after === null && cell.before !== null) {
        nodes.set(id, { before: cell.before, after: cell.before })
        gone.add(id)
      }
    }

    // The edges matter as much as the node: `displayOf` names an application by
    // walking AT to its employer, and with the node back but the edge still
    // staged as a delete `application.delete` announced *" — Statistics"*, a
    // dangling separator where the employer should be.
    for (const [id, cell] of edges) {
      const e = cell.before
      if (cell.after === null && e !== null && (gone.has(e.from) || gone.has(e.to))) {
        edges.set(id, { before: e, after: e })
      }
    }

    // `minted` and `calls` are shared rather than copied: this view is read
    // once, by `describe`, and neither is a read path.
    return { ...buf, nodes, edges }
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
    // the audit log render in (`Ring.entries` in `kg/repo/journal.ts`). Taking
    // the last entry undid
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
      //
      // `forDescribe` and not the raw buffer, because the same argument runs the
      // other way for a delete: the record it has to name is one this
      // transaction has already staged as gone.
      const seen = overlay(repo.getSnapshot(), forDescribe(buf))
      const announcement = tool.describe(input, output, seen)

      // `undoable: false` is enforced on the STACK, not on the journal.
      // `repo.commit` is the only path from a transaction buffer to the durable
      // op list (D19), so the write still has to go through it.
      const undoable = tool.undoable !== false

      // `stack: false` is what "not undoable" should always have meant: journal
      // and audit the write, leave the user's undo ring alone.
      //
      // IT USED TO BE `clearHistory()` FOR EVERY SUCH TOOL, which is right for
      // an admin tool and catastrophic for the other one that carries the flag.
      // `assistant.thread.set` is `effect: 'update'` and the app commits it
      // after EVERY exchange with the assistant — so asking one question wiped
      // the undo AND redo stacks, and every hand-made edit earlier in the
      // session became unreachable by ⌘Z. In an app with no server copy, undo
      // is the safety net.
      //
      // Only an admin tool invalidates the stack, and it invalidates it for a
      // reason that is about the DATA rather than about the flag: after a reset
      // or a clear, no earlier before-image is safe to replay, which is the same
      // reason a remote commit clears the stack (D23).
      const entry = repo.commit(
        {
          tool: name,
          input,
          label: announcement.title,
          calls: buf.calls,
          nodes,
          edges,
        },
        undoable && tool.system !== true ? undefined : { stack: false },
      )

      if (!undoable && tool.effect === 'admin') repo.clearHistory()

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
