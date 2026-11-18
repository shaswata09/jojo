/**
 * Holding the overview's view graph across renders (review 3, performance-5).
 *
 * The key that decides whether a new view graph draws the same is a join over
 * every node and edge. It is computed only for a new object now, not on every
 * render of the Graph page with the same memoised one.
 */

import { describe, expect, it } from 'vitest'
import type { ViewGraph, ViewNode } from '@jojo/service/core/graph-view'
import { nextHeldView } from './use-stable-view'
describe('holding the view graph across renders (review 3, performance-5)', () => {
  /** A view graph that counts how often its nodes are walked. */
  function counted(labels: readonly string[]): { graph: ViewGraph; walks: () => number } {
    let walks = 0
    const nodes = labels.map(
      (label, i) => ({ id: `n${i}`, type: 'application', label }) as ViewNode,
    )
    const graph = {
      get nodes() {
        walks += 1
        return nodes
      },
      edges: [],
    } as unknown as ViewGraph
    return { graph, walks: () => walks }
  }

  it('does not rebuild the key for the same view graph on a re-render', () => {
    const { graph, walks } = counted(['Acme'])
    const first = nextHeldView(null, graph)
    const walked = walks()
    const again = nextHeldView(first, graph)
    expect(again).toBe(first)
    expect(walks()).toBe(walked)
  })

  it('keeps the first graph for a new object that draws the same, and swaps on a change', () => {
    const a = counted(['Acme']).graph
    const sameDrawing = counted(['Acme']).graph
    const renamed = counted(['Acme Ltd']).graph
    const held = nextHeldView(null, a)
    const kept = nextHeldView(held, sameDrawing)
    expect(kept.graph).toBe(a)
    expect(kept.input).toBe(sameDrawing)
    expect(nextHeldView(kept, renamed).graph).toBe(renamed)
  })
})
