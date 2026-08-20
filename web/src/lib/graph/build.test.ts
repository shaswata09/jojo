/**
 * What `buildGraph` draws, and — more importantly — what it is allowed to leave out.
 *
 * `lib/graph.test.ts` reads as this file's coverage and is not: everything it
 * exercises (`filterGraph`, `shortestPath`) now re-exports from
 * `@jojo/service/core/algebra`, so it pins the shared traversal and nothing web
 * owns. `buildGraph` and the two label maps it feeds are the half that stayed
 * here, and until this file they had no test on either platform.
 *
 * The failure this is written against is not hypothetical. The phone's
 * equivalent of `lib/graph/model.ts` declares six relations where this one
 * declares seven: `BECAME` is missing from its `GraphRel` union, so a saved
 * posting that became an application draws no line there, and `source` is
 * missing from its node types. One model, two vocabularies, and nothing on
 * either side said so. The first two describes below are the check that would
 * have: they compare this file's unions against `EDGE_SCHEMA` and `RELS` in
 * `@jojo/service/core/model` rather than against a list restated here, so a
 * relation added to the store and not drawn fails, and a relation drawn under a
 * name the store does not use fails too.
 */

import { describe, expect, it } from 'vitest'
import { EDGE_SCHEMA, RELS } from '@jojo/service/core/model'
import type { Instant, NodeType, Rel, StoredEdge, StoredNode } from '@jojo/service/core/model'
import { MutableSnapshot } from '@jojo/service/core/snapshot'
import { bootInMemory } from '@jojo/service/repo/boot'
import { buildGraph, graphNodeId } from '@/lib/graph/build'
import { GRAPH_NODE_TYPES, GRAPH_RELS, NODE_TYPE_LABEL, REL_LABEL } from '@/lib/graph/model'
import type { Graph, GraphNodeType, GraphRel } from '@/lib/graph/model'

const NOW: Instant = new Date('2026-10-12T12:00:00').toISOString()

function seeded(): Graph {
  const { repo } = bootInMemory({ now: () => NOW })
  return buildGraph(repo.getSnapshot())
}

/**
 * The demo fixtures as `StoredNode`s, so a hand-built topology can borrow real
 * props instead of restating eleven prop shapes that only `core/model.ts`
 * should own. A fixture invented here would typecheck and could still be a
 * record the app never stores.
 */
function storedNodes(): readonly StoredNode[] {
  const { repo } = bootInMemory({ now: () => NOW })
  return repo.getSnapshot().nodes()
}

function firstOf<T extends NodeType>(nodes: readonly StoredNode[], type: T): StoredNode<T> {
  const found = nodes.find((n) => n.type === type)
  if (!found) throw new Error(`the demo fixtures hold no ${type}`)
  return found as StoredNode<T>
}

const edge = (from: string, rel: Rel, to: string): StoredEdge => ({
  id: `${from}|${rel}|${to}`,
  rel,
  from,
  to,
  props: {},
  createdAt: NOW,
})

/* --------------------------- the drawn vocabulary -------------------------- */

describe('the relations this page can draw', () => {
  it('spells every stored relation the way the store spells it', () => {
    // `IS` is the exception and the only one: an application IS a role tag is
    // synthesised from a prop here, so it has no `EDGE_SCHEMA` entry to agree
    // with. Everything else in GRAPH_RELS has to be a real `Rel`.
    const synthetic: readonly GraphRel[] = ['IS']
    const stored = GRAPH_RELS.filter((rel) => !synthetic.includes(rel))

    expect(stored.every((rel) => (RELS as readonly string[]).includes(rel))).toBe(true)
    // Stated positively too, so a GRAPH_RELS that shrank to nothing would fail
    // rather than pass an `every` over an empty list.
    expect(stored).toContain('BECAME')
    expect(stored.length).toBe(GRAPH_RELS.length - 1)
  })

  it('reads each one back in the store’s own words, so the two cannot drift', () => {
    // `REL_LABEL` used to restate six sentences that `EDGE_SCHEMA[rel].label`
    // already held. It is derived from them now; this asserts the derivation
    // still lands on the words the Answer table prints.
    expect(REL_LABEL.BECAME).toBe(EDGE_SCHEMA.BECAME.label)
    expect(REL_LABEL.TAGS).toBe(EDGE_SCHEMA.TAGS.label)
    expect(REL_LABEL.AT).toBe('is at')
    expect(REL_LABEL.IS).toBe('is a')
  })

  it('names every relation and every node type it declares', () => {
    // A missing entry renders `undefined` in the legend, the detail panel and
    // the query dropdown, all three of which index these maps by a union member.
    for (const rel of GRAPH_RELS) expect(REL_LABEL[rel]).toBeTruthy()
    for (const type of GRAPH_NODE_TYPES) expect(NODE_TYPE_LABEL[type]).toBeTruthy()
    expect(GRAPH_RELS.length).toBe(7)
    expect(GRAPH_NODE_TYPES.length).toBe(11)
  })
})

/* ------------------------------ the demo store ----------------------------- */

