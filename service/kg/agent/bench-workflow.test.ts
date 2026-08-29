/**
 * The graph axis, which is the one neither of the others can answer.
 *
 * A model can pass the turn axis and the state axis while doing the work in an
 * order that only fails on a harder case. These pin what node F1 and edge F1
 * actually reward, including the two shapes that look right and are not:
 * calling a tool twice when once was asked, and getting the dependency
 * backwards.
 */

import { describe, expect, it } from 'vitest'
import { scoreWorkflow } from './bench-workflow'
import type { Workflow } from './bench-conversations'

/*
 * `args` is a JSON STRING on a real `CallRecord`, not an object — the runner
 * serialises them so a repeat can be told from ordinary work. The first version
 * of this helper passed an object, which typechecked nowhere and made every
 * argument assertion in this file vacuous: the scorer's `typeof args ===
 * 'object'` guard was never true against a real run, so `matched` was always 0
 * and the suite still went green.
 */
const call = (name: string, args: Record<string, unknown> = {}) => ({
  turn: 0,
  name,
  effect: 'read' as const,
  ok: true,
  args: JSON.stringify(args),
})

const gold: Workflow = {
  shape: 'chain',
  nodes: [
    { id: 's1', tool: 'memory.search', args: { query: 'Rice' }, why: 'find it' },
    { id: 's2', tool: 'application.stage.set', args: { stage: 'interview' }, why: 'move it' },
  ],
  links: [{ source: 's1', target: 's2' }],
}

describe('scoring a run against the gold graph', () => {
  it('is perfect for the right tools in the right order', () => {
    const s = scoreWorkflow(gold, [
      call('memory.search', { query: 'Rice' }),
      call('application.stage.set', { stage: 'interview' }),
    ])
    expect(s.nodes.f1).toBe(1)
    expect(s.links.f1).toBe(1)
    expect(s.args).toEqual({ checked: 2, matched: 2 })
  })

  it('scores the edge as missed when the order is backwards', () => {
    /*
     * The failure the turn axis cannot see: both tools were called, both were
     * defensible, and the write happened before the read that finds what to
     * write to. On this world it may still pass; on a bigger one it cannot.
     */
    const s = scoreWorkflow(gold, [call('application.stage.set'), call('memory.search')])
    expect(s.nodes.recall).toBe(1)
    expect(s.links.recall).toBe(0)
  })

  it('penalises a step that was skipped', () => {
    const s = scoreWorkflow(gold, [call('memory.search')])
    expect(s.nodes.recall).toBe(0.5)
    expect(s.nodes.precision).toBe(1)
  })

  it('penalises calls the workflow never asked for', () => {
    const s = scoreWorkflow(gold, [
      call('memory.search'),
      call('memory.list'),
      call('graph.query'),
      call('application.stage.set'),
    ])
    expect(s.nodes.recall).toBe(1)
    expect(s.nodes.precision).toBe(0.5)
  })

  it('counts repeats as a multiset, not a set', () => {
    /*
     * Two required edits are not satisfied by one. Set intersection would score
     * this as perfect recall, which is how a model that did half the work
     * passes a graph check.
     */
    const twice: Workflow = {
      shape: 'chain',
      nodes: [
        { id: 'a', tool: 'application.update', why: 'first' },
        { id: 'b', tool: 'application.update', why: 'second' },
      ],
      links: [{ source: 'a', target: 'b' }],
    }
    const once = scoreWorkflow(twice, [call('application.update')])
    expect(once.nodes.recall).toBe(0.5)
  })

  it('accepts a dependency satisfied at a distance', () => {
    // `read -> write` claims the read happened BEFORE the write, not that it
    // happened immediately before. Requiring adjacency would fail a model for
    // reading twice, which is not a mistake.
    const s = scoreWorkflow(gold, [
      call('memory.search'),
      call('memory.list'),
      call('application.stage.set'),
    ])
    expect(s.links.recall).toBe(1)
  })

  it('does not check an argument whose value only exists at runtime', () => {
    // `$s1` means "whatever step s1 returned" — a minted id, which has no value
    // until the run happens. Counting it as checkable would score every model
    // as wrong about it.
    const runtime: Workflow = {
      shape: 'chain',
      nodes: [
        { id: 's1', tool: 'keyword.create', args: { name: 'systems' }, why: 'make it' },
        { id: 's2', tool: 'keyword.attach', args: { keyword: '$s1' }, why: 'use it' },
      ],
      links: [{ source: 's1', target: 's2' }],
    }
    const s = scoreWorkflow(runtime, [call('keyword.create', { name: 'systems' }), call('keyword.attach')])
    expect(s.args).toEqual({ checked: 1, matched: 1 })
  })

  it('does not punish a perfect run for the pairs a longer chain implies', () => {
    /*
     * The bug this pins: edge precision was measured over EVERY ordered pair of
     * calls, so a three-node chain run perfectly produced three pairs against
     * two gold links and scored 0.67. The denominator grew quadratically with
     * the run while the gold set did not, and a nine-call workflow could not
     * clear 0.2 however right it was.
     */
    const chain: Workflow = {
      shape: 'chain',
      nodes: [
        { id: 'a', tool: 'memory.search', why: 'find' },
        { id: 'b', tool: 'graph.neighbours', why: 'expand' },
        { id: 'c', tool: 'timeline.item.create', why: 'act' },
      ],
      links: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
    }
    const s = scoreWorkflow(chain, [
      call('memory.search'),
      call('graph.neighbours'),
      call('timeline.item.create'),
    ])
    expect(s.links.precision).toBe(1)
    expect(s.links.recall).toBe(1)
  })

  it('ignores the order of two calls the graph left independent', () => {
    // Two reads feeding one write. The run has to put them in SOME order and
    // the graph does not care which, so neither order may be scored as wrong.
    const join: Workflow = {
      shape: 'dag',
      nodes: [
        { id: 'a', tool: 'stats.stages', why: 'one side' },
        { id: 'b', tool: 'stats.sources', why: 'the other' },
        { id: 'c', tool: 'timeline.item.create', why: 'act on both' },
      ],
      links: [
        { source: 'a', target: 'c' },
        { source: 'b', target: 'c' },
      ],
    }
    const forwards = scoreWorkflow(join, [call('stats.stages'), call('stats.sources'), call('timeline.item.create')])
    const backwards = scoreWorkflow(join, [call('stats.sources'), call('stats.stages'), call('timeline.item.create')])
    expect(forwards.links.f1).toBe(1)
    expect(backwards.links.f1).toBe(1)
  })

  it('lowers precision only for an ordering the graph forbids', () => {
    const s = scoreWorkflow(gold, [call('application.stage.set'), call('memory.search')])
    expect(s.links.precision).toBe(0)
    expect(s.links.recall).toBe(0)
  })

  it('gives a run that called nothing a zero rather than a divide by zero', () => {
    const s = scoreWorkflow(gold, [])
    expect(s.nodes.f1).toBe(0)
    expect(s.nodes.precision).toBe(0)
  })
})

