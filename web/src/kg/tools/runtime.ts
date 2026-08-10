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
 */

import { EDGE_SCHEMA } from '@/kg/core/model'
import type {
  EdgeId,
  Instant,
  NodeId,
  NodeType,
  Props,
  Rel,
  StoredEdge,
  StoredNode,
} from '@/kg/core/model'
import { edgeId, foldName, newNodeId, slugify, uniqueSlug } from '@/kg/core/ref'
import type { Parsed } from '@/kg/core/schema'
import type { GraphSnapshot } from '@/kg/core/snapshot'
import type { RecordDelta } from '@/kg/repo/journal'
import type { Repository } from '@/kg/repo/repository'
import { TOOLS } from './index'
import type { InputOf, OutputOf, ToolName } from './index'
import { ToolFailure, isToolFailure } from './tool'
import type {
  AnyTool,
  Announcement,
  Availability,
  PropsPatch,
  ToolContext,
  ToolError,
  Tx,
} from './tool'

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

/* -------------------------------- the buffer ------------------------------- */

type Cell<T> = { before: T | null; after: T | null }

/**
 * Every write the transaction has made, as before/after pairs.
 *
 * D12: the journal is images, not inverse commands. An inverse `create` mints a
 * new id and orphans every edge that pointed at the old one, and an inverse of
 * `application.delete` would have to know about six collections it never named.
 * Capturing both images at the moment of the write means undo is one generic
 * function and the 42 hand-written undo closures collapse to zero.
 */
type Buffer = {
  nodes: Map<NodeId, Cell<StoredNode>>
  edges: Map<EdgeId, Cell<StoredEdge>>
  /** Slugs handed out by `mintSlug` but not yet attached to a node. */
  minted: Set<string>
  calls: ToolName[]
}

const newBuffer = (): Buffer => ({
  nodes: new Map(),
  edges: new Map(),
  minted: new Set(),
  calls: [],
})

/**
 * Stages one write.
 *
 * The `before` image is recorded once and never overwritten. A node written
 * twice in one transaction — `application.stage.advance` patches the stage and
 * then the dates — must undo to what it was before the transaction opened, not
 * to what it was halfway through it.
 */
function stage<T>(cells: Map<string, Cell<T>>, key: string, before: T | null, after: T | null) {
  const existing = cells.get(key)
  if (existing) existing.after = after
  else cells.set(key, { before, after })
}

const slugOf = (n: StoredNode): string | undefined => (n.props as { slug?: string }).slug

/* ------------------------------- the overlay ------------------------------- */

/**
 * The committed snapshot plus the buffer, read-only, satisfying GraphSnapshot.
 *
 * Written here rather than borrowed from `core/snapshot.ts` because a
 * MutableSnapshot is the committed graph, and a tool that fails must leave no
 * trace in it — the whole point of discarding the buffer is that memory never
 * saw the failed transaction. This overlay is a view; nothing it does can leak.
 */
function overlay(base: GraphSnapshot, buf: Buffer): GraphSnapshot {
  const nodeAt = (id: NodeId): StoredNode | undefined => {
    const cell = buf.nodes.get(id)
    return cell ? (cell.after ?? undefined) : base.node(id)
  }

  const typed = <T extends NodeType>(n: StoredNode | undefined, expect?: T) =>
    n && (expect === undefined || n.type === expect) ? (n as StoredNode<T>) : undefined

  const staged = (type?: NodeType): StoredNode[] => {
    const out: StoredNode[] = []
    for (const cell of buf.nodes.values()) {
      if (cell.after && (type === undefined || cell.after.type === type)) out.push(cell.after)
    }
    return out
  }

  const edgesAt = (id: NodeId, rel: Rel | undefined, dir: 'out' | 'in'): StoredEdge[] => {
    const endOf = (e: StoredEdge) => (dir === 'out' ? e.from : e.to)
    const kept = (dir === 'out' ? base.out(id, rel) : base.in(id, rel)).filter(
      (e) => !buf.edges.has(e.id),
    )
    const added: StoredEdge[] = []
    for (const cell of buf.edges.values()) {
      const e = cell.after
      if (e && endOf(e) === id && (rel === undefined || e.rel === rel)) added.push(e)
    }
    return [...kept, ...added]
  }

  const incidentAt = (id: NodeId, rel?: Rel): StoredEdge[] => {
    const seen = new Set<EdgeId>()
    const all: StoredEdge[] = []
    for (const e of [...edgesAt(id, rel, 'out'), ...edgesAt(id, rel, 'in')]) {
      if (seen.has(e.id)) continue
      seen.add(e.id)
      all.push(e)
    }
    return all
  }

  return {
    get version() {
      return base.version
    },

    node: <T extends NodeType>(id: NodeId, expect?: T) => typed(nodeAt(id), expect),

    ofType<T extends NodeType>(type: T) {
      const kept = base.ofType(type).filter((n) => !buf.nodes.has(n.id))
      const added = staged(type) as StoredNode<T>[]
      // Id-ascending, which under UUIDv7 is creation order — the property that
      // deleted the hand-kept `at` index `application/restore` used to need (D4).
      return [...kept, ...added].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    },

    bySlug<T extends NodeType>(type: T, slug: string) {
      // The buffer first: a node created or renamed in this transaction has to
      // win over the committed row, or `org.ensure` mints a second Rice for the
      // second application in the same import.
      for (const n of staged(type)) {
        if (slugOf(n) === slug) return n as StoredNode<T>
      }
      const found = base.bySlug(type, slug)
      // Shadowed: the committed row is deleted, or this transaction has already
      // rewritten it and the rewrite did not answer to this slug above.
      return found && !buf.nodes.has(found.id) ? found : undefined
    },

    out: (id: NodeId, rel?: Rel) => edgesAt(id, rel, 'out'),
    in: (id: NodeId, rel?: Rel) => edgesAt(id, rel, 'in'),
    incident: incidentAt,

    one<T extends NodeType>(id: NodeId, rel: Rel, expect: T) {
      const edge = edgesAt(id, rel, 'out')[0]
      return edge ? typed(nodeAt(edge.to), expect) : undefined
    },

    many<T extends NodeType>(id: NodeId, rel: Rel, dir: 'out' | 'in', expect: T) {
      const out: StoredNode<T>[] = []
      for (const e of edgesAt(id, rel, dir)) {
        const n = typed(nodeAt(dir === 'out' ? e.to : e.from), expect)
        if (n) out.push(n)
      }
      return out
    },

    keywordNamed(name: string) {
      for (const n of staged('keyword')) {
        if (foldName((n.props as { name: string }).name) === foldName(name)) {
          return n as StoredNode<'keyword'>
        }
      }
      const found = base.keywordNamed(name)
      return found && !buf.nodes.has(found.id) ? found : undefined
    },

    edge(id: EdgeId) {
      const cell = buf.edges.get(id)
      return cell ? (cell.after ?? undefined) : base.edge(id)
    },

    nodes: () => [...base.nodes().filter((n) => !buf.nodes.has(n.id)), ...staged()],

    edges() {
      const added: StoredEdge[] = []
      for (const cell of buf.edges.values()) if (cell.after) added.push(cell.after)
      return [...base.edges().filter((e) => !buf.edges.has(e.id)), ...added]
    },

    degree: (id: NodeId) => incidentAt(id).length,

    // Delegated: an epoch is what the projection cache compares AFTER a commit,
    // and there is no projection of a transaction that has not committed yet.
    epoch: (id: NodeId) => base.epoch(id),
  }
}

