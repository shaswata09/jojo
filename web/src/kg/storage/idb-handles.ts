/**
 * L0 — the five `idb` handle types the driver and its helpers pass around.
 *
 * Types only, and this is the one other file under src/kg that names `idb` at
 * all. `idb-driver.ts` remains the only file that IMPORTS it at runtime —
 * `openDB` and `deleteDB` are there and nowhere else — so the platform coupling
 * is still one module. What is here erases at compile time under
 * `verbatimModuleSyntax`, and it exists so that `idb-batch.ts` and
 * `idb-migrate.ts` can be given a transaction handle without either of them
 * re-deriving these five aliases or widening them to `unknown` and casting,
 * which would throw away the compiler check the `UpgradeTx` note below is about.
 */

import type { IDBPDatabase, IDBPObjectStore, IDBPTransaction } from 'idb'

export type AnyDb = IDBPDatabase<unknown>
export type AnyTx = IDBPTransaction<unknown, string[], 'readwrite'>
export type AnyStore = IDBPObjectStore<unknown, string[], string, 'readwrite'>

/**
 * The upgrade transaction, spelled `'versionchange'` rather than `'readwrite'`.
 *
 * Not cosmetic: `createIndex` and `deleteIndex` exist on an object store only in
 * versionchange mode, and idb encodes that in the type — read through a
 * `'readwrite'` handle they are `undefined`, which is the compiler catching a
 * genuine runtime `InvalidStateError` before it ships.
 */
export type UpgradeTx = IDBPTransaction<unknown, string[], 'versionchange'>
export type UpgradeStore = IDBPObjectStore<unknown, string[], string, 'versionchange'>
