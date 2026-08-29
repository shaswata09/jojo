/**
 * The derivation the previewer draws.
 *
 * Components are never mounted here (D20), so everything that could be wrong
 * about the picture lives in `bench-graph.ts` and is asserted against the real
 * conversations rather than a fixture — a case added tomorrow is covered by
 * these the moment it lands.
 */

import { describe, expect, it } from 'vitest'
import { CONVERSATIONS } from '@jojo/service/agent/bench-conversations'
import { allowedFor, describeCheck, graphOf } from '@/components/guide/bench-graph'

const byId = (id: string) => CONVERSATIONS.find((c) => c.id === id)!

describe('the graph of a conversation', () => {
  it('runs the turns left to right, one column each', () => {
    const g = graphOf(byId('long-recall-early-fact'))
    const turns = g.nodes.filter((n) => n.kind === 'turn')
    expect(turns).toHaveLength(8)
    expect(turns.map((t) => t.column)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    // And they are chained, so the picture reads as a conversation.
    const next = g.edges.filter((e) => e.kind === 'next')
    expect(next).toHaveLength(7)
  })

  it('hangs the store checks off the end, not off a turn', () => {
    // They are true of the whole conversation. Attaching one to a turn would
    // say it had to hold partway through, which is not what the rubric asserts.
    const c = byId('profile-relate-two-facts')
    const g = graphOf(c)
    const checks = g.nodes.filter((n) => n.kind === 'check')
    expect(checks).toHaveLength(c.finalState.length)
    expect(checks.every((n) => n.column === c.turns.length)).toBe(true)
  })

  it('collapses the read family into one node', () => {
    /*
     * Nearly every turn appends `...READS`, so drawing each is nine
     * near-identical boxes that bury the one WRITE the turn is actually about.
     */
    const g = graphOf(byId('tag-new-keyword'))
    const reads = g.nodes.filter((n) => n.id.endsWith('-a-reads'))
    expect(reads.length).toBeGreaterThan(0)
    expect(reads[0]!.label).toMatch(/reads|memory\.|graph\./)
    // The detail still names every one, so nothing is hidden.
    expect(reads[0]!.detail.split(', ').length).toBeGreaterThan(1)
  })

  it('summarises the forbidden list rather than drawing a dozen boxes', () => {
    const g = graphOf(byId('rice-ambiguous'))
    const forbidden = g.nodes.filter((n) => n.kind === 'forbidden')
    expect(forbidden).toHaveLength(1)
    expect(forbidden[0]!.detail).toContain('memory.reset')
  })

  it('shows a required answer fact as its own node', () => {
    const g = graphOf(byId('idle-pipeline'))
    const said = g.nodes.filter((n) => n.kind === 'answer')
    expect(said).toHaveLength(1)
    expect(said[0]!.label).toContain('Industry research roles')
  })

  it('gives every node a unique id, so React can key on it', () => {
    for (const c of CONVERSATIONS) {
      const ids = graphOf(c).nodes.map((n) => n.id)
      expect(new Set(ids).size, `${c.id} has a duplicate node id`).toBe(ids.length)
    }
  })

  it('never emits an edge to a node that is not there', () => {
    for (const c of CONVERSATIONS) {
      const g = graphOf(c)
      const ids = new Set(g.nodes.map((n) => n.id))
      for (const e of g.edges) {
        expect(ids.has(e.from), `${c.id}: edge from missing ${e.from}`).toBe(true)
        expect(ids.has(e.to), `${c.id}: edge to missing ${e.to}`).toBe(true)
      }
    }
  })

  it('is deterministic', () => {
    // The component keys children on these ids; a reshuffle would remount the
    // world on every render.
    const a = graphOf(byId('stripe-offer'))
    const b = graphOf(byId('stripe-offer'))
    expect(a).toEqual(b)
  })
})

describe('reading a check aloud', () => {
  it('says something for every kind the rubric can express', () => {
    // A `switch` with a missing arm returns undefined and draws an empty box.
    const seen = new Set<string>()
    for (const c of CONVERSATIONS) {
      for (const check of c.finalState) {
        seen.add(check.kind)
        expect(describeCheck(check), `${c.id}: ${check.kind}`).toBeTruthy()
      }
    }
    expect(seen.size).toBeGreaterThan(2)
  })
})

describe('what a turn may call', () => {
  it('splits writes from reads', () => {
    const turn = byId('tag-new-keyword').turns[0]!
    const { writes, reads } = allowedFor(turn)
    expect(writes.every((w) => !w.startsWith('memory.'))).toBe(true)
    expect(reads.every((r) => /^(memory|graph|stats|calc|vault\.file\.read)/.test(r))).toBe(true)
    expect([...writes, ...reads].sort()).toEqual([...(turn.mustCallOneOf ?? [])].sort())
  })
})
