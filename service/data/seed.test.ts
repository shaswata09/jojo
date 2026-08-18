/**
 * The demo fixtures, and the one thing that can still go wrong with them:
 * the two doors onto the seed handing back two different stores.
 *
 * There were two compilers here. `repo/seed.ts` built the first-run graph, and
 * `tools/memory.ts` held a SECOND walk over the same fixture arrays for the
 * `memory.reset` tool. That is R-1 in miniature — a field added to
 * `data/seed.ts` is picked up by whichever one the author happened to open — and
 * it had already drifted: Wave 4 taught `seedToGraph` to rebase every authored
 * date by `seedOffset` and the tool never learned it, so one door produced an
 * offer whose respond-by had expired and the other did not. Their slugs differed
 * too, which put the two demos on different URLs for the same record.
 *
 * `memory.reset` calls `seedToGraph` now, so this file no longer asserts that
 * two implementations agree — it asserts that there is still only one. The
 * failure it is built to catch is somebody adding a second walk back, and the
 * shape it catches it in is the shape the drift actually took: slugs and dates.
 *
 * WHAT MOVED OUT, so it is not looked for here. This file used to be the only
 * place `org.ensure` was asked for the same employer twice inside ONE
 * transaction — the seed's two Rice rows — and its header explained that the
 * twelve-iteration loop was what exercised the overlay's staged `ofType`. That
 * loop is gone with the second compiler, and so is any production caller that
 * asks twice in one transaction: `application.create` and `application.update`
 * each call `org.ensure` once. The mechanism is pinned directly in
 * `kg/tools/transaction.test.ts` ('includes staged nodes in ofType'), and
 * `org.ensure` folding onto an ALREADY COMMITTED employer — which is the live
 * path, a second job at a company you already have — is pinned in
 * `kg/tools/tools.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../kg/core/snapshot'
import type { StoredEdge, StoredNode } from '../kg/core/model'
import { createRepository } from '../kg/repo/repository'
import { seedToGraph } from '../kg/repo/seed'
import { TOOLS } from '../kg/tools/index'
import { createToolRuntime } from '../kg/tools/runtime'
import { applications } from './seed'

type Options = Parameters<typeof createRepository>[0]

/** Accepts everything, remembers nothing — durability is not what this asserts. */
const nullDriver = (): Options['driver'] => ({
  open: async () => ({ ok: true, value: { version: 1, from: 0, migrated: [], crossTab: false } }),
  readAll: async () => ({ ok: true, value: { nodes: [], edges: [], meta: [], ops: [] } }),
  commit: async () => ({ ok: true, value: undefined }),
  replace: async () => ({ ok: true, value: undefined }),
  seedIfPristine: async () => ({ ok: true, value: true }),
  destroy: async () => ({ ok: true, value: undefined }),
  onRemoteCommit: () => () => {},
  onBlocking: () => () => {},
  close: () => {},
})

/**
 * A FIXED clock, not a ticking one.
 *
 * The comparison below is against `seedToGraph(AT)` compiled separately, and
 * every date in the seed is rebased off the instant it is compiled at. A clock
 * that advanced a second per read would date the two runs from two instants and
 * turn "the dates agree" into "the dates agree unless the run straddles
 * midnight" — which is the class of bug this file exists to catch, not a
 * property of the harness. Ids stay ordered anyway: `uuidv7`'s monotonic
 * counter is what orders two ids minted in one millisecond.
 */
const AT = '2026-10-12T15:00:00.000Z'

function reset() {
  const now = () => AT
  const repo = createRepository({
    driver: nullDriver(),
    snapshot: new MutableSnapshot(),
    meta: {
      schemaVersion: 1,
      createdAt: AT,
      lastOpenedAt: AT,
      dataSet: 'empty',
      seededAt: null,
    },
    now,
  })
  const result = createToolRuntime({ repo, now }).run('memory.reset', {})
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '))
  return repo.getSnapshot()
}

