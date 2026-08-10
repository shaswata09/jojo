/**
 * L0 — the Driver interface every storage backend implements.
 *
 * Never throws. Every method returns a Result and expected failures are codes, so
 * a quota error is a banner rather than an unhandled rejection inside a promise
 * nobody awaited.
 *
 * `DriverResult` is deliberately not `core/result.ts`'s `Result`. The spec writes
 * the latter, but `Result<T>`'s failure arm is a `KgError` — a class in L1, and
 * L0 may not import L1. The two are structurally the same discriminated union, so
 * `repo` unwraps a `DriverFailure` and mints the `KgError` from it in one place.
 * That split is worth having anyway: `KgError.userMessage` is toast copy, and
 * copy written down here would be a UI string in the layer that is supposed to
 * know only about rows.
 *
 * Transaction discipline, stated as a rule and made unrepresentable: no
 * transaction handle escapes the driver. There is no `begin()` on this interface
 * and no handle in any signature, because the failure it prevents is silent —
 * `await` anything that is not an IDB request of the current transaction and the
 * turn ends, the transaction auto-commits, and the next call throws
 * `TransactionInactiveError`, sometimes after half the writes have landed.
 */

import type { Instant, MetaRow, StoreName, StoredRow } from './schema'

/**
 * The four failures a store can hand back, and no others.
 *
 * Spelled the same way as `KgErrorCode`'s storage arm so the conversion in
 * `repo` is a widening rather than a lookup table that can fall out of step.
 */
export type StorageFailureCode =
  'storage/unavailable' | 'storage/quota' | 'storage/blocked' | 'storage/corrupt'

export type DriverFailure = {
  readonly code: StorageFailureCode
  /** Logged, never shown. The user-facing sentence is minted in `repo`. */
  readonly message: string
  readonly context?: Readonly<Record<string, unknown>>
}

export type DriverResult<T> = { ok: true; value: T } | { ok: false; error: DriverFailure }

export const driverOk = <T>(value: T): DriverResult<T> => ({ ok: true, value })

export const driverFail = <T>(
  code: StorageFailureCode,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): DriverResult<T> =>
  context === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, context } }

export type DurableOp =
  | { kind: 'put'; store: StoreName; key: string | number; value: StoredRow }
  | { kind: 'delete'; store: StoreName; key: string | number }
  | { kind: 'clear'; store: StoreName }

export type Rows = {
  nodes: readonly StoredRow[]
  edges: readonly StoredRow[]
  meta: readonly MetaRow[]
  ops: readonly StoredRow[]
}

export const emptyRows = (): Rows => ({ nodes: [], edges: [], meta: [], ops: [] })

export type OpenInfo = { version: number; from: number; migrated: readonly string[] }

/** What another tab tells us it did. The payload is deliberately not a delta. */
export type StoreEvent = { kind: 'commit'; at: Instant; entryId: string }

export interface Driver {
  open(): Promise<DriverResult<OpenInfo>>
  readAll(): Promise<DriverResult<Rows>>
  /** All ops in ONE readwrite transaction over all four stores. Atomic. */
  commit(ops: readonly DurableOp[]): Promise<DriverResult<void>>
  /** Wholesale replace in one transaction: demo / empty / import. */
  replace(rows: Rows): Promise<DriverResult<void>>
  /**
   * Writes `rows` only if the `meta` store is still empty. Reports whether it did.
   *
   * The first-run seed, and the reason it is a driver method rather than a
   * `readAll` followed by a `replace`. R-11: an impatient reload during a slow
   * first boot, or simply two tabs opened at once on a fresh install, gives two
   * seeders that both read "no meta" and both write — 182 nodes, every record
   * doubled, and no way to tell which of each pair the user then edited. The
   * emptiness test has to happen inside the transaction that does the writing,
   * and a transaction never leaves the driver.
   *
   * `false` is a normal outcome and not a failure: it means somebody else got
   * there first, and the caller's job is to read what they wrote.
   */
  seedIfPristine(rows: Rows): Promise<DriverResult<boolean>>
  /** deleteDatabase. Backs Settings' "clear browser storage". */
  destroy(): Promise<DriverResult<void>>
  /** Remote commits from other tabs. Returns an unsubscribe. */
  onRemoteCommit(fn: (e: StoreEvent) => void): () => void
  /** Another tab is upgrading: we must close or we deadlock it. */
  onBlocking(fn: () => void): () => void
  close(): void
}
