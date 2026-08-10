/**
 * L0 — the `idb` implementation of Driver. The ONLY file importing `idb`.
 *
 *
 * THE TRANSACTION-LIFETIME TRAP, AND WHY IT IS NOT MERELY DOCUMENTED
 *
 * An IndexedDB transaction commits itself the moment control returns to the
 * event loop with no outstanding requests against it. So `await` anything that
 * is not a request of THIS transaction — a fetch, a `structuredClone` through a
 * worker, another transaction, a plain `Promise.resolve()` chained off something
 * else — and the turn ends, the transaction auto-commits, and the next statement
 * throws `TransactionInactiveError`. Sometimes after half the writes have landed,
 * which is the half-write R-3 names: a node deleted whose edges are still there,
 * with no journal entry describing that state and no way to detect it later.
 *
 * Documenting that rule and trusting it is how it gets broken, because the
 * offending `await` is always three refactors away from the comment. So the rule
 * is made unrepresentable instead, in three moves:
 *
 * 1. No transaction handle escapes this file. `Driver` has no `begin()` and no
 *    handle in any signature — that much is the interface's doing.
 * 2. No transaction handle escapes `write()` EITHER. Its callback is handed a
 *    `Batch`, a three-method value object with `put`/`delete`/`clear` that
 *    return `void`. There is nothing there to await even by accident.
 * 3. Every callback that touches the store is synchronous by type. The two
 *    places that genuinely must read before writing — `seedIfPristine`, and a
 *    migration's `rewrite` — are written out longhand in this file, each with
 *    the sanctioned await marked, and neither takes a caller's function.
 *
 * That is the whole design. Everything below is bookkeeping around it.
 *
 *
 * `versionchange` MUST CLOSE THE CONNECTION
 *
 * When another tab opens the database at a higher version, every existing
 * connection gets `versionchange` (idb spells it `blocking`) and the upgrade
 * waits until they all close. A tab that ignores it holds every other tab in the
 * browser hostage indefinitely — no error, no timeout, just an app that never
 * boots. It is R-4, and it is invisible in development because you are only ever
 * running one build. So `blocking` closes immediately and refuses further work,
 * and the far side gives up after a grace period and reports `storage/blocked`
 * rather than hanging with a spinner.
 *
 * Closing is half of it; STAYING closed is the other half, and it is the half
 * that looks like a bug. A driver that reopened after `versionchange` would come
 * straight back at the old version and block the upgrade it had just stepped out
 * of the way of — and with two old tabs open, each reopening as the other
 * closes, neither upgrade ever runs. So `shutdown` is set once and never unset,
 * every call after it fails with `storage/blocked`, and the tab tells the user
 * to reload. "It just needs to reconnect" is the wrong instinct here: this
 * connection is the obstacle, and the page that owns it has to go.
 *
 *
 * DURABILITY IS `relaxed`, DELIBERATELY
 *
 * `strict` asks the OS to flush to physical media before the transaction
 * reports success, turning a 2 ms write into 20–50 ms. What it protects against
 * is an OS crash or power loss in the window between the write and the flush.
 * Nothing in a job tracker warrants paying that on every keystroke-driven save,
 * and the write-behind queue means the cost would land on a code path the user
 * is already watching.
 */

import { deleteDB, openDB } from 'idb'
import type { IDBPDatabase, IDBPObjectStore, IDBPTransaction } from 'idb'
import { createStoreChannel, nullChannel } from './channel'
import type { Channel } from './channel'
import { driverFail, driverOk } from './driver'
import type {
  Driver,
  DriverResult,
  DurableOp,
  OpenInfo,
  Rows,
  StorageFailureCode,
  StoreEvent,
} from './driver'
import { MIGRATIONS, pendingMigrations, versionOf } from './migrations'
import type { Migration, MigrationContext } from './migrations'
import type { IndexSpec, MetaRow, StoreName, StoreSpec, StoredRow } from './schema'
import { DB_NAME, STORE_NAMES } from './schema'

