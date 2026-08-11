/**
 * L3 — the transaction buffer: every write a tool call has made, not yet committed.
 *
 * The shared base of the three pieces of `runtime.ts` that were split out of it.
 * `runtime-overlay.ts` READS this on top of the committed snapshot,
 * `runtime-tx.ts` WRITES into it, and `runtime.ts` turns it into journal deltas
 * at commit or throws it away at failure. Nothing else in the layer may see it —
 * a buffer that escaped its transaction is a write with no before-image.
 */

import type { EdgeId, NodeId, StoredEdge, StoredNode } from '@/kg/core/model'
import type { ToolName } from './index'

export type Cell<T> = { before: T | null; after: T | null }

/**
 * Every write the transaction has made, as before/after pairs.
 *
 * D12: the journal is images, not inverse commands. An inverse `create` mints a
 * new id and orphans every edge that pointed at the old one, and an inverse of
 * `application.delete` would have to know about six collections it never named.
 * Capturing both images at the moment of the write means undo is one generic
 * function and the 42 hand-written undo closures collapse to zero.
 */
export type Buffer = {
  nodes: Map<NodeId, Cell<StoredNode>>
  edges: Map<EdgeId, Cell<StoredEdge>>
  /** Slugs handed out by `mintSlug` but not yet attached to a node. */
  minted: Set<string>
  calls: ToolName[]
}

export const newBuffer = (): Buffer => ({
  nodes: new Map(),
  edges: new Map(),
  minted: new Set(),
  calls: [],
})

/**
 * Stages one write.
 *
 * The `before` image is recorded once and never overwritten. A node written
 * twice in one transaction — `application.stage.advance` patches the stage and
 * then the dates — must undo to what it was before the transaction opened, not
 * to what it was halfway through it.
 */
export function stage<T>(
  cells: Map<string, Cell<T>>,
  key: string,
  before: T | null,
  after: T | null,
) {
  const existing = cells.get(key)
  if (existing) existing.after = after
  else cells.set(key, { before, after })
}

export const slugOf = (n: StoredNode): string | undefined => (n.props as { slug?: string }).slug
