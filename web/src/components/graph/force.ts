/**
 * A force-directed layout, by hand.
 *
 * Three forces, integrated with velocity Verlet: every pair of nodes pushes
 * apart, every edge pulls its two ends together, and a weak pull toward the
 * middle stops disconnected components drifting off the canvas. No library —
 * a local-first app should not take a dependency to draw ninety circles.
 *
 * WHAT THIS COSTS, MEASURED — the header used to end "and at this size the
 * O(n²) repulsion is a few thousand multiplications a frame", which was true of
 * the ninety-node demo store it was written against and stops being true a long
 * way before the store gets large. On an Apple Silicon laptop, node, warmed:
 *
 *     nodes       91      500     1,000     2,000     4,000
 *     pairs    4,095  124,750   499,500  2.0M      8.0M
 *     settle    15ms     92ms     377ms  1,562ms   6,017ms
 *     a tick  0.08ms   0.48ms    1.96ms    8.1ms      31ms
 *
 * `settle` is always 192 ticks — `alpha` reaching `ALPHA_MIN` is what ends it,
 * never the layout going still — so the per-tick row is the row above it
 * divided by 192 rather than a separate measurement. Timing one tick directly
 * is not reliable at the small end: at 91 nodes it is under a tenth of a
 * millisecond and the first call reads twelve times the warmed one.
 *
 * Both rows are quadratic, cleanly: each doubling of the node count is a little
 * under four times the work. So the canvas animates comfortably to about 2,000
 * nodes (8ms a frame, with the paint still to come) and not at 4,000 (31ms a
 * frame, before anything is drawn). A quadtree approximation is the answer if it
 * ever has to be, and nothing here has needed one yet.
 *
 * Three things here are load-bearing and easy to get wrong:
 *
 * 1. `alpha` decays every tick and the simulation is declared settled when it
 *    falls below `ALPHA_MIN`. The caller must stop its rAF loop when `step`
 *    returns false, or the page burns a core forever on a picture that has
 *    stopped moving.
 * 2. Starting positions are deterministic — a phyllotaxis spiral seeded from
 *    the node's index, never `Math.random`. The same records therefore lay out
 *    the same way twice, which is the difference between a graph you can learn
 *    the shape of and one that rearranges itself every time you visit.
 * 3. `settle` runs the whole table above on the calling thread. Anything asking
 *    it to solve a layout it has not budgeted for is asking for the numbers in
 *    that table as a frozen page — see `budgetMs`.
 */

export type SimNode = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** Drawn radius. Feeds the link length so hubs do not swallow their own labels. */
  radius: number
  /** Heavier nodes move less. Derived from degree, so hubs anchor the picture. */
  mass: number
  /** Dragged into place by the user; forces still apply to its neighbours. */
  pinned: boolean
}

export type SimLink = { a: number; b: number }

export type Sim = {
  nodes: SimNode[]
  links: readonly SimLink[]
  alpha: number
  width: number
  height: number
}

const REPULSION = 7200
const SPRING = 0.055
const LINK_BASE = 44
const CENTRING = 0.0015
const DAMPING = 0.84
const ALPHA_DECAY = 0.981
const ALPHA_MIN = 0.025
const MAX_SPEED = 24
/** Nothing gets closer than this to the frame, so labels stay readable. */
const PADDING = 26

export type SimSpec = {
  id: string
  radius: number
  degree: number
}

/**
 * The golden angle. Successive indices land on opposite sides of the canvas
 * rather than in a ring, which gives the repulsion something to work with —
 * nodes seeded on a circle start perfectly balanced and take far longer to
 * separate.
 */
const GOLDEN_ANGLE = 2.399963229728653

export function createSim(
  spec: readonly SimSpec[],
  links: readonly SimLink[],
  width: number,
  height: number,
  /** Positions to reuse, so hiding a legend row does not reshuffle the world. */
  previous?: ReadonlyMap<string, { x: number; y: number }>,
): Sim {
  const cx = width / 2
  const cy = height / 2
  const spread = Math.min(width, height) * 0.42

  const nodes: SimNode[] = spec.map((s, i) => {
    const kept = previous?.get(s.id)
    const angle = i * GOLDEN_ANGLE
    const radius = spread * Math.sqrt((i + 0.5) / Math.max(spec.length, 1))
    return {
      id: s.id,
      x: kept ? kept.x : cx + Math.cos(angle) * radius,
      y: kept ? kept.y : cy + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      radius: s.radius,
      mass: 1 + s.degree * 0.35,
      pinned: false,
    }
  })

  return { nodes, links, alpha: 1, width, height }
}

