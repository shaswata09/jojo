/**
 * L0 — MIGRATIONS[] and SCHEMA_VERSION. Append-only.
 *
 * A migration is never edited once shipped: a user's IndexedDB is the only copy
 * of their records, and rewriting step 3 means everyone who already ran step 3
 * gets a store nobody has ever tested. Fix forward with a new step. A step that
 * throws rolls the whole upgrade back, leaving the user cleanly at the old
 * version — the recoverable failure, and the only one worth designing for.
 *
 *
 * WHY A STEP TAKES A CONTEXT AND NOT A DATABASE
 *
 * The obvious shape is `run(db, tx)` with idb's own types, and it is the shape
 * that makes migrations untestable. A step written against a live database can
 * only be exercised by opening one, which means the v1-fixture rule in R-1(c) —
 * keep the shape a migration migrates FROM, forever, and test against it — costs
 * a browser or a fake for every step ever shipped. Against `MigrationContext` a
 * step is a pure function of an interface with six members, and the fixture is a
 * list of rows.
 *
 * It also keeps `idb` out of this file, which matters for a second reason: this
 * module is imported by `repo/meta.ts` for `SCHEMA_VERSION`, and a `DBSchema`
 * type here would put an edge from the repository to a browser-only package.
 *
 *
 * THE ONE AWAIT A MIGRATION MAY PERFORM
 *
 * `ctx.rewrite` and nothing else. An IndexedDB upgrade runs inside a
 * `versionchange` transaction which auto-commits the moment control returns to
 * the event loop, so `await somethingElse()` mid-migration ends the transaction
 * and the next statement throws `TransactionInactiveError` — after some of the
 * schema changes have already landed. `rewrite` awaits cursor requests of the
 * upgrade transaction itself, which is the one form that keeps it alive. There is
 * no other async member on the context, so the trap is not available to reach.
 */

import type { IndexSpec, StoreName, StoreSpec, StoredRow } from './schema'
import { STORE_SPECS } from './schema'

export type MigrationContext = {
  /** The version on disk. 0 on a fresh database. */
  readonly from: number
  readonly to: number

  hasStore(name: StoreName): boolean
  createStore(spec: StoreSpec): void
  deleteStore(name: StoreName): void

  hasIndex(store: StoreName, index: string): boolean
  createIndex(store: StoreName, index: IndexSpec): void
  deleteIndex(store: StoreName, index: string): void

  /**
   * Read-modify-write every row of a store, in key order.
   *
   * Return the row to keep it, a new row to replace it, or null to delete it.
   * The only awaitable thing a migration is given — see the module doc.
   */
  rewrite(store: StoreName, fn: (row: StoredRow) => StoredRow | null): Promise<void>
}

export type Migration = {
  /** The version this step brings the database TO. Strictly ascending. */
  readonly version: number
  /** Logged, and reported in `OpenInfo.migrated`. Written for a bug report. */
  readonly name: string
  /**
   * Synchronous unless it uses `ctx.rewrite`, and then it returns that promise.
   *
   * Not a style preference. The runner calls a step and only awaits it when it
   * actually returned something, because `await undefined` is still a microtask
   * and a microtask is enough for the versionchange transaction to deactivate —
   * which makes the NEXT step's `createObjectStore` throw. Marking a
   * schema-only step `async` for symmetry is therefore a real bug, and one that
   * only shows up once a second step exists. See the `drive` loop in
   * `idb-driver.ts` for the whole of it.
   */
  readonly run: (ctx: MigrationContext) => void | Promise<void>
}

/**
 * Every step ever shipped, oldest first.
 *
 * Append here. Never edit an entry, never renumber, never remove one — a user
 * three versions behind runs every step between their version and the current
 * one, in this order, and a gap is a store that never gets its index.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'create-stores',
    run: (ctx) => {
      for (const spec of STORE_SPECS) {
        if (!ctx.hasStore(spec.name)) ctx.createStore(spec)
        for (const index of spec.indexes) {
          if (!ctx.hasIndex(spec.name, index.name)) ctx.createIndex(spec.name, index)
        }
      }
    },
  },
]

/**
 * The highest version any step brings the database to.
 *
 * Derived rather than written down, because the two drifting is a silent
 * failure: a constant one behind the list means the last migration never runs
 * and the index it creates is missing on every machine that was already open.
 */
export function versionOf(migrations: readonly Migration[]): number {
  let version = 1
  for (const migration of migrations) version = Math.max(version, migration.version)
  return version
}

export const SCHEMA_VERSION = versionOf(MIGRATIONS)

/**
 * The steps a database at `from` still has to run, in order.
 *
 * `<=` rather than `<`: a database reporting version 3 has already run step 3.
 * Off by one here re-runs the last migration on every open, which for a schema
 * step is a `ConstraintError` and for a data step is the rewrite applied twice.
 */
export function pendingMigrations(
  migrations: readonly Migration[],
  from: number,
): readonly Migration[] {
  return [...migrations]
    .sort((a, b) => a.version - b.version)
    .filter((migration) => migration.version > from)
}