/**
 * How long we wait after learning our upgrade is blocked before giving up.
 *
 * Not zero: the usual cause is the user's other tab, and they close it. Not
 * unbounded: the other tab may be a pinned one they forgot in January, and an
 * app that waits forever for it is an app that never boots with no explanation.
 * Five seconds is §3.5's own escalation point — the moment the boot gate stops
 * showing skeletons and shows the recovery panel — so the driver gives up
 * exactly when the UI is ready to say something about it.
 */
const BLOCKED_GRACE_MS = 5_000

/** The store names as the DOM API wants them, once. */
const ALL_STORES: string[] = [...STORE_NAMES]

type AnyDb = IDBPDatabase<unknown>
type AnyTx = IDBPTransaction<unknown, string[], 'readwrite'>
type AnyStore = IDBPObjectStore<unknown, string[], string, 'readwrite'>

/**
 * The upgrade transaction, spelled `'versionchange'` rather than `'readwrite'`.
 *
 * Not cosmetic: `createIndex` and `deleteIndex` exist on an object store only in
 * versionchange mode, and idb encodes that in the type — read through a
 * `'readwrite'` handle they are `undefined`, which is the compiler catching a
 * genuine runtime `InvalidStateError` before it ships.
 */
type UpgradeTx = IDBPTransaction<unknown, string[], 'versionchange'>
type UpgradeStore = IDBPObjectStore<unknown, string[], string, 'versionchange'>

/**
 * What a write may do, and the whole of it.
 *
 * The type that makes move 2 of the module doc true. A `Batch` cannot be
 * awaited, cannot read, and cannot outlive the call it was passed to, because
 * there is nothing on it that returns a value.
 */
type Batch = {
  put(store: StoreName, key: string | number, value: StoredRow): void
  delete(store: StoreName, key: string | number): void
  clear(store: StoreName): void
}

/**
 * A `Batch` over a transaction, plus the first request error it saw.
 *
 * Individual request promises are caught rather than awaited — awaiting them one
 * at a time inside the loop would be correct but pointless, and leaving them
 * unhandled is an unhandled rejection that prints a second trace and, under
 * Node, can take the test process down.
 *
 * But they cannot merely be discarded. `tx.done` rejects with `tx.error`, and
 * `tx.error` is null for an abort triggered by a request nobody handled — so the
 * only thing left to report is a bare `AbortError`, which classifies as
 * `storage/unavailable` and sends the queue into a retry loop over a
 * `ConstraintError` that will fail identically every time. The first request
 * error is the specific one, it arrives before the abort, and it is what gets
 * reported.
 */
function makeBatch(tx: AnyTx): { batch: Batch; firstError: () => unknown } {
  let first: unknown = null

  const watch = (p: Promise<unknown>) => {
    void p.catch((e: unknown) => {
      first ??= e
    })
  }

  return {
    firstError: () => first,
    batch: {
      put(store, key, value) {
        const target = tx.objectStore(store) as AnyStore
        // `ops` is the one store with out-of-line keys, so it is the one that
        // takes a key argument. Passing one to an in-line store is a DataError,
        // and passing none to `ops` would silently autoIncrement past the
        // sequence the repository is keeping.
        watch(store === 'ops' ? target.put(value, key) : target.put(value))
      },
      delete(store, key) {
        watch((tx.objectStore(store) as AnyStore).delete(key))
      },
      clear(store) {
        watch((tx.objectStore(store) as AnyStore).clear())
      },
    },
  }
}

export type IdbDriverOptions = {
  /** Overridden by tests so two suites never share a database. */
  name?: string
  /** Overridden by tests to exercise an upgrade without shipping a fake step. */
  migrations?: readonly Migration[]
  /**
   * The cross-tab channel. `null` disables it.
   *
   * Injected rather than constructed unconditionally so a test can watch what
   * was posted, and so a second driver in the same process — which
   * BroadcastChannel WOULD deliver to, since they are different contexts under
   * `fake-indexeddb` — can be silenced.
   */
  channel?: Channel | null
  blockedGraceMs?: number
}

/* ------------------------------ error mapping ----------------------------- */

