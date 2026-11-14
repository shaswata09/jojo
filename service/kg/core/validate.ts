/**
 * L1 — unknown -> StoredNode | Diagnostic[]. THE single trust boundary cast.
 *
 * Everything read off disk passes through here exactly once. A rejection is never
 * dropped silently: it is logged with the offending record id, counted in
 * Settings' Diagnostics, and the corrupt path offers to export what could be read
 * before anything else. Local-first means a silently skipped node is lost work
 * with no server backup and no undo.
 *
 * This module is the stable surface; the work lives beside it:
 *
 *   validate-diagnostic.ts   what a rejection becomes
 *   validate-props*.ts       one prop schema per node type, grouped by domain
 *   validate-records.ts      one node or edge row, and the two casts that make
 *                            an unchecked value a domain record
 *   validate-salvage.ts      what a restore may strip or re-address
 *   validate-rows.ts         the whole store at once
 *   validate-loss.ts         what a salvaging restore will cost
 *   validate-invariants.ts   the integrity check every boot runs
 */

export type { Diagnostic, Validated } from './validate-diagnostic'
export { NODE_PROP_SCHEMAS } from './validate-props'
export { validateEdge, validateNode } from './validate-records'
export type { ValidatedRows, ValidateOptions } from './validate-rows'
export { validateRows } from './validate-rows'
export type { RowLoss } from './validate-loss'
export { lossOf } from './validate-loss'
export { checkInvariants } from './validate-invariants'