/**
 * The graph as something two runs can be compared BY VALUE on.
 *
 * NodeIds are UUIDv7 with a random tail, so two compilations of one fixture set
 * never share one — comparing on ids would fail for a reason that is not a
 * defect. Records are addressed here the way the app addresses them, by
 * [type, slug] (D4), and every edge is rewritten as the pair of addresses it
 * joins. That is also exactly the axis the drift ran along: a slug is a URL
 * segment, and the two compilers disagreeing about one is a dead deep link.
 */
const shapeOf = (nodes: readonly StoredNode[], edges: readonly StoredEdge[]) => {
  const addressOf = new Map(
    nodes.map((n) => [n.id, `${n.type}/${(n.props as { slug?: string }).slug ?? ''}`] as const),
  )
  return {
    // Props included, so a date that was not rebased is a failure here and not
    // merely an unasserted difference.
    nodes: nodes.map((n) => `${addressOf.get(n.id)} ${JSON.stringify(n.props)}`).sort(),
    edges: edges.map((e) => `${addressOf.get(e.from)}|${e.rel}|${addressOf.get(e.to)}`).sort(),
  }
}

const employers = new Set(applications.map((a) => a.org))

describe('the demo fixtures', () => {
  it('put two applications at one employer', () => {
    // The premise of the employer assertion below, stated on its own so that
    // deleting the duplicate fails HERE — with a sentence saying why it
    // mattered — instead of quietly turning that test into a no-op.
    expect(employers.size).toBeLessThan(applications.length)
  })

  it('is registered under a name the runtime knows', () => {
    // `run` returns a typed failure for an unknown tool rather than throwing,
    // and `reset()` below turns any failure into the same thrown Error — so a
    // renamed tool would read as a broken compiler. Separated so it cannot.
    expect(Object.keys(TOOLS)).toContain('memory.reset')
  })
})

describe('memory.reset and the first-run boot compile one graph', () => {
  it('produces the same records, the same props and the same edges', () => {
    const g = reset()
    const viaTool = shapeOf(g.nodes(), g.edges())
    const compiled = seedToGraph(AT)
    const viaBoot = shapeOf(compiled.nodes, compiled.edges)

    // Asserted in three statements rather than one `toEqual` over the pair: a
    // single failure on a 87-node object diff is unreadable, and which of the
    // three moved is the first thing anyone debugging this needs to know.
    expect(viaTool.nodes.length).toBe(viaBoot.nodes.length)
    expect(viaTool.edges).toEqual(viaBoot.edges)
    expect(viaTool.nodes).toEqual(viaBoot.nodes)
  })

  it('resolves every fixture cross-reference', () => {
    // `unresolved` is a compiler output, not a runtime branch. A key that
    // matched nothing would be a keyword the user set and cannot see, count or
    // remove — so it is empty for the shipped seed or the seed is wrong.
    expect(seedToGraph(AT).unresolved).toEqual([])
  })

  it('mints one organisation per employer, not one per application', () => {
    const g = reset()
    expect(g.ofType('organisation')).toHaveLength(employers.size)
    expect(g.ofType('application')).toHaveLength(applications.length)
  })

  it('gives the two applications at one employer distinct slugs', () => {
    // Both are addressed by their own fixture id now, so they are 'rice' and
    // 'rice-research' rather than 'rice' and a number. Asserted as distinct
    // rather than as literals because the fixture ids are the fixtures' to
    // choose; asserted at all because two records at one [type, slug] is the
    // one duplicate a demo can actually produce, and it makes one of the two
    // unreachable by URL.
    const slugs = (g: readonly StoredNode[]) =>
      g.map((n) => (n.props as { slug?: string }).slug ?? '')
    const found = slugs(reset().ofType('application') as StoredNode[])
    expect(new Set(found).size).toBe(found.length)
    expect(found.filter((s) => s.startsWith('rice'))).toHaveLength(2)
  })
})