/** Advances one tick. Returns false once the layout has settled. */
export function step(sim: Sim): boolean {
  const { nodes, links } = sim
  const alpha = sim.alpha
  const cx = sim.width / 2
  const cy = sim.height / 2

  const ax = new Float64Array(nodes.length)
  const ay = new Float64Array(nodes.length)

  // Repulsion. Softened at very short range: an unclamped inverse square puts
  // two coincident nodes on opposite sides of the canvas in a single frame.
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i]
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j]
      let dx = a.x - b.x
      let dy = a.y - b.y
      let d2 = dx * dx + dy * dy
      if (d2 < 1) {
        // Deterministic nudge rather than a random one, for the reason in the
        // header: two nodes on the same point have no direction to push along.
        dx = (i % 2 === 0 ? 1 : -1) * 0.5
        dy = (j % 2 === 0 ? 1 : -1) * 0.5
        d2 = 0.5
      }
      const d = Math.sqrt(d2)
      const force = (REPULSION * (a.radius + b.radius)) / 18 / d2
      const fx = (dx / d) * force
      const fy = (dy / d) * force
      ax[i] += fx
      ay[i] += fy
      ax[j] -= fx
      ay[j] -= fy
    }
  }

  // Springs. Rest length grows with the two radii so a big hub does not sit on
  // top of the small nodes hanging off it.
  for (const link of links) {
    const a = nodes[link.a]
    const b = nodes[link.b]
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.hypot(dx, dy) || 0.01
    const rest = LINK_BASE + a.radius + b.radius
    const force = SPRING * (d - rest)
    const fx = (dx / d) * force
    const fy = (dy / d) * force
    ax[link.a] += fx
    ay[link.a] += fy
    ax[link.b] -= fx
    ay[link.b] -= fy
  }

  let moving = false

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (node.pinned) {
      node.vx = 0
      node.vy = 0
      continue
    }

    ax[i] += (cx - node.x) * CENTRING * node.mass
    ay[i] += (cy - node.y) * CENTRING * node.mass

    node.vx = (node.vx + (ax[i] / node.mass) * alpha) * DAMPING
    node.vy = (node.vy + (ay[i] / node.mass) * alpha) * DAMPING

    const speed = Math.hypot(node.vx, node.vy)
    if (speed > MAX_SPEED) {
      node.vx = (node.vx / speed) * MAX_SPEED
      node.vy = (node.vy / speed) * MAX_SPEED
    }
    if (speed > 0.12) moving = true

    node.x = clamp(node.x + node.vx, PADDING + node.radius, sim.width - PADDING - node.radius)
    node.y = clamp(node.y + node.vy, PADDING + node.radius, sim.height - PADDING - node.radius)
  }

  sim.alpha *= ALPHA_DECAY
  return moving && sim.alpha > ALPHA_MIN
}

/**
 * Runs the layout with nothing painted — the reduced-motion path.
 *
 * Returns true when the layout is finished, false when it ran out of budget and
 * has more to do. There was no budget and no return value: the one caller ran
 * all 192 ticks inside a `useLayoutEffect`, which is 15ms at the demo store and
 * 1.56 SECONDS at two thousand records — a whole-page freeze, on every rebuild,
 * for the users who asked for less motion rather than more. It is measured on
 * an Apple Silicon laptop; a phone-class machine is worse.
 *
 * The budget is a wall-clock deadline rather than a tick count because the cost
 * of a tick is quadratic in the node count, so a count that is one frame here is
 * forty there. The caller resumes what is left; the layout it converges on is
 * the same one either way, because the steps are the same steps.
 */
export function settle(sim: Sim, iterations = 420, budgetMs = Infinity): boolean {
  const deadline = budgetMs === Infinity ? Infinity : performance.now() + budgetMs
  for (let i = 0; i < iterations; i += 1) {
    if (!step(sim)) return true
    // Checked after the step, not before: a budget of zero still has to make
    // progress, or a caller that hands one over gets an infinite resumption.
    if (performance.now() >= deadline) return false
  }
  // The iteration cap was reached and the layout is still moving. Reported as
  // unfinished rather than as done, which is the same distinction the budget
  // makes: this used to `break` and return nothing, so a caller could not tell
  // "solved" from "gave up" and the only caller assumed the first.
  return false
}

/** Puts energy back in after a drag or a filter change. */
export function wake(sim: Sim, alpha = 0.55) {
  sim.alpha = Math.max(sim.alpha, alpha)
}

export function positionsOf(sim: Sim): Map<string, { x: number; y: number }> {
  return new Map(sim.nodes.map((n) => [n.id, { x: n.x, y: n.y }]))
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max)
