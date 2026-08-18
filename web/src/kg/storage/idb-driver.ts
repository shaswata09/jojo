/**
 * L0 — the `idb` implementation of Driver. The ONLY file importing `idb`.
 *
 * The pieces that are about a shape rather than about the connection live
 * beside it, so that this file is the connection and its lifetime and nothing
 * else: `idb-handles.ts` (the five handle types), `idb-batch.ts` (what a write
 * may do), `idb-migrate.ts` (what a migration step may do), `idb-errors.ts`
 * (which failure code a DOMException becomes) and `idb-events.ts` (what the
 * cross-tab channel is told). Only `idb-handles.ts` names `idb` at all, and
 * only in type position — `openDB` and `deleteDB` are here and nowhere else.
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
 *    migration's `rewrite` — are written out longhand, each with the sanctioned
 *    await marked, and neither takes a caller's function.
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
import { createStoreChannel, nullChannel } from './channel'
import type { Channel } from './channel'
import { driverFail, driverOk } from '@jojo/service/storage/driver'
import type { Driver, DriverResult, DurableOp, OpenInfo, Rows } from '@jojo/service/storage/driver'
import { makeBatch } from './idb-batch'
import type { Batch } from './idb-batch'
import { classify, messageOf } from '@jojo/service/storage/idb-errors'
import { commitEvent, replaceEvent } from './idb-events'
import type { AnyDb, AnyStore, AnyTx, UpgradeTx } from './idb-handles'
import { migrationContext } from './idb-migrate'
import { MIGRATIONS, pendingMigrations, versionOf } from '@jojo/service/storage/migrations'
import type { Migration } from '@jojo/service/storage/migrations'
import type { MetaRow, StoredRow } from '@jojo/service/storage/schema'
import { DB_NAME, STORE_NAMES } from '@jojo/service/storage/schema'

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

  /**
   * `indexedDB`, or a failure — because READING it can throw.
   *
   * `typeof indexedDB === 'undefined'` looks like the complete guard and is not.
   * An origin with site data blocked, and a sandboxed iframe without
   * `allow-same-origin`, both install a throwing accessor: touching the
   * identifier at all raises `SecurityError`, so the guard is itself the throw
   * site. Uncaught, that rejects `open()` instead of returning a `DriverResult`,
   * which breaks the contract at `driver.ts` and — because nothing above catches
   * — leaves the boot gate on its skeleton forever, under a message about other
   * tabs that is not true.
   */
  function reachIndexedDb(): DriverResult<IDBFactory> {
    try {
      if (typeof indexedDB === 'undefined' || indexedDB === null) {
        return driverFail<IDBFactory>('storage/unavailable', 'this runtime has no IndexedDB')
      }
      return driverOk(indexedDB)
    } catch (e) {
      // Reading the global threw. Same user-visible outcome as not having it —
      // run in memory and say so — so it takes the same code.
      return driverFail<IDBFactory>(
        'storage/unavailable',
        `this browser refused access to IndexedDB — ${messageOf(e)}`,
      )
    }
  }

  async function openOnce(): Promise<DriverResult<OpenInfo>> {
    const reached = reachIndexedDb()
    if (!reached.ok) return { ok: false, error: reached.error }

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

    /**
     * Assigned inside a `try`, because `openDB` can throw before it returns.
     *
     * `idb` calls `indexedDB.open()` synchronously, and that call raises
     * `SecurityError` — not a rejected request, a thrown exception — when the
     * origin's storage is blocked by policy. Outside a `try` it escapes
     * `openOnce`, and every caller below is written against a `DriverResult`
     * that never arrives.
     */
    let opened: Promise<AnyDb>
    try {
      opened = openDB(name, version, {
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
    } catch (e) {
      if (blockedTimer !== null) clearTimeout(blockedTimer)
      return classify<OpenInfo>(e, 'open')
    }

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
    info = { version, from, migrated, crossTab: channel.crossTab }
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
  /**
   * Rolls a transaction back, for the failure that does NOT roll itself back.
   *
   * A request that fails aborts its transaction on its own, so a
   * `ConstraintError` mid-batch was always all-or-nothing. A `put` that throws
   * SYNCHRONOUSLY never creates a request — `DataCloneError` on a value the
   * structured clone algorithm refuses is the reachable case — so the throw
   * escaped the loop, the requests already issued stayed issued, and the
   * transaction committed them on the way out. `commit` then reported failure
   * over a store that had taken half the batch: R-3's half-write, with no
   * journal entry describing the state it left behind, and now permanent,
   * because `storage/corrupt` stops the write queue rather than retrying it.
   *
   * `tx.done` is swallowed rather than awaited: aborting rejects it, nothing
   * downstream awaits it on this path, and an unhandled rejection here prints a
   * second trace over the real error and can take the test process down.
   */
  function rollBack(tx: AnyTx): void {
    try {
      tx.abort()
    } catch {
      // Already finished — the rollback we wanted has happened anyway, or the
      // transaction committed before we got here and there is nothing to undo.
    }
    void tx.done.catch(() => {})
  }

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
        rollBack(tx)
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
    // Renumbered from 1, into a store this same batch has just cleared. The keys
    // are ordering and nothing else: `readAll` reads every store with `getAll()`,
    // which hands back values and never keys, so no caller above has ever seen
    // one. This used to say `boot` continues from the count it read back — it
    // does not, and has not since journal appends became `key: null` and the
    // store's own generator took over. What the explicit keys still owe is the
    // ORDER, which is the whole of what an audit log is; a later append lands
    // above them because a key generator is not rewound by `clear()` and an
    // explicit numeric key pushes it past itself.
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
   * the adapter — the other is `rewrite` in `idb-migrate.ts`: `count()` is a
   * request of `tx`, so the transaction is still live when the writes are
   * issued on the next line.
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
      // Same rollback as `write`, and for the same reason: `rowsIntoBatch` can
      // throw part-way through a seed, and a half-seeded store is one a later
      // `seedIfPristine` would decline to fix.
      rollBack(tx)
      return classify<boolean>(firstError() ?? e, 'seedIfPristine')
    }
  }

  const destroy = async (): Promise<DriverResult<void>> => {
    const reached = reachIndexedDb()
    if (!reached.ok) return { ok: false, error: reached.error }
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
