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

export function useStableView(next: ViewGraph): ViewGraph {
  const held = useRef<{ key: string; graph: ViewGraph } | null>(null)
  const key = viewKeyOf(next)
  if (held.current?.key !== key) held.current = { key, graph: next }
  return held.current.graph
}
