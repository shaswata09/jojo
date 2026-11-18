import { useRef } from 'react'
import type { ViewGraph } from '@jojo/service/core/graph-view'

/**
 * The same view graph object for as long as nothing the overview reads changes.
 *
 * `buildGraph` runs on every commit anywhere in the app, so the view graph is a
 * new object on every commit too — and the overview and focus layouts, and the
 * thousands of marks they draw, are memoised on it. A renamed record on another
 * page changes a label, which IS read (it is drawn, and it orders members); a
 * changed note or date is not, and must not re-lay the picture out. Same bargain
 * as `structureOf` makes for the free layout.
 */
export function viewKeyOf(graph: ViewGraph): string {
  const parts: string[] = []
  for (const node of graph.nodes) {
    parts.push(node.id, node.type, node.label)
    const keys = node.groupKeys
    if (keys) for (const dim of Object.keys(keys).sort()) parts.push(dim, ...(keys[dim] ?? []))
    parts.push('')
  }
  parts.push('#')
  for (const edge of graph.edges) parts.push(edge.from, edge.to, edge.rel)
  return parts.join('\u0001')
}

/** What `useStableView` holds between renders. */
export type HeldView = {
  /** The view graph handed out — the first one with this key. */
  readonly graph: ViewGraph
  /** `viewKeyOf` of it. */
  readonly key: string
  /** The last view graph passed in, so the same one again skips the key. */
  readonly input: ViewGraph
}

/**
 * The next thing to hold, given the last and a view graph.
 *
 * The key is computed only for a view graph that is a new object (review 3,
 * performance-5). It used to be computed on every render of the Graph page,
 * and the page re-renders on every selection, legend toggle, query and trail
 * step with the same memoised view graph — a join of six parts per node and
 * three per edge each time: 2.6 ms at 2,700 records, 23 ms at 26,400, on
 * every click.
 */
export function nextHeldView(held: HeldView | null, next: ViewGraph): HeldView {
  if (held !== null && held.input === next) return held
  const key = viewKeyOf(next)
  if (held !== null && held.key === key) return { ...held, input: next }
  return { graph: next, key, input: next }
}

export function useStableView(next: ViewGraph): ViewGraph {
  const held = useRef<HeldView | null>(null)
  held.current = nextHeldView(held.current, next)
  return held.current.graph
}
