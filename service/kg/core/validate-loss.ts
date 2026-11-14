/**
 * What a salvaging restore will cost, counted before the swap.
 */

import type { ValidatedRows } from './validate-rows'
import { APPEARED_TWICE } from './validate-rows'

/**
 * What salvaging these rows will cost, in the person's terms.
 *
 * `restoreBackup` salvages: unreadable rows are dropped and the rest restored.
 * Counted here so a confirmation can say so BEFORE the swap — "12 records"
 * followed by a report of 9 after an operation with no undo is the loss being
 * disclosed too late to decline.
 *
 * `records` and `links` were in the file and will not be restored; `changed`
 * are restored with something stripped or re-addressed.
 */
export type RowLoss = { records: number; links: number; changed: number }

export function lossOf(
  nodeRows: readonly unknown[],
  edgeRows: readonly unknown[],
  checked: ValidatedRows,
): RowLoss {
  const kept = new Set(checked.nodes.map((n) => n.id))
  const changed = new Set<string>()
  for (const d of checked.skipped) {
    // A kept record named in a diagnostic came back altered — except the twin
    // of a duplicate id, which is a dropped ROW and already counted below.
    if (d.store === 'nodes' && d.id !== null && kept.has(d.id) && d.message !== APPEARED_TWICE) {
      changed.add(d.id)
    }
  }
  return {
    records: nodeRows.length - checked.nodes.length,
    // Diagnostics, not a subtraction: a link listed twice under one id is the
    // same link, and `validateRows` collapses it without a word.
    links: Math.min(
      checked.skipped.filter((d) => d.store === 'edges').length,
      edgeRows.length - checked.edges.length,
    ),
    changed: changed.size,
  }
}