/* ----------------------------- the transaction ----------------------------- */

/**
 * `read` is the overlay, so a mutator sees this transaction's earlier writes.
 * `instant` is the one the whole transaction stamps: a single commit whose rows
 * carry timestamps a few milliseconds apart stops being replayable in order.
 */
function makeTx(
  read: () => GraphSnapshot,
  buf: Buffer,
  instant: Instant,
  fail: ToolContext['fail'],
): Tx {
  const dropIncident = (id: NodeId, rel?: Rel) => {
    for (const e of read().incident(id, rel)) stage(buf.edges, e.id, e, null)
  }

  const priorNode = (id: NodeId) => read().node(id) ?? null

  return {
    put<T extends NodeType>(node: StoredNode<T>) {
      // The cast is the gap between `StoredNode<T>` for a generic T and the
      // eleven-way union the buffer holds. Nothing is being reinterpreted: T is
      // always one of the eleven at the call site.
      stage(buf.nodes, node.id, priorNode(node.id), node as StoredNode)
      return node
    },

    patch<T extends NodeType>(id: NodeId, patch: PropsPatch<T>) {
      const current = read().node(id)
      if (!current) fail(`No record with id ${id}.`, { code: 'graph/not-found' })

      // A key carrying `undefined` DELETES rather than storing the key. D21: a
      // stored `{ offer: undefined }` survives the round trip through IndexedDB
      // as a present key, and then passes the `in` check that every read path
      // uses to mean "this application has an offer".
      const props: Record<string, unknown> = { ...current.props }
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete props[key]
        else props[key] = value
      }

      const next = { ...current, props, updatedAt: instant } as StoredNode
      stage(buf.nodes, id, current, next)
      return next as StoredNode<T>
    },

    del(id: NodeId) {
      // The edges go with it. An edge whose endpoint is missing is corrupt and
      // the boot integrity check rejects the whole graph over one of them —
      // whereas the RECORDS at the other end are untouched, which is D15.
      dropIncident(id)
      stage(buf.nodes, id, priorNode(id), null)
    },

    link(from: NodeId, rel: Rel, to: NodeId, props: Props = {}) {
      const memory = read()
      const spec = EDGE_SCHEMA[rel]
      const a = memory.node(from)
      const b = memory.node(to)
      if (!a) {
        fail(`Cannot link from a record that is not here (${from}).`, { code: 'graph/not-found' })
      }
      if (!b) {
        fail(`Cannot link to a record that is not here (${to}).`, { code: 'graph/not-found' })
      }
      if (!spec.from.includes(a.type) || !spec.to.includes(b.type)) {
        fail(`A ${a.type} cannot be ${spec.label} a ${b.type}.`, { code: 'graph/invariant' })
      }

      const id = edgeId(from, rel, to)

      // `fromCardinality: 'one'` is what preserves the old `applicationId?:
      // string` semantics. That invariant used to live nowhere — it was IMPLIED
      // by the field being a scalar, so nothing stopped a second write leaving a
      // reminder filed under two applications at once.
      if (spec.fromCardinality === 'one') {
        for (const e of memory.out(from, rel)) {
          if (e.id !== id) stage(buf.edges, e.id, e, null)
        }
      }

      // Idempotent with no read-before-write, because the id IS the triple (D7).
      const existing = memory.out(from, rel).find((e) => e.id === id)
      if (existing) return id

      stage(buf.edges, id, null, { id, rel, from, to, props, createdAt: instant })
      return id
    },

    unlink(from: NodeId, rel: Rel, to: NodeId) {
      const id = edgeId(from, rel, to)
      const existing = read()
        .out(from, rel)
        .find((e) => e.id === id)
      if (existing) stage(buf.edges, id, existing, null)
    },

    unlinkAll(id: NodeId, opts?: { rel?: Rel }) {
      dropIncident(id, opts?.rel)
    },
  }
}

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
