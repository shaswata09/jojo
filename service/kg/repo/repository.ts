/**
 * L2 — the Repository: transactional state plus durability.
 *
 * `commit` is synchronous. It applies the entry's after-images to the snapshot,
 * appends the journal row and enqueues the durable ops; it never awaits the disk.
 * Awaiting would mean a route transition gated on a write (`onPromote` in
 * `routes/JobScout.tsx`, `onDecide` in `routes/ApplicationDetail.tsx`) — a
 * spinner between clicking a card and seeing it.
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
import type { KgErrorCode, Result } from '../core/result'
import type { GraphSnapshot, MutableSnapshot } from '../core/snapshot'
import type { Driver, DurableOp, StoreEvent } from '../storage/driver'
import type { StoredRow } from '../storage/schema'
import { AUDIT_CAP, Ring, UNDO_DEPTH, applyJournal, changesNothing, invert } from './journal'
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

/** Per-commit overrides. Absent means the ordinary user-performed write. */
export type CommitOptions = {
  /**
   * `false` keeps the entry out of the undo ring and leaves redo alone.
   * See `Repository.commit`.
   */
  stack?: boolean
}

export interface Repository {
  getSnapshot(): GraphSnapshot
  subscribe(onChange: () => void): () => void

  /**
   * Synchronous. Applies the entry's `after` images to the snapshot, appends the
   * journal row, and enqueues the durable ops. Returns the committed entry.
   * The delta log IS the durable op list — there is no separate effects mapper.
   *
   * `stack: false` journals and audits the entry without touching the undo ring
   * or clearing redo. It is for a write the SYSTEM finished, not one the user
   * performed — the only case today is attaching a file's bytes once they land
   * on disk, seconds after the drop that the user already undid or did not.
   * Without it, ⌘Z after dropping a CV reverts the attach and silently unlinks
   * bytes the user just watched arrive, and a background write arriving while
   * they are considering a redo destroys it.
   *
   * Deliberately not `undoable: false`, which clears the ENTIRE history and
   * exists for admin tools like a wholesale reset. This is the same distinction
   * `changesNothing` already draws — "audited, but not a step the user takes
   * back" — generalised from "changed nothing" to "was not the user's doing".
   */
  commit(entry: JournalDraft, options?: CommitOptions): JournalEntry
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
  /**
   * Wholesale replace in one driver transaction: demo / empty / import.
   *
   * Refuses, without writing anything, when the write queue could not be
   * drained first. See the comment on the flush inside it.
   */
  replaceAll(graph: GraphRows, meta: StoreMeta): Promise<Result<void>>
  /**
   * Writes the meta row and nothing else.
   *
   * The light counterpart to `replaceAll`, which flushes the queue and rewrites
   * every row in the store — far too much for stamping a date. Both ends of a
   * Transfer need to record that one happened, and the sender has no other
   * reason to touch the graph at all.
   *
   * Queued rather than awaited, exactly like a commit's own meta write above:
   * the flag it carries is a status line, and a status line is not worth
   * blocking the interface on a disk that is being slow.
   */
  setMeta(next: StoreMeta): void
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

/**
 * A checked record on its way back OUT to the store, as an opaque row.
 *
 * The mirror of `validateRows`, and exported for the same reason that file
 * keeps its two casts in one place: this is the only direction in which a
 * `StoredNode` becomes a `StoredRow`, and `boot.ts` had a byte-identical copy
 * for the first-run write. Two spellings of one cast is how a third arrives.
 *
 * Safe in a way the inbound cast is not — the value has already been through
 * the trust boundary, and `props` is binary-free by D27 — so it is a widening
 * to `{ [k: string]: unknown }` and nothing is being asserted about the shape.
 */
export const rowOf = (record: StoredNode | StoredEdge): StoredRow => record as unknown as StoredRow

/**
 * One durable op per delta, in the same order.
 *
 * This is D19 made concrete: the delta log IS the op list. An `effectsOf(action,
 * before, after)` mapper only exists while a reducer does, and a mapper that has
 * to re-derive what a write touched forgets things in exactly the way the
 * hand-written undo closures did, one layer down.
 */
function opsFor(entry: JournalEntry): DurableOp[] {
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
  // `key: null` — the STORE allocates. This used to be a counter this repository
  // kept, and the counter is per tab: two tabs open on the same database both
  // believed the next free key was the same integer, so `put` overwrote instead
  // of appending and a concurrent burst reached disk with about half its journal
  // rows destroyed. The records themselves survived that (they are keyed by id);
  // the log of what happened to them did not, which is the one thing an audit
  // exists to be. `schema.ts` has had `autoIncrement: true` on this store all
  // along, described there as the backstop for a caller that forgets its key.
  // The caller did not forget — it insisted — and the backstop is the fix.
  ops.push({ kind: 'put', store: 'ops', key: null, value: entry as unknown as StoredRow })
  return ops
}

/**
 * The entry, plus a delta for every edge removing its node will take with it.
 *
 * `MutableSnapshot.removeNode` cascades over incident edges so the graph can
 * never hold an edge with a missing end. `opsFor` derives its ops only from the
 * entry, so an edge the cascade reached was removed from memory, never written
 * as a delete, and never captured as a before-image. The audit measured the
 * cost: create an application, tag it inside the eight-second Undo window,
 * press Undo — the tag left the screen with no undo that could bring it back,
 * and a TAGS row stayed on disk pointing at a node that no longer existed, so
 * every launch from then on said "1 record on this device could not be read".
 * D12 is the rule it broke: a delta captured by the write cannot be forgotten.
 *
 * The WRITE path never had this hole — `tx.del` stages `dropIncident(id)`, so
 * the displaced edges are journalled before the node goes. Replay had no such
 * staging, because an inverted entry carries only what the original entry
 * named. This is that same staging, applied to whatever is about to be removed,
 * which makes both paths obey one rule instead of two.
 *
 * Returns the entry unchanged when nothing is displaced, which is every commit
 * that deletes nothing and every delete a tool staged properly.
 */
function withDisplacedEdges(s: MutableSnapshot, entry: JournalEntry): JournalEntry {
  const named = new Set(entry.edges.map((delta) => delta.id))
  const displaced: RecordDelta<StoredEdge>[] = []

  for (const delta of entry.nodes) {
    // Only the removals cascade. `land` always replays forwards, so the image
    // that decides is `after`.
    if (delta.after !== null) continue
    for (const edge of s.incident(delta.id)) {
      if (named.has(edge.id)) continue
      named.add(edge.id)
      displaced.push({ id: edge.id, before: edge, after: null })
    }
  }

  if (displaced.length === 0) return entry
  return { ...entry, edges: [...entry.edges, ...displaced] }
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
  let current = reading(snapshot)

  const notify = () => {
    // A snapshot, not a copy: the loop body mutates the collection it is
    // walking, so it has to walk a list taken before the first change.
    // oxlint-disable-next-line unicorn/no-useless-spread
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

  function land(stamped: JournalEntry): JournalEntry {
    const entry = withDisplacedEdges(snapshot, stamped)
    applyJournal(snapshot, entry, 'redo')
    snapshot.commit()
    current = reading(snapshot)
    audit.push(entry)

    const ops = opsFor(entry)

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
    setMeta(next) {
      meta = next
      const row = metaRow(meta)
      queue.enqueue([{ kind: 'put', store: 'meta', key: row.key, value: row }])
      notify()
    },

    subscribe(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },

    commit(draft, options) {
      const entry = land(stamp(draft))
      // Journalled and audited either way — the audit log's job is to record
      // everything that touched the store, and a background attach is exactly
      // the kind of write a user later wants an account of. Only the undo ring
      // is withheld.
      if (options?.stack === false) return entry
      // An entry that changed nothing is still audited — "you pressed save and
      // nothing happened" is worth being able to see — but it must not take the
      // top of the undo stack, or one no-op save eats the undo the user wanted.
      //
      // This used to ask whether the entry had any deltas AT ALL, which no
      // patch-based tool can ever answer no to: `tx.patch` stamps `updatedAt` on
      // every call, so pressing Save on an unchanged form staged a delta, took
      // the top of the undo stack, and left Ctrl+Z rewriting a timestamp instead
      // of undoing the edit before it. `changesNothing` reads the images rather
      // than counting them, which is what makes the guard mean what it says.
      if (!changesNothing(entry)) {
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
      /*
       * A trimmed entry can be read and not reverted.
       *
       * `trimJournal` drops the before/after images from entries older than the
       * undo window, because keeping them made the persisted journal 95% of
       * every write. What is left is `{id, before: null, after: null}` — and
       * `invert` on that would swap two nulls and land a change that DELETES
       * every record the entry names. Refusing is the only safe reading, and it
       * has to be checked here rather than in the UI, which offers undo on the
       * newest entry and would never have reached one.
       */
      if (fromAudit.trimmed === true) {
        throw new Error(
          `'${fromAudit.label}' is too far back to undo — the journal keeps what changed, but not enough to put it back`,
        )
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
      // Flushed FIRST, and the ANSWER is read. The queued ops describe rows that
      // are about to stop existing, and draining them after the replace would
      // write a deleted record back into a store that had just been emptied.
      //
      // `flush()` alone was not enough, and the gap was silent: it settles on a
      // failed attempt by design so `pagehide` can never hang, so awaiting it
      // while the disk was failing resolved with the stale batch still pending.
      // The audit drove it — a write failing at the moment the user pressed
      // Settings -> Empty reported success, blanked the screen, and then the
      // next successful retry put the deleted record and its journal row back on
      // disk under an empty graph, with health reporting `idle`. On a store
      // still holding the demo fixtures the pending meta flip went back with it
      // and D24's first-run signal read 'user' over a store the user had emptied.
      //
      // So it fails closed rather than dropping `pending`: those ops are the
      // user's unsaved work, and discarding them to make a wipe succeed would
      // trade a visible refusal for a silent loss.
      if ((await queue.flushAndReport()) !== 'drained') {
        const health = queue.health
        return fail(stalledCode(health), stalledMessage(health), {
          context: { at: 'replaceAll', health },
        })
      }

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
      notify()
    },

    close() {
      queue.stop()
      driver.close()
    },
  }
}

/**
 * The code a refused `replaceAll` reports, taken from why the queue is stuck.
 *
 * Widened from the queue's own reason rather than flattened to one code, so the
 * log line and Diagnostics say the same thing the banner does. A queue that is
 * merely `degraded` has no reason of its own — the disk is failing for some
 * reason it did not classify — and 'storage/unavailable' is the honest reading
 * of that.
 */
function stalledCode(health: PersistenceHealth): KgErrorCode {
  if (health.state !== 'off') return 'storage/unavailable'
  if (health.reason === 'quota') return 'storage/quota'
  if (health.reason === 'blocked') return 'storage/blocked'
  return 'storage/corrupt'
}

/**
 * Toast copy for the refusal. Two sentences, because there are two situations.
 *
 * `off` is not recoverable inside a session, so telling the user to wait would
 * be the same promise the banner used to make and could not keep; the only
 * thing left that helps them is an export. Everything else is a retry away, and
 * saying so is what makes the refusal read as caution rather than as a bug. The
 * default sentence for the code is not used: the codes describe why the DISK
 * said no, and this is a message about what jojo did instead.
 */
function stalledMessage(health: PersistenceHealth): string {
  return health.state === 'off'
    ? 'jojo has stopped saving to this device, and some of your changes are still only on screen. Export a copy from Settings before replacing your records.'
    : 'Some of your changes have not reached the disk yet. Try again once saving has caught up.'
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

  /*
   * Not when our own writes never reached the disk.
   *
   * `flush()` settles on a FAILED attempt by design, so `pagehide` can never
   * hang — awaiting it says nothing about whether anything drained. That is the
   * same trap `replaceAll` sixty lines above documents at length, and the same
   * fix: read the state, and refuse rather than proceed.
   *
   * Proceeding is the worst thing available here. `rehydrate()` calls
   * `snapshot.reset` with what is on DISK, so every edit still only in memory
   * is gone; `clearHistory()` then destroys the undo ring and the audit log
   * that were the last record of it. And `off` never clears within a session,
   * so this is not a delay — it is permanent, silent, and triggered by another
   * tab the person is not looking at.
   *
   * Staying stale is the lesser harm: the work remains on screen, and the stall
   * banner is already telling them to export it.
   */
  if (repo.health.state === 'degraded' || repo.health.state === 'off') return

  await rehydrate()
  repo.clearHistory()
}
