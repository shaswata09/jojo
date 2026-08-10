/**
 * L0 — in-RAM Driver.
 *
 * Two users: the test suite, and the fallback when IndexedDB is unavailable
 * (private browsing, blocked storage). The app must still run with storage off —
 * it just cannot promise durability, and says so.
 *
 * It is a stand-in for IndexedDB, not a Map with an interface bolted on, and the
 * two places that matters are both places where a looser driver would let a bug
 * through here and surface it in Wave 2:
 *
 * - Every row is `structuredClone`d on the way in and on the way out. Handing
 *   back the caller's own object would make a snapshot that mutated a stored node
 *   in place look correct in every test, right up to the first real write, where
 *   IndexedDB's own structured clone breaks the aliasing and the change silently
 *   fails to persist.
 * - `readAll` returns each store in ascending key order, because `getAll` does.
 *   The snapshot reads "id-ascending = creation order" straight out of that, so a
 *   driver returning insertion order would have quietly supplied the right answer
 *   for the wrong reason and changed it on the swap.
 */

import { driverFail, driverOk, emptyRows } from './driver'
import type {
  Driver,
  DriverFailure,
  DriverResult,
  DurableOp,
  OpenInfo,
  Rows,
  StoreEvent,
} from './driver'
import type { MetaRow, StoreName, StoredRow } from './schema'
import { STORE_NAMES } from './schema'

type Key = string | number
type Store = Map<Key, StoredRow>
type Stores = Record<StoreName, Store>

/** Which call is being made, for the fault seam below. */
export type MemoryCall = 'open' | 'readAll' | 'commit' | 'replace' | 'seedIfPristine' | 'destroy'

export type MemoryDriverOptions = {
  /** Rows the store already holds — a rehydrate, or a fixture. */
  rows?: Partial<Rows>
  /**
   * Test-only. Returns a failure to serve instead of doing the work.
   *
   * Here because the write-behind queue's degraded path — retry, back off,
   * persistent banner — is otherwise unreachable: an in-RAM Map does not run out
   * of quota, and R-5 (persistence failing after the UI has moved on) is a risk
   * ranked high enough that "we will find out in Wave 2" is not an answer.
   */
  fault?: (call: MemoryCall) => DriverFailure | null
}

/** The `Driver`, plus the two seams only a test uses. */
export interface MemoryDriver extends Driver {
  /** Drives the remote-commit path without a second tab or a BroadcastChannel. */
  emitRemoteCommit(event: StoreEvent): void
  /** Drives the `blocking` path: another tab is upgrading and we must close. */
  emitBlocking(): void
  /** Row counts, for asserting what actually reached the store. */
  counts(): Record<StoreName, number>
}

const emptyStores = (): Stores => ({
  nodes: new Map(),
  edges: new Map(),
  meta: new Map(),
  ops: new Map(),
})

/**
 * Ascending, with numbers before strings.
 *
 * IndexedDB's own key ordering, and the ordering `getAll` returns. Only `ops` is
 * numeric and only `ops` is ever read as a sequence, but a comparator that
 * silently coerced `2` and `'10'` into the same space would have put journal
 * entry 10 before entry 2 in the audit log and made the history read backwards
 * in one place and forwards everywhere else.
 */
function compareKeys(a: Key, b: Key): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'number') return -1
  if (typeof b === 'number') return 1
  return a < b ? -1 : a > b ? 1 : 0
}

const readStore = (store: Store): StoredRow[] =>
  [...store.entries()]
    .sort(([a], [b]) => compareKeys(a, b))
    .map(([, row]) => structuredClone(row) as StoredRow)

/**
 * The key each store reads off its own rows.
 *
 * In-line keys, so a `put` carries its key inside the value and the two cannot
 * disagree. `ops` is the exception — it is `autoIncrement`, so the caller has to
 * supply the sequence number and there is nothing in the row to check it against.
 */
function keyOf(store: StoreName, key: Key, value: StoredRow): Key {
  if (store === 'ops') return key
  const inline = value['id'] ?? value['key']
  return typeof inline === 'string' || typeof inline === 'number' ? inline : key
}

