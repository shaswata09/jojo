/**
 * "Ask the graph", checked against answers worked out by hand.
 *
 * `runQuery` is the whole of the /graph page's Answer panel and it had no test
 * on either platform. It is also the one place where the highlighted subgraph
 * and the table beside it can disagree: they are supposed to be two readings of
 * one `QueryResult`, and nothing said so. Several of the assertions below are
 * that agreement rather than the answer itself.
 *
 * The topologies are built by hand rather than through `buildGraph`, for the
 * reason `graph.test.ts` gives: a failure here should point at the query engine
 * and not at a change in the demo fixtures.
 */

import { describe, expect, it } from 'vitest'
import type { Graph, GraphEdge, GraphNode, GraphNodeType, GraphRel } from '@/lib/graph/model'
import { runQuery } from '@/lib/graph/query'
import type { PatternQuery, QueryResult } from '@/lib/graph/query'

type NodeSpec = {
  id: string
  type: GraphNodeType
  label?: string
  itemKind?: GraphNode['itemKind']
  reminder?: boolean
}
type EdgeSpec = [from: string, rel: GraphRel, to: string]

/** Mirrors what `buildGraph` produces: the same indexes and the same degree. */
function makeGraph(specs: readonly NodeSpec[], links: readonly EdgeSpec[]): Graph {
  const nodes: GraphNode[] = specs.map((s) => ({
    id: s.id,
    type: s.type,
    label: s.label ?? s.id,
    recordId: s.id,
    degree: 0,
    ...(s.itemKind === undefined ? {} : { itemKind: s.itemKind }),
    ...(s.reminder === undefined ? {} : { reminder: s.reminder }),
  }))
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const edges: GraphEdge[] = links.map(([from, rel, to]) => ({
    id: `${from}|${rel}|${to}`,
    from,
    to,
    rel,
  }))
  const edgeById = new Map(edges.map((e) => [e.id, e]))

  const incident = new Map<string, string[]>()
  for (const e of edges) {
    for (const end of [e.from, e.to]) {
      byId.get(end)!.degree += 1
      const list = incident.get(end)
      if (list) list.push(e.id)
      else incident.set(end, [e.id])
    }
  }
  return { nodes, edges, byId, edgeById, incident }
}

const ids = (result: QueryResult) => result.rows.map((r) => r.node.id)

const pattern = (over: Partial<PatternQuery>): PatternQuery => ({
  kind: 'pattern',
  start: 'application',
  quantifier: 'has',
  rel: 'ABOUT',
  end: 'item',
  ...over,
})

/*
 * Three applications and the timeline items about them:
 *   a1 — two items (one of them a reminder, one an interview)
 *   a2 — one item
 *   a3 — none
 * plus a keyword tagging a1 and a3, and one file filed under a1.
 */
const graph = makeGraph(
  [
    { id: 'a1', type: 'application', label: 'Rice' },
    { id: 'a2', type: 'application', label: 'Baylor' },
    { id: 'a3', type: 'application', label: 'Austin' },
    { id: 'i1', type: 'item', label: 'Call', itemKind: 'call', reminder: true },
    { id: 'i2', type: 'item', label: 'Interview', itemKind: 'interview', reminder: false },
    { id: 'i3', type: 'item', label: 'Deadline', itemKind: 'deadline', reminder: false },
    { id: 'k1', type: 'keyword', label: 'Referral' },
    { id: 'f1', type: 'file', label: 'CV' },
    // Joined to nothing, so there is a pair with no route between them.
    { id: 's1', type: 'snippet', label: 'Note' },
  ],
  [
    ['i1', 'ABOUT', 'a1'],
    ['i2', 'ABOUT', 'a1'],
    ['i3', 'ABOUT', 'a2'],
    ['k1', 'TAGS', 'a1'],
    ['k1', 'TAGS', 'a3'],
    ['f1', 'FILED_UNDER', 'a1'],
  ],
)

/* --------------------------------- patterns -------------------------------- */

