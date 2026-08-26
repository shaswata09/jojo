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

/**
 * The most nodes worth simulating, and why there is a number here at all.
 *
 * `force.ts` carries the measurement: the layout is cleanly quadratic and costs
 * 8ms a tick at 2,000 nodes and 31ms at 4,000, before anything is painted. So
 * there is a size at which opening this tab stops being slow and starts being a
 * frozen browser, and until now nothing stood between a large store and it.
 *
 * 1,500 rather than 2,000: the measured figure is the physics alone, and a
 * frame still has to lay out and paint that many SVG nodes afterwards. Leaving
 * headroom under the number where the physics alone eats the frame is the
 * difference between a canvas that is heavy and one that has stopped.
 *
 * A cap is not the real answer and is not pretending to be. `force.ts` names
 * the real one — a quadtree approximation — and this is what makes it safe to
 * not have written that yet.
 */
export const MAX_DRAWN = 1500

export type Structure = {
  spec: SimSpec[]
  /** Node id → its index in `spec`, which is what an edge is resolved through. */
  index: Map<string, number>
  /**
   * How many nodes the cap left out — 0 almost always.
   *
   * Reported rather than silent. A picture that quietly shows two thirds of the
   * graph is a picture somebody will draw conclusions from, and "nothing here
   * connects to that" is exactly the sort of conclusion it invites.
   */
  dropped: number
  links: SimLink[]
  /** Equal keys mean an identical simulation input. */
  key: string
}

export function structureOf(graph: Graph): Structure {
  /*
   * The most connected nodes first, and only the first `MAX_DRAWN` of them.
   *
   * By degree because this is a picture of how records connect, so the ones
   * that connect to the most are the ones the picture is about — dropping a
   * leaf costs a dot, dropping a hub costs the shape. Ties broken on id, which
   * is arbitrary but STABLE: a comparator that left ties in input order would
   * reshuffle the drawn set whenever the store's iteration order moved, and the
   * canvas would relayout for no reason a person could see.
   */
  const ordered =
    graph.nodes.length <= MAX_DRAWN
      ? graph.nodes
      : [...graph.nodes]
          .sort((a, b) => b.degree - a.degree || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .slice(0, MAX_DRAWN)

  const spec: SimSpec[] = ordered.map((n) => ({
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

  return {
    spec,
    index,
    links,
    key: keyOf(spec, links),
    dropped: graph.nodes.length - spec.length,
  }
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