export function createMemoryDriver(options: MemoryDriverOptions = {}): MemoryDriver {
  let stores = emptyStores()
  let closed = false
  const remote = new Set<(e: StoreEvent) => void>()
  const blocking = new Set<() => void>()

  const load = (rows: Partial<Rows>, into: Stores) => {
    for (const name of STORE_NAMES) {
      const list = rows[name]
      if (!list) continue
      for (const [index, row] of list.entries()) {
        const cloned = structuredClone(row) as StoredRow
        into[name].set(keyOf(name, index + 1, cloned), cloned)
      }
    }
  }

  if (options.rows) load(options.rows, stores)

  /**
   * Every entry point starts here.
   *
   * A driver that kept serving after `close()` would have hidden the bug the
   * `blocking` handler exists to catch: a tab that closed its connection so
   * another could upgrade, then carried on writing to a database it no longer
   * holds. In IndexedDB that is an `InvalidStateError` on the next call; here it
   * has to be an error too, or the fallback is more permissive than the thing it
   * stands in for.
   */
  function guard<T>(call: MemoryCall): DriverResult<T> | null {
    if (closed) {
      return driverFail<T>('storage/unavailable', `driver is closed (${call})`)
    }
    const failure = options.fault?.(call)
    return failure ? { ok: false, error: failure } : null
  }

  const open = async (): Promise<DriverResult<OpenInfo>> =>
    guard<OpenInfo>('open') ?? driverOk({ version: 1, from: 1, migrated: [] })

  const readAll = async (): Promise<DriverResult<Rows>> =>
    guard<Rows>('readAll') ??
    driverOk({
      nodes: readStore(stores.nodes),
      edges: readStore(stores.edges),
      meta: readStore(stores.meta) as MetaRow[],
      ops: readStore(stores.ops),
    })

  /**
   * Applied to a copy and swapped in at the end.
   *
   * One transaction over all four stores means all of it lands or none of it
   * does. Mutating in place and bailing halfway would leave the store in a state
   * the journal has no entry for — a node deleted whose edges are still there —
   * and that half-state is exactly what the caller trusts this method not to
   * produce.
   */
  const commit = async (ops: readonly DurableOp[]): Promise<DriverResult<void>> => {
    const failed = guard<void>('commit')
    if (failed) return failed

    const next: Stores = {
      nodes: new Map(stores.nodes),
      edges: new Map(stores.edges),
      meta: new Map(stores.meta),
      ops: new Map(stores.ops),
    }

    for (const op of ops) {
      if (op.kind === 'clear') {
        next[op.store].clear()
      } else if (op.kind === 'delete') {
        next[op.store].delete(op.key)
      } else {
        const cloned = structuredClone(op.value) as StoredRow
        next[op.store].set(keyOf(op.store, op.key, cloned), cloned)
      }
    }

    stores = next
    return driverOk(undefined)
  }

  const replace = async (rows: Rows): Promise<DriverResult<void>> => {
    const failed = guard<void>('replace')
    if (failed) return failed
    const next = emptyStores()
    load(rows, next)
    stores = next
    return driverOk(undefined)
  }

  /**
   * The in-RAM half of R-11's answer, and it has to be here as well as in IDB.
   *
   * A memory driver is what the app falls back to when storage is blocked, and
   * it is what every test runs against — so a version that always wrote would
   * make the double-seed bug invisible in the suite and reachable in private
   * browsing. `stores.meta.size` is read and written with no `await` between
   * them, which is this driver's whole transaction.
   */
  const seedIfPristine = async (rows: Rows): Promise<DriverResult<boolean>> => {
    const failed = guard<boolean>('seedIfPristine')
    if (failed) return failed
    if (stores.meta.size > 0) return driverOk(false)
    const next = emptyStores()
    load(rows, next)
    stores = next
    return driverOk(true)
  }

  const destroy = async (): Promise<DriverResult<void>> => {
    const failed = guard<void>('destroy')
    if (failed) return failed
    stores = emptyStores()
    return driverOk(undefined)
  }

  return {
    open,
    readAll,
    commit,
    replace,
    seedIfPristine,
    destroy,

    onRemoteCommit(fn) {
      remote.add(fn)
      return () => remote.delete(fn)
    },

    onBlocking(fn) {
      blocking.add(fn)
      return () => blocking.delete(fn)
    },

    close() {
      closed = true
    },

    emitRemoteCommit(event) {
      for (const fn of [...remote]) fn(event)
    },

    emitBlocking() {
      for (const fn of [...blocking]) fn()
    },

    counts() {
      return {
        nodes: stores.nodes.size,
        edges: stores.edges.size,
        meta: stores.meta.size,
        ops: stores.ops.size,
      }
    },
  }
}

/** A driver holding nothing, for the first-run path and for most tests. */
export const emptyMemoryDriver = (): MemoryDriver => createMemoryDriver({ rows: emptyRows() })