describe('the demo store, drawn', () => {
  const graph = seeded()
  const relsDrawn = new Set(graph.edges.map((e) => e.rel))
  const typesDrawn = new Set(graph.nodes.map((n) => n.type))

  it('draws the relation a saved posting turning into an application makes', () => {
    // The one the phone cannot draw at all. Two of them are in the fixtures.
    const became = graph.edges.filter((e) => e.rel === 'BECAME')
    expect(became.length).toBe(2)
    for (const e of became) {
      expect(graph.byId.get(e.from)?.type).toMatch(/^(posting|match)$/)
      expect(graph.byId.get(e.to)?.type).toBe('application')
    }
  })

  it('synthesises the two node types that are never stored', () => {
    expect(typesDrawn.has('role')).toBe(true)
    expect(typesDrawn.has('source')).toBe(true)
    // …and they carry no href, because there is no page to open.
    for (const node of graph.nodes) {
      if (node.type === 'role' || node.type === 'source') expect(node.href).toBeUndefined()
    }
  })

  it('gives one node per distinct role and source, not one per application', () => {
    const applications = graph.nodes.filter((n) => n.type === 'application')
    const roles = graph.nodes.filter((n) => n.type === 'role')
    expect(applications.length).toBe(12)
    expect(roles.length).toBe(4)
    // Every application is joined to exactly one role node.
    for (const app of applications) {
      const isEdges = (graph.incident.get(app.id) ?? [])
        .map((id) => graph.edgeById.get(id)!)
        .filter((e) => e.rel === 'IS')
      expect(isEdges).toHaveLength(1)
    }
  })

  it('leaves no line pointing at a node it did not draw', () => {
    for (const e of graph.edges) {
      expect(graph.byId.has(e.from)).toBe(true)
      expect(graph.byId.has(e.to)).toBe(true)
    }
    // The premise: the fixtures really do hold edges into undrawn types, so the
    // assertion above is filtering something rather than looking at nothing.
    const { repo } = bootInMemory({ now: () => NOW })
    const stored = repo.getSnapshot()
    const undrawn = stored.edges().filter((e) => !graph.edgeById.has(e.id))
    expect(undrawn.length).toBeGreaterThan(0)
  })

  it('counts degree over every edge, which is what node size and the aria label read', () => {
    const counted = new Map<string, number>()
    for (const e of graph.edges) {
      for (const end of [e.from, e.to]) counted.set(end, (counted.get(end) ?? 0) + 1)
    }
    for (const node of graph.nodes) expect(node.degree).toBe(counted.get(node.id) ?? 0)
    // `incident` has to agree with it — the canvas walks one and sizes by the
    // other, and a disagreement is a node drawn big with nothing attached.
    for (const node of graph.nodes) {
      expect((graph.incident.get(node.id) ?? []).length).toBe(node.degree)
    }
    expect([...counted.values()].reduce((a, b) => a + b, 0)).toBe(graph.edges.length * 2)
  })

  it('sends every record that has a page to that page, and the rest nowhere', () => {
    // Per type rather than in aggregate: a count over the whole graph stayed
    // comfortably above any threshold with all twelve applications' hrefs
    // deleted, which is the one route on this page anybody clicks.
    const ROUTED: Partial<Record<GraphNodeType, RegExp>> = {
      application: /^\/applications\//,
      organisation: /^\/applications\?/,
      item: /^\/calendar/,
      link: /^\/vault\?tool=links/,
      file: /^\/vault\?tool=files/,
      snippet: /^\/vault\?tool=snippets/,
      posting: /^\/scout/,
      match: /^\/scout/,
    }
    // Keywords are stored and still have nowhere to go; roles and sources are
    // not records at all.
    const UNROUTED: readonly GraphNodeType[] = ['keyword', 'role', 'source']

    for (const [type, pattern] of Object.entries(ROUTED) as [GraphNodeType, RegExp][]) {
      const drawn = graph.nodes.filter((n) => n.type === type)
      expect(drawn.length, `nothing of type ${type} was drawn`).toBeGreaterThan(0)
      for (const node of drawn) expect(node.href ?? '').toMatch(pattern)
    }
    for (const type of UNROUTED) {
      for (const node of graph.nodes) if (node.type === type) expect(node.href).toBeUndefined()
    }
    // Every type is accounted for by one list or the other, so a type added to
    // GRAPH_NODE_TYPES has to be given a route or declared to have none.
    expect([...Object.keys(ROUTED), ...UNROUTED].sort()).toEqual([...GRAPH_NODE_TYPES].sort())
  })

  it('draws the relations the fixtures contain and refuses the ones it excludes', () => {
    expect([...relsDrawn].sort()).toEqual(['ABOUT', 'AT', 'BECAME', 'FROM', 'IS', 'TAGS'])
    // COPY_OF is a stored relation this page deliberately does not draw. If the
    // fixtures ever grow one, this is where the decision gets asked again.
    expect(relsDrawn.has('COPY_OF' as GraphRel)).toBe(false)
  })
})

/* ---------------------------- the structural rules ------------------------- */

