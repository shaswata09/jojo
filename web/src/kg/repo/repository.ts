/**
 * L2 — the Repository: transactional state plus durability.
 *
 * `commit` is synchronous. It applies the entry's after-images to the snapshot,
 * appends the journal row and enqueues the durable ops; it never awaits the disk.
 * Awaiting would mean a route transition gated on a write (JobScout.tsx:268,
 * ApplicationDetail.tsx:299) — a spinner between clicking a card and seeing it.
 *
 * Memory is authoritative and IndexedDB is a durability mechanism, not a query
 * mechanism.
 *
 * Undo, redo and Settings' audit-log undo are one operation. `revert` replays an
 * entry backwards and commits the result, so the revert of a revert is the
 * original and redo needs no second mechanism. Which stack an entry came from is
 * the only thing that differs, and it decides only which stack the inverse lands
 * on — an entry reverted from the undo ring becomes a redo, an entry reverted
 * from the audit becomes a plain new commit, because undoing something from
 * three hours ago is a change like any other and must not silently promise that
 * pressing redo will put it back.
 */

import type { EdgeId, Instant, NodeId, NodeType, Rel, StoredEdge, StoredNode } from '../core/model'
import { uuidv7 } from '../core/ref'
import { fail, ok } from '../core/result'
import type { Result } from '../core/result'
import type { GraphSnapshot, MutableSnapshot } from '../core/snapshot'
import type { Driver, DurableOp, StoreEvent } from '../storage/driver'
import type { StoredRow } from '../storage/schema'
import { AUDIT_CAP, Ring, UNDO_DEPTH, applyJournal, invert, isEmpty } from './journal'
import type { JournalDraft, JournalEntry, RecordDelta } from './journal'
import { metaRow, touched } from './meta'
import type { StoreMeta } from './meta'
import { createWriteQueue } from './queue'
import type { PersistenceHealth } from './queue'

export type { PersistenceHealth } from './queue'

/** Everything the graph is, as records. What `replaceAll` takes and seeding produces. */
export type GraphRows = {
  nodes: readonly StoredNode[]
  edges: readonly StoredEdge[]
}

export interface Repository {
  getSnapshot(): GraphSnapshot
  subscribe(onChange: () => void): () => void

  /**
   * Synchronous. Applies the entry's `after` images to the snapshot, appends the
   * journal row, and enqueues the durable ops. Returns the committed entry.
   * The delta log IS the durable op list — there is no separate effects mapper.
   */
  commit(entry: JournalDraft): JournalEntry
  /** Replays an entry backwards. Itself a commit, so redo is free. */
  revert(entryId: string): JournalEntry

  readonly undoable: readonly JournalEntry[]
  readonly redoable: readonly JournalEntry[]
  readonly audit: readonly JournalEntry[]
  /** Cleared on a remote commit — another tab's writes invalidate our stack. */
  clearHistory(): void

  readonly meta: StoreMeta
  readonly health: PersistenceHealth
  subscribeHealth(fn: (h: PersistenceHealth) => void): () => void
  /** Awaited by export, by Settings' three data ops, and by pagehide. */
  flush(): Promise<void>
  /** Wholesale replace in one driver transaction: demo / empty / import. */
  replaceAll(graph: GraphRows, meta: StoreMeta): Promise<Result<void>>
  /**
   * Adopts rows that were read back off disk. Writes NOTHING.
   *
   * The other half of `replaceAll`, and the distinction is the whole of D23's
   * remote-change path: another tab has already written these rows, so writing
   * them again would be our stale queue replaying over their fresh state, which
   * is R-7 with the last-write-wins pointing the wrong way. This adopts and
   * clears the undo stack, because every before-image in it was captured against
   * a record that tab may since have changed.
   */
  rehydrate(graph: GraphRows, meta: StoreMeta, audit?: readonly JournalEntry[]): void
  /** Stops the write queue and drops the driver's listeners. */
  close(): void
}

export type RepositoryOptions = {
  driver: Driver
  /** Mutated in place and never rebuilt. `boot` hands over the hydrated one. */
  snapshot: MutableSnapshot
  meta: StoreMeta
  /** Injected. No module in kg/ reads the clock; see D26 and `tools/tool.ts`. */
  now: () => Instant
  /** Rows already in the `ops` store, so the audit survives a rehydrate. */
  audit?: readonly JournalEntry[]
  /** Next free key in `ops`. Continued rather than restarted, so keys never collide. */
  opsSeq?: number
}

/**
 * A fresh, read-only handle onto the same indexes, minted once per commit.
 *
 * `useSyncExternalStore(repo.subscribe, repo.getSnapshot)` compares the two
 * readings by reference and bails out of rendering when they match. The snapshot
 * underneath is mutated in place and never rebuilt — that is D-R10, and it is
 * what keeps a commit O(1) instead of O(nodes) — so handing the mutable object
 * back as itself would return the same reference forever and not one card in the
 * app would ever re-render. Nothing is copied here: fifteen bound methods over
 * the same maps, once per user action.
 *
 * Delegating explicitly rather than through a Proxy or `Object.create` is
 * deliberate twice over. `MutableSnapshot`'s indexes are `#private`, so a
 * prototype-linked object throws on the first read; and if `GraphSnapshot` grows
 * a member, this list fails to compile, which is where you want to find out.
 */