describe('a pattern query', () => {
  it('finds the records that have the relationship, most connected first', () => {
    const result = runQuery(graph, pattern({}))
    expect(ids(result)).toEqual(['a1', 'a2'])
    expect(result.rows[0]!.count).toBe(2)
    expect(result.rows[0]!.matched.map((n) => n.id).sort()).toEqual(['i1', 'i2'])
    expect(result.countLabel).toBe('Matches')
  })

  it('finds the records that lack it, and says so with an empty match list', () => {
    // The whole point of `missing`: there is nothing to name, so the Matched
    // column has to be empty rather than showing the wrong thing.
    const result = runQuery(graph, pattern({ quantifier: 'missing' }))
    expect(ids(result)).toEqual(['a3'])
    expect(result.rows[0]!.matched).toEqual([])
    expect(result.rows[0]!.count).toBe(0)
    expect(result.countLabel).toBe('Connections')
    expect(result.emptyNote).not.toBe(
      runQuery(graph, pattern({})).emptyNote,
    )
  })

  it('sorts a negative answer alphabetically, because every row counts zero', () => {
    // A count sort over rows that all read 0 is a coin toss dressed as ranking.
    const many = makeGraph(
      [
        { id: 'x', type: 'application', label: 'Zeta' },
        { id: 'y', type: 'application', label: 'Alpha' },
        { id: 'z', type: 'application', label: 'Mu' },
      ],
      [],
    )
    expect(runQuery(many, pattern({ quantifier: 'missing' })).rows.map((r) => r.node.label)).toEqual(
      ['Alpha', 'Mu', 'Zeta'],
    )
  })

  it('breaks a tie on the count by label, so the order is stable to read', () => {
    const tied = makeGraph(
      [
        { id: 'x', type: 'application', label: 'Zeta' },
        { id: 'y', type: 'application', label: 'Alpha' },
        { id: 'i', type: 'item' },
        { id: 'j', type: 'item' },
      ],
      [
        ['i', 'ABOUT', 'x'],
        ['j', 'ABOUT', 'y'],
      ],
    )
    expect(runQuery(tied, pattern({})).rows.map((r) => r.node.label)).toEqual(['Alpha', 'Zeta'])
  })

  it('counts at least two, and never at least one under another name', () => {
    // `atLeast` with a 1 would answer the same set as `has` while the sentence
    // above it read "2 or more", so the floor is part of the rule.
    expect(ids(runQuery(graph, pattern({ quantifier: 'atLeast', atLeast: 2 })))).toEqual(['a1'])
    expect(ids(runQuery(graph, pattern({ quantifier: 'atLeast', atLeast: 1 })))).toEqual(['a1'])
    expect(ids(runQuery(graph, pattern({ quantifier: 'atLeast', atLeast: 3 })))).toEqual([])
    // Missing entirely, which the dropdown allows.
    expect(ids(runQuery(graph, pattern({ quantifier: 'atLeast' })))).toEqual(['a1'])
  })

  it('reads relationships in both directions, because nobody holds one in their head', () => {
    // Every edge here points item -> application; asking from the item's end
    // has to answer too.
    // Tied on one connection each, so the order is the label tiebreak:
    // Call, Deadline, Interview.
    expect(ids(runQuery(graph, pattern({ start: 'item', end: 'application' })))).toEqual([
      'i1',
      'i3',
      'i2',
    ])
  })

  it('takes any relationship when the question does not name one', () => {
    const anyRel = runQuery(graph, pattern({ start: 'any', rel: 'any', end: 'any' }))
    // a1 has four; k1 has two; everything with an edge has one; s1 has none and
    // is therefore not an answer to "has".
    // Ties break on the label, not the id: Austin, Baylor, Call, CV, Deadline,
    // Interview.
    expect(ids(anyRel)).toEqual(['a1', 'k1', 'a3', 'a2', 'i1', 'f1', 'i3', 'i2'])
    expect(anyRel.rows[0]!.count).toBe(4)
    expect(ids(anyRel)).not.toContain('s1')
  })

  it('narrows to the records one keyword tags, and leaves the keyword itself out', () => {
    const tagged = runQuery(graph, pattern({ start: 'any', end: 'any', rel: 'any', keywordId: 'k1' }))
    expect(ids(tagged)).toEqual(['a1', 'a3'])
    expect(ids(tagged)).not.toContain('k1')
  })

  it('keeps the keyword out through carriesKeyword, not through the guard above it', () => {
    /*
     * Worth recording rather than leaving as a passing assertion, because the
     * two mechanisms are not equally load-bearing and the test above cannot
     * tell them apart.
     *
     * `runPattern` skips the keyword twice: an explicit `node.id ===
     * query.keywordId` continue, and `carriesKeyword`, which asks for a TAGS
     * edge whose OTHER end is the keyword. Deleting the explicit guard changes
     * no answer to any question asked of a graph `buildGraph` produced, because
     * `otherEnd(edge, k1)` is never `k1` unless the keyword tags itself, and
     * `buildGraph` refuses a self-edge. The test above therefore passes with the
     * guard deleted and credits `carriesKeyword`'s work to it.
     *
     * The topology below is built by hand precisely because no snapshot can
     * reach it. That makes this a test of the guard and nothing else — which is
     * the honest scope, and is why it is a second `it` rather than another
     * assertion inside the first.
     */
    const selfTagging = makeGraph(
      [
        { id: 'k1', type: 'keyword', label: 'Referral' },
        { id: 'a1', type: 'application' },
      ],
      [
        ['k1', 'TAGS', 'a1'],
        // Only reachable by hand: buildGraph drops `from === to`.
        ['k1', 'TAGS', 'k1'],
      ],
    )
    expect(
      ids(runQuery(selfTagging, pattern({ start: 'any', rel: 'any', end: 'any', keywordId: 'k1' }))),
    ).toEqual(['a1'])
  })

  it('narrows on TAGS alone, not on any edge that happens to reach the keyword', () => {
    const odd = makeGraph(
      [
        { id: 'a1', type: 'application' },
        { id: 'k1', type: 'keyword' },
      ],
      [['a1', 'ABOUT', 'k1']],
    )
    expect(ids(runQuery(odd, pattern({ start: 'any', rel: 'any', end: 'any', keywordId: 'k1' })))).toEqual(
      [],
    )
  })

  it('filters timeline items by kind and by whether they are a reminder', () => {
    expect(
      ids(runQuery(graph, pattern({ start: 'item', end: 'application', startFacet: 'reminder' }))),
    ).toEqual(['i1'])
    expect(
      ids(runQuery(graph, pattern({ start: 'item', end: 'application', startFacet: 'interview' }))),
    ).toEqual(['i2'])
    expect(ids(runQuery(graph, pattern({ endFacet: 'deadline' })))).toEqual(['a2'])
  })

  it('lets a facet through on anything that is not a timeline item', () => {
    // The facet axis only exists for items. Applying it to a file would answer
    // nothing for every question that left the dropdown on a kind.
    expect(
      ids(runQuery(graph, pattern({ start: 'file', rel: 'FILED_UNDER', end: 'application', startFacet: 'call' }))),
    ).toEqual(['f1'])
  })
})