/**
 * The DOMException name, through whatever it was wrapped in.
 *
 * `tx.done` rejects with the transaction's error, but a quota failure in Chrome
 * arrives as an `AbortError` whose `cause` is the `QuotaExceededError` — and
 * reporting that as a generic abort is how "there is no room left" turns into a
 * retry loop that can never succeed. The queue treats quota as terminal
 * (queue.ts:53-56) and everything else as retryable, so getting this wrong does
 * not produce a wrong message, it produces an infinite one.
 */
function errorName(e: unknown): string {
  if (typeof e !== 'object' || e === null) return ''
  const error = e as { name?: unknown; cause?: unknown }
  if (typeof error.name === 'string' && error.name !== 'AbortError') return error.name
  if (error.cause !== undefined && error.cause !== e) {
    const inner = errorName(error.cause)
    if (inner) return inner
  }
  return typeof error.name === 'string' ? error.name : ''
}

const messageOf = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : String(e)

/**
 * A thrown DOMException, as one of the four codes the app knows how to answer.
 *
 * Every arm is a recovery the user can be told about, which is why the default
 * is `unavailable` rather than `corrupt`: "we could not reach storage" invites a
 * retry, "your data could not be read" invites the recovery panel, and guessing
 * the second when it was the first would offer to start somebody fresh over a
 * transient failure.
 */
function classify<T>(e: unknown, what: string): DriverResult<T> {
  const name = errorName(e)
  const detail = `${what}: ${name || 'error'} — ${messageOf(e)}`

  const code: StorageFailureCode =
    name === 'QuotaExceededError'
      ? 'storage/quota'
      : name === 'VersionError'
        ? // The store on disk is NEWER than this build knows how to open, which
          // happens the moment a user reloads one tab and not another after a
          // deploy. Not corruption — the data is fine and a reload fixes it —
          // so it takes the code whose recovery is "close the other one and try
          // again" rather than the one that offers to start fresh.
          'storage/blocked'
        : name === 'ConstraintError' || name === 'DataError' || name === 'DataCloneError'
          ? 'storage/corrupt'
          : 'storage/unavailable'

  return driverFail<T>(code, detail, { name, operation: what })
}

/* ------------------------------- migrations ------------------------------- */

/**
 * The `MigrationContext` over a live upgrade transaction.
 *
 * The one place in the codebase where a transaction handle is held in a closure,
 * and it is bounded by the upgrade callback: `openDB` does not return until the
 * `versionchange` transaction is done, so the context cannot outlive it and be
 * called against a dead handle later.
 */
function migrationContext(db: AnyDb, tx: UpgradeTx, from: number, to: number): MigrationContext {
  const storeOf = (name: StoreName): UpgradeStore => tx.objectStore(name) as UpgradeStore

  return {
    from,
    to,

    hasStore: (name) => db.objectStoreNames.contains(name),

    createStore(spec: StoreSpec) {
      db.createObjectStore(
        spec.name,
        spec.keyPath === null
          ? { autoIncrement: spec.autoIncrement ?? false }
          : { keyPath: spec.keyPath, autoIncrement: spec.autoIncrement ?? false },
      )
    },

    deleteStore: (name) => db.deleteObjectStore(name),

    hasIndex: (store, index) => storeOf(store).indexNames.contains(index),

    createIndex(store: StoreName, index: IndexSpec) {
      storeOf(store).createIndex(
        index.name,
        // A readonly array is a compound key path; the DOM signature wants a
        // mutable one, and spreading is cheaper than widening the spec type and
        // letting a migration mutate the catalogue it was handed.
        Array.isArray(index.keyPath) ? [...index.keyPath] : (index.keyPath as string),
        { unique: index.unique ?? false },
      )
    },

    deleteIndex: (store, index) => storeOf(store).deleteIndex(index),

    async rewrite(store, fn) {
      // THE SANCTIONED AWAIT. Every one of these is a request of `tx` itself,
      // which is what keeps the versionchange transaction alive across the
      // loop. Adding any other await inside this function ends the upgrade
      // mid-way and leaves the user's database at a version that has some of
      // the new schema and none of the new data.
      let cursor = await storeOf(store).openCursor()
      while (cursor) {
        const next = fn(cursor.value as StoredRow)
        if (next === null) await cursor.delete()
        else if (next !== cursor.value) await cursor.update(next)
        cursor = await cursor.continue()
      }
    },
  }
}