function reading(s: MutableSnapshot): GraphSnapshot {
  return {
    // Copied, not proxied through a getter. A reading held across a commit — the
    // `before` half of any comparison — would otherwise report the version it is
    // being compared AGAINST, so `version` could never detect a change and every
    // projection keyed on it would serve its cache forever.
    version: s.version,
    node: <T extends NodeType>(id: NodeId, expect?: T) => s.node<T>(id, expect),
    ofType: <T extends NodeType>(type: T) => s.ofType(type),
    bySlug: <T extends NodeType>(type: T, slug: string) => s.bySlug(type, slug),
    keywordNamed: (name: string) => s.keywordNamed(name),
    out: (id: NodeId, rel?: Rel) => s.out(id, rel),
    in: (id: NodeId, rel?: Rel) => s.in(id, rel),
    incident: (id: NodeId, rel?: Rel) => s.incident(id, rel),
    edge: (id: EdgeId) => s.edge(id),
    one: <T extends NodeType>(id: NodeId, rel: Rel, expect: T) => s.one(id, rel, expect),
    many: <T extends NodeType>(id: NodeId, rel: Rel, dir: 'out' | 'in', expect: T) =>
      s.many(id, rel, dir, expect),
    degree: (id: NodeId) => s.degree(id),
    epoch: (id: NodeId) => s.epoch(id),
    nodes: () => s.nodes(),
    edges: () => s.edges(),
  }
}

const rowOf = (record: StoredNode | StoredEdge): StoredRow => record as unknown as StoredRow

/**
 * One durable op per delta, in the same order.
 *
 * This is D19 made concrete: the delta log IS the op list. An `effectsOf(action,
 * before, after)` mapper only exists while a reducer does, and a mapper that has
 * to re-derive what a write touched forgets things in exactly the way the
 * hand-written undo closures did, one layer down.
 */
function opsFor(entry: JournalEntry, opsKey: number): DurableOp[] {
  const ops: DurableOp[] = []

  const push = <T extends StoredNode | StoredEdge>(
    store: 'nodes' | 'edges',
    deltas: readonly RecordDelta<T>[],
  ) => {
    for (const delta of deltas) {
      if (delta.after === null) ops.push({ kind: 'delete', store, key: delta.id })
      else ops.push({ kind: 'put', store, key: delta.id, value: rowOf(delta.after) })
    }
  }

  push('nodes', entry.nodes)
  push('edges', entry.edges)
  ops.push({ kind: 'put', store: 'ops', key: opsKey, value: entry as unknown as StoredRow })
  return ops
}

