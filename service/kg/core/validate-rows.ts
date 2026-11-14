/**
 * The whole store at once: every node row, then every edge row, with what was
 * skipped counted. See `validate.ts` for what the trust boundary promises.
 */

import type { StoredEdge, StoredNode } from './model'
import type { Diagnostic, Validated } from './validate-diagnostic'
import { diagnostic } from './validate-diagnostic'
import { validateEdge, validateNode } from './validate-records'
import { readdressed, SALVAGE_NOTE, withoutSalvageable } from './validate-salvage'

/* -------------------------------- the batch ------------------------------- */

export const APPEARED_TWICE = 'Appeared twice; the later one was kept.'

export type ValidatedRows = {
  nodes: StoredNode[]
  edges: StoredEdge[]
  /** Never empty and never ignored: every one of these is a record not shown. */
  skipped: Diagnostic[]
}

export type ValidateOptions = {
  /**
   * Retry a failed node with the file-link props removed, and keep it if that
   * succeeds. Used ONLY on the restore path — never on the hydrate path, where
   * a value this wrong means the database is corrupt and should say so.
   */
  salvage?: boolean
}

/**
 * One node row, retried without what its type may lose when salvaging and the
 * first read failed. A failed retry answers with the FIRST read's diagnostics.
 */
function readNode(
  row: unknown,
  options: ValidateOptions,
  skipped: Diagnostic[],
): Validated<StoredNode> {
  const parsed = validateNode(row)
  if (parsed.ok || options.salvage !== true) return parsed
  const stripped = withoutSalvageable(row)
  if (stripped === null) return parsed
  const retry = validateNode(stripped.row)
  if (!retry.ok) return parsed
  // Reported, not silent. It IS a loss, and the restore summary names
  // WHAT was lost in its own sentence rather than folding it in with
  // records that were dropped altogether.
  skipped.push(
    diagnostic(
      'nodes',
      retry.value.id,
      SALVAGE_NOTE[stripped.type] ?? 'Came back with part of it missing.',
    ),
  )
  return retry
}

/** Every readable node row, by id. */
function nodesById(
  nodeRows: readonly unknown[],
  options: ValidateOptions,
  skipped: Diagnostic[],
): Map<string, StoredNode> {
  const byId = new Map<string, StoredNode>()
  for (const row of nodeRows) {
    const parsed = readNode(row, options, skipped)
    if (!parsed.ok) {
      skipped.push(...parsed.diagnostics)
      continue
    }
    // Last one wins, and the loser is reported. A duplicate primary key cannot
    // come out of IndexedDB, so this only fires on an import or a merge — the
    // two paths where silently keeping one of two records is worst.
    if (byId.has(parsed.value.id)) {
      skipped.push(diagnostic('nodes', parsed.value.id, APPEARED_TWICE))
    }
    byId.set(parsed.value.id, parsed.value)
  }
  return byId
}

/** Every readable edge row whose two ends survived, once each. */
function edgesBetween(
  edgeRows: readonly unknown[],
  byId: ReadonlyMap<string, StoredNode>,
  skipped: Diagnostic[],
): StoredEdge[] {
  const edges: StoredEdge[] = []
  const seenEdge = new Set<string>()
  for (const row of edgeRows) {
    const parsed = validateEdge(row)
    if (!parsed.ok) {
      skipped.push(...parsed.diagnostics)
      continue
    }
    const edge = parsed.value
    if (seenEdge.has(edge.id)) continue
    if (!byId.has(edge.from) || !byId.has(edge.to)) {
      skipped.push(diagnostic('edges', edge.id, 'Joins a record that is not there.'))
      continue
    }
    seenEdge.add(edge.id)
    edges.push(edge)
  }
  return edges
}

/**
 * The whole store, node rows first.
 *
 * Edges are filtered against the nodes that survived, which is the graph
 * spelling of `addEdge`'s both-ends guard in `lib/graph/build.ts`: an edge with
 * a missing end would render as a
 * line running off into empty space, which reads as the layout having broken
 * rather than as a record having gone.
 */
export function validateRows(
  nodeRows: readonly unknown[],
  edgeRows: readonly unknown[],
  options: ValidateOptions = {},
): ValidatedRows {
  const skipped: Diagnostic[] = []
  const byId = nodesById(nodeRows, options, skipped)
  const nodes =
    options.salvage === true ? readdressed([...byId.values()], skipped) : [...byId.values()]
  const edges = edgesBetween(edgeRows, byId, skipped)
  return { nodes, edges, skipped }
}
