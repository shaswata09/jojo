/**
 * L0 — the `MigrationContext` a migration step is run against.
 *
 * `migrations.ts` holds the table of steps and the version arithmetic; this
 * holds the implementation of the verbs those steps call, over a live
 * `versionchange` transaction supplied by `idb-driver.ts`. Kept apart from the
 * driver because it is the only code in the layer that may create and delete
 * stores and indexes, and because `rewrite` is one of the two sanctioned awaits
 * in the whole adapter — see the note on it below.
 */

import type { AnyDb, UpgradeStore, UpgradeTx } from './idb-handles'
import type { MigrationContext } from './migrations'
import type { IndexSpec, StoreName, StoreSpec, StoredRow } from './schema'

/**
 * The `MigrationContext` over a live upgrade transaction.
 *
 * The one place in the codebase where a transaction handle is held in a closure,
 * and it is bounded by the upgrade callback: `openDB` does not return until the
 * `versionchange` transaction is done, so the context cannot outlive it and be
 * called against a dead handle later.
 */
export function migrationContext(
  db: AnyDb,
  tx: UpgradeTx,
  from: number,
  to: number,
): MigrationContext {
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