describe('the rules a hand-built topology can show', () => {
  const nodes = storedNodes()
  const application = firstOf(nodes, 'application')
  const item = firstOf(nodes, 'timelineItem')
  const link = firstOf(nodes, 'link')
  const pipeline = firstOf(nodes, 'pipeline')

  const build = (keep: readonly StoredNode[], edges: readonly StoredEdge[]) =>
    buildGraph(MutableSnapshot.from(keep, edges))

  /**
   * Only the relation under test. Every application also contributes its `IS`
   * role edge and, when it has a source, a `FROM` — counting all of them would
   * make each assertion below a sum of two unrelated rules.
   */
  const drawn = (graph: Graph, rel: GraphRel) => graph.edges.filter((e) => e.rel === rel)

  it('drops a relation it does not draw, between two nodes it does', () => {
    const filed = build([application, link], [edge(link.id, 'FILED_UNDER', application.id)])
    expect(drawn(filed, 'FILED_UNDER')).toHaveLength(1)

    const copied = build([application, link], [edge(link.id, 'COPY_OF', application.id)])
    expect(copied.edges.filter((e) => e.from === link.id)).toHaveLength(0)
  })

  it('drops an edge whose far end is a type this page hides', () => {
    // A pipeline is a saved search over a job board. Drawing the line without
    // the node would put a stroke into empty space.
    const graph = build([application, pipeline], [edge(application.id, 'ABOUT', pipeline.id)])
    expect(graph.byId.has(pipeline.id)).toBe(false)
    expect(drawn(graph, 'ABOUT')).toHaveLength(0)
    // The application itself is still drawn — the edge went, not the record.
    expect(graph.byId.has(application.id)).toBe(true)
  })

  it('counts one edge once, however many times the store names it', () => {
    // A drawn edge id IS the stored edge id — `${from}|${rel}|${to}` — so a
    // snapshot cannot hand this two rows for one line, and `addEdge`'s own
    // id guard is unreachable from here. What is reachable, and what this pins,
    // is that a node's degree counts edges rather than mentions of them.
    const twice = build(
      [application, item],
      [edge(item.id, 'ABOUT', application.id), edge(item.id, 'ABOUT', application.id)],
    )
    expect(drawn(twice, 'ABOUT')).toHaveLength(1)
    expect(twice.byId.get(item.id)?.degree).toBe(1)
  })

  it('refuses a loop, which would draw a line from a node to itself', () => {
    const looped = build([item], [edge(item.id, 'ABOUT', item.id)])
    expect(looped.edges).toHaveLength(0)
    expect(looped.byId.get(item.id)?.degree).toBe(0)
  })

  it('gives two applications sharing a role tag one role node between them', () => {
    const second: StoredNode<'application'> = {
      ...application,
      id: `app:${'0'.repeat(8)}-0000-7000-8000-000000000001`,
      props: { ...application.props, slug: 'second' },
    }
    const shared = build([application, second], [])
    const roleId = graphNodeId('role', application.props.roleTag)
    expect(shared.nodes.filter((n) => n.type === 'role')).toHaveLength(1)
    expect(shared.byId.get(roleId)?.degree).toBe(2)
  })

  it('folds two spellings of one role tag onto one node', () => {
    // 'UT Austin' and 'ut  austin' are the same employer to a reader, and two
    // separate dots on a canvas is the kind of answer that reads as a bug.
    expect(graphNodeId('role', 'Assistant Professor')).toBe(
      graphNodeId('role', '  assistant   professor  '),
    )
  })

  it('draws nothing at all from an empty store', () => {
    const empty = buildGraph(MutableSnapshot.from([], []))
    expect(empty.nodes).toEqual([])
    expect(empty.edges).toEqual([])
    expect(empty.incident.size).toBe(0)
  })
})

/* --------------------------- one node of each type ------------------------- */

describe('what a node says about itself', () => {
  const graph = seeded()
  const oneOf = (type: GraphNodeType) => {
    const found = graph.nodes.find((n) => n.type === type)
    if (!found) throw new Error(`nothing of type ${type} was drawn`)
    return found
  }

  it('names an application by employer and role together', () => {
    // `displayName`, not the role alone: 'Statistics' names four of the twelve.
    expect(oneOf('application').label).toContain('—')
  })

  it('gives a timeline item its date as the detail line and its kind for the glyph', () => {
    const node = oneOf('item')
    expect(node.detail).toBeTruthy()
    expect(node.itemKind).toBeTruthy()
    expect(typeof node.reminder).toBe('boolean')
  })

  it('says how well a scout match fits, in the units the Job Scout prints', () => {
    expect(oneOf('match').detail).toMatch(/^\d+% fit$/)
  })

  it('carries the record id every node was built from', () => {
    for (const node of graph.nodes) expect(node.recordId).toBeTruthy()
    // Stored nodes answer to their own NodeId; the two synthesised types answer
    // to the value they were made from, which is what the detail panel prints.
    expect(oneOf('role').recordId).toBe(oneOf('role').label)
  })
})