describe('a tool the gold graph names more than once', () => {
  /*
   * The instance-identity limit, and the bug it caused.
   *
   * A call list says `memory.list` happened three times. It does not say which
   * occurrence was s2, s4 or s6, so an ordering claim about `memory.list` and
   * anything else cannot be settled without guessing the matching. The first
   * version guessed by name, and charged a PERFECT run a violation for it.
   */
  const repeated: Workflow = {
    shape: 'dag',
    nodes: [
      { id: 's1', tool: 'keyword.create', why: 'make it' },
      { id: 's2', tool: 'memory.list', why: 'see it' },
      { id: 's3', tool: 'memory.related', why: 'expand' },
      { id: 's4', tool: 'memory.list', why: 'again, later' },
    ],
    links: [
      { source: 's1', target: 's2' },
      { source: 's2', target: 's3' },
    ],
  }

  it('does not mark a perfect run down for the pairs repetition implies', () => {
    /*
     * The run below IS the gold order. Before the fix it scored 0.5 link
     * precision: `memory.list -> memory.related` is in the closure, s3 runs
     * before s4's `memory.list`, and by name that reads as the edge backwards.
     * Measured across the real suite, three of 48 graphs capped their own
     * perfect run this way, the worst at 0.667.
     */
    const s = scoreWorkflow(repeated, [
      call('keyword.create'),
      call('memory.list'),
      call('memory.related'),
      call('memory.list'),
    ])
    expect(s.links.precision).toBe(1)
    expect(s.links.recall).toBe(1)
    expect(s.nodes.f1).toBe(1)
  })

  it('reports how many gold edges it could actually judge', () => {
    // Neither edge is adjudicable — both touch `memory.list`. A precision of 1
    // over zero judged edges is an absence of evidence, not a score, and the
    // two are indistinguishable unless the count is published beside it.
    const s = scoreWorkflow(repeated, [call('keyword.create'), call('memory.list')])
    expect(s.edges).toEqual({ of: 2, adjudicable: 0 })
  })

  it('still judges an ordering between two tools named once each', () => {
    const s = scoreWorkflow(gold, [call('application.stage.set'), call('memory.search')])
    expect(s.edges).toEqual({ of: 1, adjudicable: 1 })
    expect(s.links.precision).toBe(0)
  })
})
