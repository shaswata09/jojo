/**
 * L0 — `Batch`, the only thing a write is handed.
 *
 * This is move 2 of the transaction-lifetime design written out at the top of
 * `idb-driver.ts`: no transaction handle escapes `write()` either. It lives in
 * its own file because it is the enforcement, not a detail of it — anything
 * added here is something a caller can newly do inside somebody else's
 * transaction, which is exactly the review that should be hard to skip.
 */

import type { AnyStore, AnyTx } from './idb-handles'
import type { StoreName, StoredRow } from '@jojo/service/storage/schema'

/**
 * What a write may do, and the whole of it.
 *
 * The type that makes move 2 of the module doc true. A `Batch` cannot be
 * awaited, cannot read, and cannot outlive the call it was passed to, because
 * there is nothing on it that returns a value.
 */
export type Batch = {
  /** `key: null` hands allocation to the store. `ops` only — see `DurableOp`. */
  put(store: StoreName, key: string | number | null, value: StoredRow): void
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
export function makeBatch(tx: AnyTx): { batch: Batch; firstError: () => unknown } {
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
        // can take a key argument. Passing one to an in-line store is a
        // DataError, so those never do.
        //
        // Passing NO key to `ops` is the journal's normal path and the point of
        // the `null`: the store's key generator allocates, which is the only
        // allocator two tabs share. The explicit-key branch is for the two
        // wholesale rewrites — `replace` and the audit prune — which renumber
        // from 1 inside a transaction that has just cleared the store.
        watch(
          store === 'ops'
            ? key === null
              ? target.put(value)
              : target.put(value, key)
            : target.put(value),
        )
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