/* --------------------------------- events --------------------------------- */

/**
 * The commit event a batch describes, read off the batch itself.
 *
 * The driver has no clock — D26 applies here as much as anywhere, and
 * `check-platform.mjs` enforces it on this layer specifically — so the event's
 * timestamp cannot be minted. It does not need to be: every commit carries its
 * journal row, and the journal row was stamped by the repository with the time
 * the user's action actually happened, which is the more useful answer anyway.
 */
function commitEvent(ops: readonly DurableOp[]): StoreEvent | null {
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    const op = ops[i]
    if (op === undefined || op.kind !== 'put' || op.store !== 'ops') continue
    const id = op.value['id']
    const at = op.value['at']
    if (typeof id === 'string' && typeof at === 'string') return { kind: 'commit', at, entryId: id }
  }
  return null
}

/** A wholesale replace has no journal row, so its instant comes off the meta row. */
function replaceEvent(rows: Rows): StoreEvent | null {
  for (const row of rows.meta) {
    const value = row.value
    if (typeof value !== 'object' || value === null) continue
    const at = (value as Record<string, unknown>)['lastOpenedAt']
    if (typeof at === 'string') return { kind: 'commit', at, entryId: '' }
  }
  return null
}

/* --------------------------------- driver --------------------------------- */

export function createIdbDriver(options: IdbDriverOptions = {}): Driver {
  const name = options.name ?? DB_NAME
  const migrations = options.migrations ?? MIGRATIONS
  const version = versionOf(migrations)
  const grace = options.blockedGraceMs ?? BLOCKED_GRACE_MS
  const channel =
    options.channel === undefined ? createStoreChannel(name) : (options.channel ?? nullChannel)

  let db: AnyDb | null = null
  let info: OpenInfo | null = null
  let opening: Promise<DriverResult<OpenInfo>> | null = null
  /**
   * Set by `blocking`, `terminated` and `close`, and never unset.
   *
   * A driver that reopened after `versionchange` would race straight back into
   * the upgrade it had just stood aside for, and the two tabs would take turns
   * blocking each other forever. The tab that closed stays closed until the page
   * reloads, which is exactly what the UI tells the user to do.
   */
  let shutdown: 'blocking' | 'terminated' | 'closed' | null = null

  const blockingListeners = new Set<() => void>()

  const announceBlocking = () => {
    for (const fn of [...blockingListeners]) fn()
  }

  const stop = (reason: 'blocking' | 'terminated' | 'closed') => {
    if (shutdown) return
    shutdown = reason
    db?.close()
    db = null
  }

  const shutdownFailure = <T>(): DriverResult<T> =>
    shutdown === 'blocking'
      ? driverFail<T>('storage/blocked', 'closed so another tab could upgrade the database')
      : shutdown === 'terminated'
        ? driverFail<T>('storage/unavailable', 'the browser closed the database connection')
        : driverFail<T>('storage/unavailable', 'the driver is closed')

  /* --------------------------------- open --------------------------------- */

  async function openOnce(): Promise<DriverResult<OpenInfo>> {
    if (typeof indexedDB === 'undefined') {
      return driverFail<OpenInfo>('storage/unavailable', 'this runtime has no IndexedDB')
    }

    let from = version
    const migrated: string[] = []
    let upgradeError: unknown = null

    /**
     * Resolved only if `blocked` fires AND the grace period elapses.
     *
     * `openDB`'s promise stays pending for as long as another tab holds an older
     * connection — there is no timeout in the platform. Racing against this
     * deferred is what turns "the app hangs forever with no message" into a
     * `storage/blocked` the boot gate can render.
     */
    let giveUp: (() => void) | null = null
    const blockedSignal = new Promise<'blocked'>((resolve) => {
      giveUp = () => resolve('blocked')
    })
    let blockedTimer: ReturnType<typeof setTimeout> | null = null

    const opened = openDB(name, version, {
      upgrade(database, oldVersion, newVersion, tx) {
        from = oldVersion
        const ctx = migrationContext(
          database as AnyDb,
          tx as unknown as UpgradeTx,
          oldVersion,
          newVersion ?? version,
        )
        const steps = pendingMigrations(migrations, oldVersion)

        // idb caches a `done` promise for every transaction, including this one,
        // and aborting rejects it. Nothing awaits the upgrade transaction — the
        // failure is reported through `openDB`'s own rejection — so without this
        // a rolled-back migration surfaces as an unhandled rejection: a second,
        // less informative trace beside the real error, and a process exit under
        // Node.
        void tx.done.catch(() => {})

        /**
         * Recorded and aborted. Aborting is what gives R-1(b) its guarantee —
         * a step that throws rolls the WHOLE upgrade back and leaves the user
         * cleanly at the old version, rather than at a version whose name says
         * it has an index it does not have.
         */
        const failUpgrade = (e: unknown) => {
          upgradeError = e
          try {
            tx.abort()
          } catch {
            // Already finished. The rollback we wanted has happened anyway;
            // `upgradeError` is what the open reports either way.
          }
        }

        /**
         * The steps, driven WITHOUT an `await` unless a step returns a promise.
         *
         * The obvious spelling is `for (const step of steps) await step.run(ctx)`
         * and it is wrong in a way that only bites the second step. A
         * versionchange transaction is deactivated the moment the upgradeneeded
         * handler returns to the event loop, and `await undefined` — which is
         * what awaiting a synchronous step gives you — is a microtask, which is
         * enough. Step two's `createObjectStore` then throws
         * `TransactionInactiveError`, on an upgrade, on a real user's only copy
         * of their records, and never once in a test that ships a single step.
         *
         * So a synchronous step is called synchronously and the loop continues
         * in the same turn. A step that returns a promise gets one, because that
         * promise can only have come from `ctx.rewrite` — the sole async member
         * of the context — and a rewrite's promise resolves inside a cursor
         * request's success event, where the transaction is active again.
         */
        const drive = (start: number): void => {
          for (let i = start; i < steps.length; i += 1) {
            const step = steps[i]
            if (step === undefined) continue

            migrated.push(step.name)
            let result: void | Promise<void>
            try {
              result = step.run(ctx)
            } catch (e) {
              failUpgrade(e)
              return
            }

            if (result) {
              const next = i + 1
              void result.then(() => drive(next), failUpgrade)
              return
            }
          }
        }

        drive(0)
      },

      blocked() {
        // We are the tab trying to upgrade; an older connection is in the way.
        blockedTimer ??= setTimeout(() => giveUp?.(), grace)
      },

      blocking() {
        // Another tab is trying to upgrade and WE are in the way. R-4: close
        // now, refuse everything after, and tell the app so it can say
        // "jojo was updated in another tab. Reload to continue."
        stop('blocking')
        announceBlocking()
      },

      terminated() {
        // The browser dropped the connection under us — eviction, a crashed
        // storage process, or the user clearing site data from settings. Not
        // recoverable in this page: reopening would silently create an empty
        // database and the app would look like it had lost everything.
        stop('terminated')
        announceBlocking()
      },
    })

    const race = await Promise.race([
      opened.then(
        (value) => ({ kind: 'db' as const, value }),
        (error: unknown) => ({ kind: 'error' as const, error }),
      ),
      blockedSignal.then(() => ({ kind: 'blocked' as const })),
    ])

    if (blockedTimer !== null) clearTimeout(blockedTimer)

    if (race.kind === 'blocked') {
      // The open may still succeed later, when the other tab finally closes.
      // Left unhandled it would leak a connection that then blocks the NEXT
      // upgrade — the deadlock we just declined to be part of, one version on.
      void opened.then(
        (late) => late.close(),
        () => {},
      )
      return driverFail<OpenInfo>(
        'storage/blocked',
        'another tab is holding an older version of the database open',
      )
    }

    if (race.kind === 'error') {
      // The upgrade's own exception, not the abort it caused. `tx.abort()` makes
      // `openDB` reject with an AbortError, and reporting that would name the
      // mechanism instead of the migration that failed.
      const cause = upgradeError ?? race.error
      return classify<OpenInfo>(cause, upgradeError ? 'migrate' : 'open')
    }

    db = race.value
    info = { version, from, migrated }
    return driverOk(info)
  }

  /**
   * One open per driver, shared by every concurrent caller.
   *
   * StrictMode mounts twice and `boot()` is called from a provider, so two opens
   * of the same database land in the same tick. Two `openDB` calls at the same
   * version are harmless in IndexedDB but produce two connections, and the
   * second one is the one that blocks the next upgrade forever.
   */
  async function ensureOpen(): Promise<DriverResult<OpenInfo>> {
    if (shutdown) return shutdownFailure<OpenInfo>()
    if (db && info) return driverOk(info)
    opening ??= openOnce().finally(() => {
      opening = null
    })
    return opening
  }

  /* --------------------------------- write -------------------------------- */

  /**
   * The single write entry point. One transaction over all four stores.
   *
   * All four every time, because a store cannot be added to a live transaction
   * and discovering that mid-batch would mean splitting the write in two — two
   * transactions, no atomicity, and the half-write back. At this scale the extra
   * locks cost nothing measurable.
   */
  async function write(apply: (batch: Batch) => void, what: string): Promise<DriverResult<void>> {
    const opened = await ensureOpen()
    if (!opened.ok) return { ok: false, error: opened.error }
    const database = db
    if (!database) return shutdownFailure<void>()

    // Opening the transaction is inside the try as well as writing to it.
    // `transaction()` throws `InvalidStateError` on a connection that closed
    // between `ensureOpen` resolving and this line — which is precisely what the
    // `blocking` handler does, so it is not a theoretical window.
    try {
      const tx = database.transaction(ALL_STORES, 'readwrite', {
        durability: 'relaxed',
      }) as unknown as AnyTx
      const { batch, firstError } = makeBatch(tx)

      try {
        apply(batch)
        await tx.done
        return driverOk(undefined)
      } catch (e) {
        return classify<void>(firstError() ?? e, what)
      }
    } catch (e) {
      return classify<void>(e, what)
    }
  }

  /* -------------------------------- reading ------------------------------- */

  const readAll = async (): Promise<DriverResult<Rows>> => {
    const opened = await ensureOpen()
    if (!opened.ok) return { ok: false, error: opened.error }
    const database = db
    if (!database) return shutdownFailure<Rows>()

    try {
      const tx = database.transaction(ALL_STORES, 'readonly')
      // All four requests are issued in this turn, before the first await, so
      // the transaction never sees an idle moment. Reading them one at a time
      // with an await between would work — each await is a request of this
      // transaction — but it would also be four round trips where one will do.
      const [nodes, edges, meta, ops] = await Promise.all([
        tx.objectStore('nodes').getAll(),
        tx.objectStore('edges').getAll(),
        tx.objectStore('meta').getAll(),
        tx.objectStore('ops').getAll(),
      ])
      await tx.done

      return driverOk({
        nodes: nodes as StoredRow[],
        edges: edges as StoredRow[],
        meta: meta as MetaRow[],
        ops: ops as StoredRow[],
      })
    } catch (e) {
      return classify<Rows>(e, 'readAll')
    }
  }

  /* -------------------------------- the API ------------------------------- */

  const commit = async (ops: readonly DurableOp[]): Promise<DriverResult<void>> => {
    if (ops.length === 0) return driverOk(undefined)

    const written = await write((batch) => {
      for (const op of ops) {
        if (op.kind === 'clear') batch.clear(op.store)
        else if (op.kind === 'delete') batch.delete(op.store, op.key)
        else batch.put(op.store, op.key, op.value)
      }
    }, 'commit')

    // Posted only on success, and only after `tx.done` resolved. A tab told
    // "something changed" before the rows are readable would flush, rehydrate,
    // read the OLD state and settle there — which on screen looks exactly like
    // the other tab's edit being undone a moment after it appeared.
    if (written.ok) {
      const event = commitEvent(ops)
      if (event) channel.post(event)
    }
    return written
  }

  const rowsIntoBatch = (batch: Batch, rows: Rows) => {
    for (const store of STORE_NAMES) batch.clear(store)
    for (const row of rows.nodes) batch.put('nodes', String(row['id'] ?? ''), row)
    for (const row of rows.edges) batch.put('edges', String(row['id'] ?? ''), row)
    for (const row of rows.meta) batch.put('meta', row.key, row)
    // Renumbered from 1. The keys are a private sequence, not an identity —
    // `boot` continues from the count it read back — so preserving gaps left by
    // an earlier prune would only make the next continuation collide.
    rows.ops.forEach((row, index) => batch.put('ops', index + 1, row))
  }

  const replace = async (rows: Rows): Promise<DriverResult<void>> => {
    const written = await write((batch) => rowsIntoBatch(batch, rows), 'replace')
    if (written.ok) {
      const event = replaceEvent(rows)
      if (event) channel.post(event)
    }
    return written
  }

  /**
   * Seed and meta in one transaction, and only onto a store nobody has claimed.
   *
   * The emptiness test is inside the transaction on purpose — see the comment on
   * `Driver.seedIfPristine`. The `await` below is the second sanctioned one in
   * this file: `count()` is a request of `tx`, so the transaction is still live
   * when the writes are issued on the next line.
   */
  const seedIfPristine = async (rows: Rows): Promise<DriverResult<boolean>> => {
    const opened = await ensureOpen()
    if (!opened.ok) return { ok: false, error: opened.error }
    const database = db
    if (!database) return shutdownFailure<boolean>()

    let tx: AnyTx
    try {
      tx = database.transaction(ALL_STORES, 'readwrite', {
        durability: 'relaxed',
      }) as unknown as AnyTx
    } catch (e) {
      return classify<boolean>(e, 'seedIfPristine')
    }
    const { batch, firstError } = makeBatch(tx)

    try {
      const already = await (tx.objectStore('meta') as AnyStore).count()
      if (already > 0) {
        // Committed empty rather than aborted. An abort rejects `tx.done`, and
        // "somebody else seeded first" is the expected outcome of a race, not a
        // failure to report.
        await tx.done
        return driverOk(false)
      }

      rowsIntoBatch(batch, rows)
      await tx.done

      const event = replaceEvent(rows)
      if (event) channel.post(event)
      return driverOk(true)
    } catch (e) {
      return classify<boolean>(firstError() ?? e, 'seedIfPristine')
    }
  }

  const destroy = async (): Promise<DriverResult<void>> => {
    if (typeof indexedDB === 'undefined') {
      return driverFail<void>('storage/unavailable', 'this runtime has no IndexedDB')
    }
    // Closed first, unconditionally. `deleteDatabase` with our own connection
    // still open fires `blocked` against us and waits — on ourselves, forever.
    db?.close()
    db = null
    info = null

    try {
      // `deleteDB` resolves only once the delete actually completes, which for a
      // delete another tab is blocking means once that tab closes. Reaching the
      // next line therefore means it is gone — the `blocked` callback is
      // supplied so idb does not warn, not because there is a decision to make.
      await deleteDB(name, { blocked: () => {} })
      return driverOk(undefined)
    } catch (e) {
      return classify<void>(e, 'destroy')
    }
  }

  return {
    open: ensureOpen,
    readAll,
    commit,
    replace,
    seedIfPristine,
    destroy,

    onRemoteCommit: (fn) => channel.subscribe(fn),

    onBlocking(fn) {
      blockingListeners.add(fn)
      return () => {
        blockingListeners.delete(fn)
      }
    },

    close() {
      stop('closed')
      channel.close()
      blockingListeners.clear()
    },
  }
}
