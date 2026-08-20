/**
 * What the simulation is actually a function of.
 *
 * `createSim` reads three things: the node ids in order (they are its indices),
 * each node's drawn radius, and the links between indices. Nothing else about a
 * record reaches the physics — not a label, not a date, not a stage.
 *
 * It is separated from `GraphCanvas` because it is a rule and the canvas cannot
 * be mounted (D20 — no jsdom, no component tests), so a rule left inside the
 * component is a rule nothing checks. The rule matters: `graph` is a fresh
 * object on every commit anywhere in the app and `filterGraph` mints another on
 * every legend toggle, so keying the rebuild on its identity re-ran a 192-tick
 * O(n²) solve — 1.56 seconds at two thousand records — because a field changed
 * on a record on another page. `key` is the comparison that stops that, and it
 * is here so that "which changes are structural" is a question with a test
 * rather than a question with a dependency array.
 */

import type { Graph } from '@/lib/graph/model'
import type { SimLink, SimSpec } from './force'
import { nodeRadius } from './visuals'

export type Structure = {
  spec: SimSpec[]
  /** Node id → its index in `spec`, which is what an edge is resolved through. */
  index: Map<string, number>
  links: SimLink[]
  /** Equal keys mean an identical simulation input. */
  key: string
}

export function structureOf(graph: Graph): Structure {
  const spec: SimSpec[] = graph.nodes.map((n) => ({
    id: n.id,
    radius: nodeRadius(n.degree),
    degree: n.degree,
  }))
  const index = new Map(spec.map((s, i) => [s.id, i]))

  const links: SimLink[] = []
  for (const edge of graph.edges) {
    const a = index.get(edge.from)
    const b = index.get(edge.to)
    // An edge with an end outside the drawn set is dropped rather than
    // resolved to index 0, which is what `?? -1` would have made of it.
    if (a !== undefined && b !== undefined) links.push({ a, b })
  }

  return { spec, index, links, key: keyOf(spec, links) }
}

/**
 * Degree is in the key as well as the radius, because the two are not in step:
 * `nodeRadius` is a bounded curve, so nodes of degree 30 and 40 draw the same
 * size while the springs and the masses read the raw number and lay them out
 * differently.
 */
function keyOf(spec: readonly SimSpec[], links: readonly SimLink[]): string {
  const nodes = spec.map((n) => `${n.id}:${n.radius}:${n.degree}`).join('|')
  return `${nodes}#${links.map((l) => `${l.a}-${l.b}`).join('|')}`
}
