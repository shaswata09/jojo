/**
 * L0 — the `StoreEvent` a committed write describes, for the cross-tab channel.
 *
 * Read off the rows that were just written, never minted, which is why this is
 * a pair of pure functions rather than something the driver does inline: the
 * driver has no clock (D26, enforced on this layer by `check-platform.mjs`), so
 * an event's `at` has to come out of the data or not exist at all.
 */

import type { DurableOp, Rows, StoreEvent } from '@jojo/service/storage/driver'

/**
 * The commit event a batch describes, read off the batch itself.
 *
 * The driver has no clock — D26 applies here as much as anywhere, and
 * `check-platform.mjs` enforces it on this layer specifically — so the event's
 * timestamp cannot be minted. It does not need to be: every commit carries its
 * journal row, and the journal row was stamped by the repository with the time
 * the user's action actually happened, which is the more useful answer anyway.
 */
export function commitEvent(ops: readonly DurableOp[]): StoreEvent | null {
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    const op = ops[i]
    if (op === undefined || op.kind !== 'put' || op.store !== 'ops') continue
    /*
     * A NEW journal entry, not a rewrite of one already on disk.
     *
     * `key === null` is what "new" means here: the repository appends with
     * `key: null` and lets the store mint the number (`repository.ts:224`),
     * while the only writers that name a key are housekeeping — the boot-time
     * audit prune rewrites every kept row at its own index.
     *
     * Without this, that prune announced itself to every other tab as somebody
     * having written something. The other tab re-read the store and cleared its
     * undo and redo stacks, and told the person their records had been
     * reloaded. Opening a second tab therefore threw away whatever the first
     * one could still take back, on a boot where nothing had changed at all.
     */
    if (op.key !== null) continue
    const id = op.value['id']
    const at = op.value['at']
    if (typeof id === 'string' && typeof at === 'string') return { kind: 'commit', at, entryId: id }
  }
  return null
}

/** A wholesale replace has no journal row, so its instant comes off the meta row. */
export function replaceEvent(rows: Rows): StoreEvent | null {
  for (const row of rows.meta) {
    const value = row.value
    if (typeof value !== 'object' || value === null) continue
    const at = (value as Record<string, unknown>)['lastOpenedAt']
    if (typeof at === 'string') return { kind: 'commit', at, entryId: '' }
  }
  return null
}