export function createRepository(options: RepositoryOptions): Repository {
  const { driver, now } = options

  const queue = createWriteQueue(driver)
  const listeners = new Set<() => void>()

  const undo = new Ring<JournalEntry>(UNDO_DEPTH)
  const redo = new Ring<JournalEntry>(UNDO_DEPTH)
  const audit = new Ring<JournalEntry>(AUDIT_CAP)
  if (options.audit) audit.load(options.audit)

  // Never reassigned. The snapshot handed over by `boot` is the one this
  // repository keeps for its whole life — `replaceAll` and `rehydrate` swap its
  // CONTENTS rather than the object, because the version and epoch counters on
  // it are what every projection cache is keyed against.
  const snapshot = options.snapshot
  let meta = options.meta
  let opsSeq = options.opsSeq ?? audit.size
  let current = reading(snapshot)

  const notify = () => {
    for (const fn of [...listeners]) fn()
  }

  /**
   * Stamped here rather than by the caller.
   *
   * A tool that minted its own entry id could mint one that already exists, and
   * a duplicate id is not a visible bug — it is `revert` finding the wrong entry
   * and undoing a write from ten minutes ago instead of the last one.
   */
  const stamp = (draft: JournalDraft): JournalEntry => {
    const at = now()
    return { ...draft, id: uuidv7(Date.parse(at)), at }
  }

  function land(entry: JournalEntry): JournalEntry {
    applyJournal(snapshot, entry, 'redo')
    snapshot.commit()
    current = reading(snapshot)
    audit.push(entry)

    opsSeq += 1
    const ops = opsFor(entry, opsSeq)

    // Demo data stops being demo data the moment the user writes to it. Left at
    // 'demo', Settings would go on offering to replace their records with the
    // fixtures, and a first-run check after a reload would agree.
    const next = touched(meta)
    if (next !== meta) {
      meta = next
      const row = metaRow(meta)
      ops.push({ kind: 'put', store: 'meta', key: row.key, value: row })
    }

    queue.enqueue(ops)
    notify()
    return entry
  }

  return {
    getSnapshot: () => current,

    subscribe(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },

    commit(draft) {
      const entry = land(stamp(draft))
      // An entry that changed nothing is still audited — "you pressed save and
      // nothing happened" is worth being able to see — but it must not take the
      // top of the undo stack, or one no-op save eats the undo the user wanted.
      if (!isEmpty(entry)) {
        undo.push(entry)
        // Anything redoable described a future this write has just replaced.
        // Keeping it would let redo reapply a before-image captured against
        // records that no longer look like that.
        redo.clear()
      }
      return entry
    },

    revert(entryId) {
      const fromUndo = undo.entries.find((e) => e.id === entryId)
      if (fromUndo) {
        removeFromRing(undo, entryId)
        const entry = land(stamp(invert(fromUndo, fromUndo.label)))
        redo.push(entry)
        return entry
      }

      const fromRedo = redo.entries.find((e) => e.id === entryId)
      if (fromRedo) {
        removeFromRing(redo, entryId)
        const entry = land(stamp(invert(fromRedo, fromRedo.label)))
        undo.push(entry)
        return entry
      }

      const fromAudit = audit.entries.find((e) => e.id === entryId)
      if (!fromAudit) {
        throw new Error(`journal entry '${entryId}' is not in the undo, redo or audit ring`)
      }
      // Reverting a row out of the audit log is an ordinary new change. It does
      // NOT become redoable: offering redo for something undone from three hours
      // ago would promise to reapply a before-image captured against records
      // that have been edited a dozen times since.
      const entry = land(stamp(invert(fromAudit, `Undo ${fromAudit.label}`)))
      undo.push(entry)
      redo.clear()
      return entry
    },

    get undoable() {
      return undo.entries
    },

    get redoable() {
      return redo.entries
    },

    get audit() {
      return audit.entries
    },

    clearHistory() {
      undo.clear()
      redo.clear()
    },

    get meta() {
      return meta
    },

    get health() {
      return queue.health
    },

    subscribeHealth: (fn) => queue.subscribe(fn),

    flush: () => queue.flush(),

    async replaceAll(graph, nextMeta) {
      // Flushed FIRST. The queued ops describe rows that are about to stop
      // existing, and draining them after the replace would write a deleted
      // record back into a store that had just been emptied.
      await queue.flush()

      const written = await driver.replace({
        nodes: graph.nodes.map(rowOf),
        edges: graph.edges.map(rowOf),
        meta: [metaRow(nextMeta)],
        // The journal describes writes against records that no longer exist.
        // Keeping it would leave an audit log whose every row names a missing id.
        ops: [],
      })
      if (!written.ok) {
        return fail(written.error.code, undefined, {
          context: { ...written.error.context, driverMessage: written.error.message },
        })
      }

      // Swapped in place rather than rebuilt. Every other write is incremental
      // and a wholesale replace has no delta to apply, so a fresh snapshot read
      // as the obvious move — but it restarted `version` at 0 and published a
      // number the projections had already seen, and they served the records
      // that had just been deleted. `reset` is the same swap with the counters
      // carried over; see the comment on it in `snapshot.ts`.
      snapshot.reset(graph.nodes, graph.edges)
      snapshot.commit()
      current = reading(snapshot)
      meta = nextMeta
      // Every before-image in the rings was captured against records that are
      // gone. Undoing one would put a record back that this store has never
      // held, which is worse than having no undo at all.
      undo.clear()
      redo.clear()
      audit.clear()
      opsSeq = 0
      notify()
      return ok(undefined)
    },

    rehydrate(graph, nextMeta, nextAudit) {
      // In place, for the reason `replaceAll` gives. This is the path D23 takes
      // on another tab's write, and a second tab that has not itself committed
      // anything is the NORMAL case — so rebuilding here meant cross-tab sync
      // arrived, rehydrated correctly, and rendered nothing.
      snapshot.reset(graph.nodes, graph.edges)
      snapshot.commit()
      current = reading(snapshot)
      meta = nextMeta
      undo.clear()
      redo.clear()
      audit.clear()
      if (nextAudit) audit.load([...nextAudit])
      // Continued from what came back off disk, not restarted. The other tab is
      // writing into the same `ops` store with its own counter; restarting ours
      // at zero would have us overwrite its newest entries with our oldest.
      opsSeq = audit.size
      notify()
    },

    close() {
      queue.stop()
      driver.close()
    },
  }
}

/** Rings are FIFO by design; `revert` is the one caller that removes by id. */
function removeFromRing<T extends { id: string }>(ring: Ring<T>, id: string): void {
  const oldestFirst = [...ring.entries].reverse().filter((e) => e.id !== id)
  ring.load(oldestFirst)
}

/**
 * What a remote commit means for us, in one place.
 *
 * Another tab's write invalidates the undo stack, because every before-image in
 * it was captured against a record that tab may since have changed. Flushing
 * first is not tidiness — our own queued ops are last-write-wins against theirs,
 * and draining them after we rehydrate would replay our stale rows over their
 * fresh ones.
 */
export async function onRemoteCommit(
  repo: Repository,
  _event: StoreEvent,
  rehydrate: () => Promise<void>,
): Promise<void> {
  await repo.flush()
  await rehydrate()
  repo.clearHistory()
}