/* ------------------------ the table and the picture ------------------------ */

describe('the highlight and the table', () => {
  const check = (result: QueryResult) => {
    const rowIds = new Set(result.rows.map((r) => r.node.id))
    for (const id of rowIds) expect(result.nodes.has(id)).toBe(true)
    for (const row of result.rows) {
      for (const matched of row.matched) expect(result.nodes.has(matched.id)).toBe(true)
    }
    for (const edgeId of result.edges) {
      const edge = graph.edgeById.get(edgeId)
      expect(edge, `lit an edge the graph does not hold: ${edgeId}`).toBeDefined()
      expect(result.nodes.has(edge!.from) && result.nodes.has(edge!.to)).toBe(true)
    }
  }

  it('lights exactly the nodes the rows name, and both ends of every lit edge', () => {
    const result = runQuery(graph, pattern({}))
    // a1 and a2 are the rows; i1, i2 and i3 are what they matched.
    expect(result.nodes.size).toBe(5)
    expect(result.edges.size).toBe(3)
    check(result)
  })

  it('lights nothing at all for a negative answer', () => {
    // Every row counts zero, so there is no edge to trace — but the rows still
    // have to be there. This pair is what "two readings of one object" means.
    const result = runQuery(graph, pattern({ quantifier: 'missing' }))
    expect(result.rows).toHaveLength(1)
    expect(result.edges.size).toBe(0)
    expect(result.nodes.size).toBe(1)
    check(result)
  })

  it('answers an empty result rather than throwing when nothing matches', () => {
    const result = runQuery(graph, pattern({ start: 'snippet' }))
    expect(result.rows).toEqual([])
    expect(result.nodes.size).toBe(0)
    expect(result.emptyNote).toBeTruthy()
  })
})

/* ---------------------------------- paths ---------------------------------- */

describe('a path query', () => {
  it('walks the hops in order and names the relationship that got you there', () => {
    const result = runQuery(graph, { kind: 'path', from: 'i1', to: 'f1' })
    expect(ids(result)).toEqual(['i1', 'a1', 'f1'])
    expect(result.rows.map((r) => r.count)).toEqual([0, 1, 2])
    // The first row is where you started, so nothing got you there.
    expect(result.rows[0]!.via).toBeUndefined()
    expect(result.rows[1]!.via).toBe('ABOUT')
    expect(result.rows[2]!.via).toBe('FILED_UNDER')
    expect(result.countLabel).toBe('Hop')
  })

  it('points each row at the next one, which is what the Matched column prints', () => {
    const result = runQuery(graph, { kind: 'path', from: 'i1', to: 'f1' })
    expect(result.rows[0]!.matched.map((n) => n.id)).toEqual(['a1'])
    expect(result.rows[2]!.matched).toEqual([])
  })

  it('lights the whole route and nothing else', () => {
    const result = runQuery(graph, { kind: 'path', from: 'i1', to: 'f1' })
    expect([...result.nodes].sort()).toEqual(['a1', 'f1', 'i1'])
    expect(result.edges.size).toBe(2)
  })

  it('says there is no route rather than answering an empty pattern', () => {
    // The two empty answers are different sentences on screen, and the earlier
    // version of this panel printed the pattern one for an unconnected pair.
    const result = runQuery(graph, { kind: 'path', from: 'i1', to: 's1' })
    expect(result.rows).toEqual([])
    expect(result.emptyNote).toContain('No path')
    expect(result.countLabel).toBe('Hops')
    expect(result.nodes.size).toBe(0)
  })
})
