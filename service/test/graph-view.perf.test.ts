/**
 * How long the calm overview of a large graph takes to compute.
 *
 * Here rather than beside `kg/core/graph-view.test.ts` because it reads the
 * wall clock, which `check-platform` keeps out of kg/core and its tests.
 *
 * The approved redesign of /graph replaced an O(n²) force layout (8ms a tick at
 * 2,000 nodes, 192 ticks) with folding plus a deterministic cluster layout. The
 * promise was "fold + layout for 10,000 records under ~50 ms in Node"; measured
 * on an idle machine it is about 20 ms. Best of five, so a busy machine fails
 * it only when it is genuinely slow, not when one run was descheduled.
 */

import { describe, expect, it } from 'vitest'
import { clusterLayout, focusLayout, foldLeaves } from '../kg/core/graph-view'
import type { ViewEdge, ViewGraph, ViewNode } from '../kg/core/graph-view'

/** 2,100 applications, each with an employer, two dates and a file; five roles; 400 loose files. */
function bigStore(): ViewGraph {
  const nodes: ViewNode[] = []
  const edges: ViewEdge[] = []
  const stages = ['draft', 'submitted', 'screen', 'interview', 'offer', 'closed']
  for (let r = 0; r < 5; r++) nodes.push({ id: `role:${r}`, type: 'role', label: `Role ${r}` })
  for (let i = 0; i < 2100; i++) {
    const app = `app:${i}`
    nodes.push({
      id: app,
      type: 'application',
      label: `Employer ${i}`,
      groupKeys: { role: [`Role ${i % 5}`], stage: [stages[i % 6] ?? 'draft'], keyword: [] },
    })
    edges.push({ from: app, to: `role:${i % 5}`, rel: 'IS' })
    for (const kind of ['organisation', 'item', 'item', 'file']) {
      const id = `${kind}:${i}:${nodes.length}`
      nodes.push({ id, type: kind, label: id })
      edges.push({ from: id, to: app, rel: 'LINK' })
    }
  }
  for (let f = 0; f < 400; f++) nodes.push({ id: `loose:${f}`, type: 'file', label: `loose ${f}` })
  return { nodes, edges }
}

const canFold = (n: ViewNode) => n.type !== 'application' && n.type !== 'role'

describe('performance of the overview', () => {
  it('folds and lays out 10,000 records in under 50 ms', () => {
    const g = bigStore()
    expect(g.nodes.length).toBeGreaterThanOrEqual(10_000)
    let best = Infinity
    for (let run = 0; run < 5; run++) {
      // A fresh graph object each run, so the adjacency cache is not what is timed.
      const fresh: ViewGraph = { nodes: [...g.nodes], edges: [...g.edges] }
      const started = performance.now()
      const folding = foldLeaves(fresh, { canFold })
      clusterLayout(fresh, { by: 'stage', width: 960, height: 620, folding })
      best = Math.min(best, performance.now() - started)
    }
    expect(best).toBeLessThan(50)
  })

  it('focuses a hub of 2,100 applications without drawing them all', () => {
    const g = bigStore()
    const started = performance.now()
    const F = focusLayout(g, 'role:0', { width: 960, height: 620 })
    expect(performance.now() - started).toBeLessThan(100)
    expect(F.positions.size).toBeLessThanOrEqual(360)
    // A hub opens on its first neighbours and one "+N more" item for the rest.
    expect(F.more.get('@more:role:0')?.ids.length).toBeGreaterThan(300)
  })
})
