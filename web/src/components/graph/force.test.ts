/**
 * The layout's two promises to its caller.
 *
 * `step` returning false is what stops the rAF loop; `settle` returning true is
 * what stops the reduced-motion resumption. Both were unguarded, and both are
 * the kind of claim that fails by burning a core rather than by looking wrong:
 * a `step` that never reports settled leaves an animation frame scheduled on a
 * still picture for as long as the tab is open, and a `settle` that never
 * reports finished reschedules itself forever.
 *
 * The budget is the newer half. `settle` used to run all 192 ticks on the
 * calling thread — 15ms at the demo store and 1.56 seconds at two thousand
 * records — from inside a layout effect, which is a frozen page for the users
 * who asked for less motion. It takes a deadline now, and `GraphCanvas` resumes
 * what is left across animation frames.
 */

import { describe, expect, it } from 'vitest'
import { createSim, positionsOf, settle, step, wake } from './force'
import type { SimLink, SimSpec } from './force'

/** A hub-and-spoke world, big enough that one tick is measurable. */
function world(n: number) {
  const spec: SimSpec[] = []
  const links: SimLink[] = []
  for (let i = 0; i < n; i += 1) {
    spec.push({ id: `n${i}`, radius: 6, degree: 2 })
    if (i > 0) links.push({ a: i, b: Math.floor(i / 3) })
  }
  return { spec, links }
}

const simOf = (n: number) => {
  const { spec, links } = world(n)
  return createSim(spec, links, 960, 620)
}

const ticksToSettle = (n: number) => {
  const sim = simOf(n)
  let ticks = 0
  while (ticks < 2000 && step(sim)) ticks += 1
  return ticks
}

describe('the simulation ends', () => {
  it('reports settled once alpha has decayed, whatever the graph looks like', () => {
    // The rAF loop in `GraphCanvas` is stopped by this and nothing else.
    expect(ticksToSettle(30)).toBeLessThan(220)
    expect(ticksToSettle(300)).toBeLessThan(220)
  })

  it('takes the same number of ticks at every size, because alpha is what ends it', () => {
    // Worth stating: the cost of a layout is entirely in the cost of a tick, so
    // the table in this module's header is 192 × `step` and nothing else. A
    // change that made big graphs settle in FEWER ticks would be a change to
    // what they converge on, and this is where it would be noticed.
    expect(ticksToSettle(30)).toBe(ticksToSettle(300))
  })

  it('settles a graph with no links at all rather than drifting', () => {
    const sim = createSim([{ id: 'a', radius: 6, degree: 0 }], [], 960, 620)
    expect(settle(sim)).toBe(true)
  })
})

describe('the budget', () => {
  /**
   * No wall-clock deadline in the assertion.
   *
   * This read `expect(settle(sim, 420, 16)).toBe(true)` — a real 16 ms budget
   * for 192 ticks. Idle that is about 1 ms and it passed; under load it
   * exceeds 16 ms and `settle` correctly returns false, so the test failed
   * 5 runs in 6 with ten busy processes and turned the whole gate
   * load-dependent. It was failing for the right reason, which is worse than
   * failing for a wrong one: the code was fine and the suite said otherwise.
   *
   * An unbounded budget pins the semantics that matter — a small layout
   * finishes, and finishing is idempotent — and the case below still proves
   * the budget is honoured, because a zero budget cannot finish 1,200 nodes
   * however fast the machine is.
   */
  it('finishes a small layout, and finishing is idempotent', () => {
    const sim = simOf(30)
    expect(settle(sim)).toBe(true)
    // Finished means finished: another call has nothing left to do.
    expect(settle(sim)).toBe(true)
  })

  it('stops for a layout it cannot finish, and says that too', () => {
    const sim = simOf(1200)
    expect(settle(sim, 420, 0)).toBe(false)
  })

  it('makes progress on every call, so a resumption cannot spin', () => {
    // A budget of zero still has to advance one tick, or `GraphCanvas` schedules
    // an animation frame that schedules an animation frame.
    const sim = simOf(1200)
    const before = positionsOf(sim)
    expect(settle(sim, 420, 0)).toBe(false)
    const after = positionsOf(sim)
    expect([...after].some(([id, p]) => p.x !== before.get(id)!.x)).toBe(true)
  })

  it('reaches the same finished layout in slices as it does in one go', () => {
    // The reduced-motion path is allowed to be interrupted and is NOT allowed to
    // converge somewhere else for it: the steps are the same steps.
    const whole = simOf(120)
    settle(whole)

    const sliced = simOf(120)
    let calls = 0
    while (!settle(sliced, 12) && calls < 200) calls += 1
    // It really was interrupted, or this compares one run with itself.
    expect(calls).toBeGreaterThan(0)

    const a = positionsOf(whole)
    for (const [id, p] of positionsOf(sliced)) {
      expect(p.x).toBeCloseTo(a.get(id)!.x, 6)
      expect(p.y).toBeCloseTo(a.get(id)!.y, 6)
    }
  })

  it('runs to the end when no budget is named, which is what every old caller did', () => {
    const sim = simOf(300)
    expect(settle(sim)).toBe(true)
    expect(step(sim)).toBe(false)
  })
})

describe('waking a settled layout', () => {
  it('puts it back in motion after a drag', () => {
    const sim = simOf(30)
    settle(sim)
    expect(step(sim)).toBe(false)
    wake(sim)
    expect(step(sim)).toBe(true)
  })

  it('never takes energy away from a layout that is still moving', () => {
    const sim = simOf(30)
    wake(sim, 0.1)
    expect(sim.alpha).toBe(1)
  })
})
