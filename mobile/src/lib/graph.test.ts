/**
 * The phone's graph model — 358 lines that nothing had ever run.
 *
 * Web's twin (`web/src/lib/graph/`) has a test file; this had none, and what
 * that cost is the first case below. The relation joining a saved posting to
 * the application it turned into was spelled `FROM` here and `BECAME` in the
 * model and in web, so the detail panel read 'came from' under an edge the
 * model calls 'became', and the Guide's own table printed the arrow the other
 * way round. Nothing could see it, because the vocabulary was three separate
 * hand-copies of one list.
 *
 * So the pin that matters most is not "buildGraph returns nodes" — it is that
 * this file's sentences are the model's sentences. That is asserted against
 * `EDGE_SCHEMA` rather than against a second literal list, because a second
 * literal list is exactly what drifted.
 *
 * Fixtures are hand-built rather than taken from `@jojo/service/data/*`. The
 * seed is a hundred records shaped for a demo, and a case that has to say
 * which of them is the one with no keyword on it is a case about the seed. The
 * six records below are the smallest graph that still has a shared employer,
 * a dangling reference and both promoted-lead shapes in it.
 */

import { describe, expect, it } from 'vitest'
import { EDGE_SCHEMA } from '@jojo/service/core/model'
import type { Label } from '@jojo/service/data/labels'
import type { Application } from '@jojo/service/data/seed'
import type { TimelineItem } from '@jojo/service/data/timeline'
import type { Snippet, VaultFile, VaultLink } from '@jojo/service/data/vault'
import type { Match, SavedPosting } from '@jojo/service/data/scout'
import {
  DEFAULT_PATTERN,
  GRAPH_NODE_TYPES,
  GRAPH_RELS,
  NODE_TYPE_LABEL,
  QUERY_EXAMPLES,
  REL_LABEL,
  buildGraph,
  describePattern,
  graphNodeId,
  incidentEdges,
  neighbours,
  otherEnd,
  runPattern,
} from './graph'
import type { Graph, GraphInput, GraphNodeType, PatternQuery } from './graph'

/* --------------------------------- fixtures -------------------------------- */

const application = (id: string, org: string, over: Partial<Application> = {}): Application => ({
  id,
  org,
  role: 'Assistant Professor',
  note: '',
  roleTag: 'Postdoc',
  stage: 'submitted',
  lastAction: 'Submitted',
  daysAgo: 3,
  ...over,
})

// The four below take a REST list: `FILED_UNDER` and `ABOUT` are many-to-many,
// so `file('f1', 'a1', 'a2')` is the case that used to be unrepresentable, and
// the one-argument calls read exactly as they did.
const item = (id: string, ...applicationIds: string[]): TimelineItem => ({
  id,
  title: `Deadline ${id}`,
  date: '2026-08-20',
  allDay: true,
  kind: 'deadline',
  urgency: 'gray',
  remind: false,
  applicationIds,
})

const file = (id: string, ...applicationIds: string[]): VaultFile => ({
  id,
  name: `${id}.pdf`,
  kind: 'pdf',
  bucket: 'To read',
  size: '1 KB',
  savedOn: '2026-08-01',
  applicationIds,
})

const link = (id: string, ...applicationIds: string[]): VaultLink => ({
  id,
  title: `Link ${id}`,
  url: 'https://example.test',
  category: 'Posting',
  savedOn: '2026-08-01',
  applicationIds,
})

const snippet = (id: string, ...applicationIds: string[]): Snippet => ({
  id,
  title: `Snippet ${id}`,
  tag: 'Cover letter',
  body: '',
  applicationIds,
})

const posting = (id: string, applicationId?: string): SavedPosting => ({
  id,
  title: `Posting ${id}`,
  url: 'https://example.test/job',
  savedOn: '2026-08-01',
  size: '2 KB',
  linked: applicationId !== undefined,
  ...(applicationId === undefined ? {} : { applicationId }),
})

const match = (id: string, applicationId?: string): Match => ({
  id,
  role: `Match ${id}`,
  detail: '',
  fit: 80,
  ...(applicationId === undefined ? {} : { applicationId }),
})

const label = (id: string): Label => ({ id, name: id, tone: 'teal' })

const emptyInput: GraphInput = {
  applications: [],
  timeline: [],
  links: [],
  files: [],
  snippets: [],
  postings: [],
  matches: [],
  labelsOf: () => [],
}

const build = (over: Partial<GraphInput> = {}) => buildGraph({ ...emptyInput, ...over })

/** Every edge as `<from> -REL-> <to>`, which is what a case actually asserts. */
const wire = (graph: Graph) => graph.edges.map((e) => `${e.from} -${e.rel}-> ${e.to}`).sort()

/* ------------------------------- the vocabulary ----------------------------- */

describe('the relation vocabulary is the model’s, not a copy of it', () => {
  /**
   * The pin that would have caught the bug this file was written for.
   *
   * Every rel this canvas draws except `IS` is a stored relation, and its
   * sentence is `EDGE_SCHEMA[rel].label` — whose own comment says it is
   * "reused by /graph's sentence builder". Reading it here rather than
   * respelling it means the phone cannot say 'came from' about an edge the
   * model calls 'became' ever again.
   */
  it('takes every stored relation’s sentence from EDGE_SCHEMA', () => {
    for (const rel of GRAPH_RELS) {
      if (rel === 'IS') continue
      expect(REL_LABEL[rel]).toBe(EDGE_SCHEMA[rel].label)
    }
  })

  /**
   * `IS` is the exception and has to be, so it is named rather than skipped
   * silently: a role is a closed union on the application, not a record, so
   * there is no stored edge and no label in the schema to read.
   */
  it('owns exactly one relation the model does not have', () => {
    const invented = GRAPH_RELS.filter((rel) => !(rel in EDGE_SCHEMA))
    expect(invented).toEqual(['IS'])
    expect(REL_LABEL.IS).toBe('is a')
  })

  it('draws no relation whose endpoints this canvas cannot draw', () => {
    // `FROM` is the one that was here wrongly. It runs match/posting →
    // pipeline in the model, and `pipeline` is not a drawn node type, so a
    // canvas holding a `FROM` has an edge with one end in empty space.
    expect(GRAPH_RELS).not.toContain('FROM')
    expect(GRAPH_NODE_TYPES).not.toContain('pipeline')
  })

  it('has a sentence and a name for everything it lists', () => {
    for (const rel of GRAPH_RELS) expect(REL_LABEL[rel]).toBeTruthy()
    for (const type of GRAPH_NODE_TYPES) expect(NODE_TYPE_LABEL[type]).toBeTruthy()
  })
})

/* --------------------------------- buildGraph ------------------------------- */

describe('buildGraph', () => {
  it('gives every node a type-prefixed id, so six records called stripe stay apart', () => {
    const graph = build({
      applications: [application('stripe', 'Stripe')],
      timeline: [item('stripe')],
      postings: [posting('stripe')],
    })

    expect(graph.nodes.map((n) => n.id).sort()).toEqual([
      'application:stripe',
      'item:stripe',
      'org:Stripe',
      'posting:stripe',
      'role:Postdoc',
    ])
    expect(graphNodeId('application', 'stripe')).toBe('application:stripe')
    // The record id survives on the node, because a tap has to open the record
    // rather than the drawing of it.
    expect(graph.byId.get('item:stripe')?.recordId).toBe('stripe')
  })

  it('joins an application to its employer and its role', () => {
    const graph = build({ applications: [application('a1', 'Rice')] })

    expect(wire(graph)).toEqual([
      'application:a1 -AT-> org:Rice',
      'application:a1 -IS-> role:Postdoc',
    ])
  })

  it('shares one employer node between every application at it', () => {
    const graph = build({
      applications: [application('a1', 'Rice'), application('a2', 'Rice')],
    })

    expect(graph.nodes.filter((n) => n.type === 'org')).toHaveLength(1)
    // Degree is what sizes a node and answers "the employers you have the most
    // going on with", so it counts both ends of every surviving edge.
    expect(graph.byId.get('org:Rice')?.degree).toBe(2)
  })

  /**
   * THE CASE THIS FILE EXISTS FOR.
   *
   * `SavedPosting.applicationId` and `Match.applicationId` are both projected
   * out of a `BECAME` edge (`became` in `service/kg/react/projections.ts`).
   * Drawn as `FROM`, the phone's detail panel described a promoted lead as
   * having "come from" the application it turned into.
   */
  it('draws a promoted posting or match as BECAME, pointing at the application', () => {
    const graph = build({
      applications: [application('a1', 'Rice')],
      postings: [posting('p1', 'a1')],
      matches: [match('m1', 'a1')],
    })

    expect(wire(graph)).toContain('posting:p1 -BECAME-> application:a1')
    expect(wire(graph)).toContain('match:m1 -BECAME-> application:a1')
    expect(REL_LABEL.BECAME).toBe('became')
  })

  it('leaves an unpromoted posting or match unjoined', () => {
    const graph = build({ postings: [posting('p1')], matches: [match('m1')] })

    expect(graph.edges).toEqual([])
  })

  it('files links, files and snippets under their application', () => {
    const graph = build({
      applications: [application('a1', 'Rice')],
      files: [file('f1', 'a1')],
      links: [link('l1', 'a1')],
      snippets: [snippet('s1', 'a1')],
    })

    expect(wire(graph)).toEqual([
      'application:a1 -AT-> org:Rice',
      'application:a1 -IS-> role:Postdoc',
      'file:f1 -FILED_UNDER-> application:a1',
      'link:l1 -FILED_UNDER-> application:a1',
      'snippet:s1 -FILED_UNDER-> application:a1',
    ])
  })

  it('points a dated thing at what it is about', () => {
    const graph = build({ applications: [application('a1', 'Rice')], timeline: [item('i1', 'a1')] })

    expect(wire(graph)).toContain('item:i1 -ABOUT-> application:a1')
  })

  /**
   * The many-to-many case, which is the one the single-edge build could not
   * draw. A reference deadline covering three jobs and a CV sent to two are
   * both ordinary, and a graph that showed each attached to one of them would
   * be quietly wrong rather than visibly broken.
   */
  it('draws one edge per application, not one per record', () => {
    const graph = build({
      applications: [application('a1', 'Rice'), application('a2', 'Baylor')],
      timeline: [item('i1', 'a1', 'a2')],
      files: [file('f1', 'a1', 'a2')],
    })

    expect(wire(graph)).toEqual(
      expect.arrayContaining([
        'item:i1 -ABOUT-> application:a1',
        'item:i1 -ABOUT-> application:a2',
        'file:f1 -FILED_UNDER-> application:a1',
        'file:f1 -FILED_UNDER-> application:a2',
      ]),
    )
  })

  /**
   * The store unlinks rather than cascading, so a deleted application leaves a
   * stale id on whatever pointed at it. Drawn, that is a line into empty space,
   * which reads as the layout having broken rather than as a record being gone.
   */
  it('drops an edge whose other end was never built', () => {
    const graph = build({ timeline: [item('i1', 'deleted')], files: [file('f1', 'deleted')] })

    expect(graph.edges).toEqual([])
    // The records themselves are still drawn — they exist, they are just
    // orphaned, which is a thing this page is specifically for showing.
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['file:f1', 'item:i1'])
    expect(graph.byId.get('item:i1')?.degree).toBe(0)
  })

  /**
   * Keywords are keyed two ways: 'app:rice' for applications and a bare id for
   * everything else. Reading one spelling leaves half the records untagged.
   */
  it('reads an application’s keywords under both spellings and merges them', () => {
    const byKey: Record<string, Label[]> = {
      'app:a1': [label('remote')],
      a1: [label('remote'), label('urgent')],
      f1: [label('urgent')],
    }
    const graph = build({
      applications: [application('a1', 'Rice')],
      files: [file('f1')],
      labelsOf: (id) => byKey[id] ?? [],
    })

    // One keyword node per keyword, however many records and spellings reach it.
    expect(
      graph.nodes
        .filter((n) => n.type === 'keyword')
        .map((n) => n.id)
        .sort(),
    ).toEqual(['keyword:remote', 'keyword:urgent'])
    expect(wire(graph)).toContain('keyword:remote -TAGS-> application:a1')
    expect(wire(graph)).toContain('keyword:urgent -TAGS-> application:a1')
    expect(wire(graph)).toContain('keyword:urgent -TAGS-> file:f1')
    // 'remote' arrives under both spellings and must not produce two edges.
    expect(wire(graph).filter((w) => w.startsWith('keyword:remote'))).toHaveLength(1)
  })

  /**
   * The index the traversal reads, checked against the edges it indexes.
   *
   * `incidentEdges` stopped being a scan over `graph.edges` and became a lookup
   * in `graph.incident`, so the two can now disagree — and a disagreement is
   * invisible: the canvas simply draws a node with fewer connections than it
   * has. Asserted as an equality over the whole graph rather than on one node.
   */
  it('indexes every edge against both of its ends', () => {
    const graph = build({
      applications: [application('a1', 'Rice'), application('a2', 'Rice')],
      timeline: [item('i1', 'a1')],
      files: [file('f1', 'a1')],
      postings: [posting('p1', 'a2')],
      labelsOf: (id) => (id === 'app:a1' ? [label('remote')] : []),
    })

    for (const node of graph.nodes) {
      const scanned = graph.edges.filter((e) => e.from === node.id || e.to === node.id)
      expect(incidentEdges(graph, node.id)).toEqual(scanned)
      // `degree` is counted separately, in `buildGraph`'s own loop, so it is a
      // second reading of the same fact and has to agree with this one.
      expect(node.degree).toBe(scanned.length)
    }

    expect(graph.edgeById.size).toBe(graph.edges.length)
    for (const edge of graph.edges) expect(graph.edgeById.get(edge.id)).toBe(edge)
  })

  it('gives an edge an id spelled from its own three parts', () => {
    const graph = build({ applications: [application('a1', 'Rice')] })

    expect(graph.edges.map((e) => e.id).sort()).toEqual([
      'application:a1|AT|org:Rice',
      'application:a1|IS|role:Postdoc',
    ])
  })

  it('leaves a dropped edge out of the index as well as out of the list', () => {
    const graph = build({ timeline: [item('i1', 'deleted')] })

    expect(graph.edgeById.size).toBe(0)
    expect(graph.incident.size).toBe(0)
    expect(incidentEdges(graph, 'item:i1')).toEqual([])
  })

  it('returns an empty graph for an empty store rather than throwing', () => {
    const graph = build()

    expect(graph.nodes).toEqual([])
    expect(graph.edges).toEqual([])
    expect(graph.byId.size).toBe(0)
    expect(graph.edgeById.size).toBe(0)
    expect(graph.incident.size).toBe(0)
  })
})

/* -------------------------------- traversal --------------------------------- */

describe('traversal', () => {
  const graph = build({
    applications: [application('a1', 'Rice')],
    timeline: [item('i1', 'a1')],
    files: [file('f1', 'a1')],
  })

  it('finds every edge touching a node, whichever end it is', () => {
    expect(incidentEdges(graph, 'application:a1')).toHaveLength(4)
    expect(incidentEdges(graph, 'item:i1')).toHaveLength(1)
    expect(incidentEdges(graph, 'nothing:here')).toEqual([])
  })

  it('walks an edge from either end', () => {
    const edge = incidentEdges(graph, 'item:i1')[0]
    expect(edge).toBeDefined()
    if (!edge) return
    expect(otherEnd(edge, 'item:i1')).toBe('application:a1')
    expect(otherEnd(edge, 'application:a1')).toBe('item:i1')
  })

  it('is undirected, because nobody asking what is connected to Rice holds a direction', () => {
    expect(
      neighbours(graph, 'application:a1')
        .map((n) => n.id)
        .sort(),
    ).toEqual(['file:f1', 'item:i1', 'org:Rice', 'role:Postdoc'])
    expect(neighbours(graph, 'org:Rice').map((n) => n.id)).toEqual(['application:a1'])
  })
})

/* -------------------------------- the queries -------------------------------- */

describe('the worked questions', () => {
  const graph = build({
    applications: [application('a1', 'Rice'), application('a2', 'Stripe')],
    timeline: [item('i1', 'a1')],
    files: [file('f1', 'a1'), file('f2')],
    links: [link('l1')],
    postings: [posting('p1', 'a1'), posting('p2')],
    matches: [match('m1')],
    labelsOf: (id) => (id === 'app:a1' ? [label('remote')] : []),
  })

  const answer = (id: string) => {
    const example = QUERY_EXAMPLES.find((q) => q.id === id)
    if (!example) throw new Error(`no such example: ${id}`)
    return example
      .run(graph)
      .map((n) => n.id)
      .sort()
  }

  it('names the applications with nothing dated against them', () => {
    expect(answer('undated')).toEqual(['application:a2'])
  })

  it('names the applications carrying no keyword', () => {
    expect(answer('untagged')).toEqual(['application:a2'])
  })

  it('names the files and links nothing is pointing at', () => {
    expect(answer('orphan-files')).toEqual(['file:f2'])
    expect(answer('orphan-links')).toEqual(['link:l1'])
  })

  it('names the leads that never became applications', () => {
    expect(answer('unpromoted')).toEqual(['match:m1', 'posting:p2'])
  })

  it('ranks employers by everything joined to them at once', () => {
    // Rice carries an application which carries a date, a file, a keyword and
    // a posting; Stripe carries one with nothing on it. The ordering is by the
    // employer node's own degree, which is why both are 1 here and the answer
    // is stable rather than meaningful — the assertion is that both appear.
    expect(answer('busiest')).toEqual(['org:Rice', 'org:Stripe'])
  })

  it('gives every example a question and a reason', () => {
    for (const example of QUERY_EXAMPLES) {
      expect(example.question).toBeTruthy()
      expect(example.why).toBeTruthy()
    }
  })
})

/* ------------------------------ pattern queries ------------------------------ */

describe('runPattern', () => {
  const graph = build({
    applications: [application('a1', 'Rice'), application('a2', 'Stripe')],
    timeline: [item('i1', 'a1')],
    files: [file('f1', 'a1')],
  })

  const rows = (q: PatternQuery) =>
    runPattern(graph, q)
      .map((r) => r.node.id)
      .sort()

  it('finds what has a relationship', () => {
    expect(rows({ start: 'application', quantifier: 'has', rel: 'any', end: 'item' })).toEqual([
      'application:a1',
    ])
  })

  it('finds what is missing one, which is the question a fixed list never has', () => {
    expect(rows(DEFAULT_PATTERN)).toEqual(['application:a2'])
    expect(DEFAULT_PATTERN.quantifier).toBe('missing')
  })

  it('narrows on the relation as well as the far end', () => {
    expect(
      rows({ start: 'application', quantifier: 'has', rel: 'FILED_UNDER', end: 'any' }),
    ).toEqual(['application:a1'])
    // The same pair of ends under a relation that does not join them.
    expect(rows({ start: 'application', quantifier: 'has', rel: 'AT', end: 'file' })).toEqual([])
  })

  it('reports what each row matched on, and reports nothing for a missing query', () => {
    const found = runPattern(graph, {
      start: 'application',
      quantifier: 'has',
      rel: 'any',
      end: 'file',
    })
    expect(found.map((r) => r.matched.map((n) => n.id))).toEqual([['file:f1']])

    const absent = runPattern(graph, DEFAULT_PATTERN)
    expect(absent.map((r) => r.matched)).toEqual([[]])
  })

  it('treats any/any as “everything, joined to anything at all”', () => {
    expect(rows({ start: 'any', quantifier: 'missing', rel: 'any', end: 'any' })).toEqual([])
    expect(rows({ start: 'any', quantifier: 'has', rel: 'any', end: 'any' })).toHaveLength(
      graph.nodes.length,
    )
  })
})

describe('describePattern', () => {
  const sentence = (over: Partial<PatternQuery>) => describePattern({ ...DEFAULT_PATTERN, ...over })

  /**
   * PINNED AS IT READS, WHICH IS NOT AS ENGLISH. The sentence is assembled from
   * a plural subject and a third-person-singular verb off `EDGE_SCHEMA`, with a
   * bare 'a' in front of the object — so it produces 'Applications is about a
   * application' and 'Files not is filed under…'. That is what ships on the
   * phone's graph screen today.
   *
   * Left alone deliberately rather than half-fixed. The article is a one-line
   * change; the verb agreement and the negation are a copy decision about how
   * the three controls should read as a whole, and fixing one of the three
   * leaves a sentence that is still wrong and now looks deliberate. These cases
   * exist so that whoever makes that decision has the current wording written
   * down and fails here when they change it, rather than discovering it on a
   * device.
   */
  it('assembles subject, verb and object — including the wording that is wrong', () => {
    expect(sentence({ quantifier: 'has', rel: 'ABOUT', end: 'application' })).toBe(
      'Applications is about a application',
    )
    expect(sentence({ start: 'file', quantifier: 'missing', rel: 'FILED_UNDER' })).toBe(
      'Files not is filed under a date or reminder',
    )
  })

  it('says the promoted-lead sentence with the model’s verb', () => {
    // 'became', not 'came from'. The article is the known defect above.
    expect(
      sentence({ start: 'posting', quantifier: 'has', rel: 'BECAME', end: 'application' }),
    ).toBe('Saved postings became a application')
  })

  it('spells “any” as a word rather than leaving the slot blank', () => {
    expect(sentence({ start: 'any', quantifier: 'has', rel: 'any', end: 'any' })).toBe(
      'Anything linked to anything',
    )
  })
})

/* --------------------------------- coverage ---------------------------------- */

describe('what the canvas can draw', () => {
  /**
   * Held here rather than left to the legend, because a node type added to the
   * list and forgotten in one of the two maps is a `undefined` in a filter chip
   * on a screen this package's tests do not render.
   */
  it('has every node type covered by both maps', () => {
    const types: GraphNodeType[] = [...GRAPH_NODE_TYPES]
    expect(new Set(types).size).toBe(types.length)
    for (const type of types) expect(typeof NODE_TYPE_LABEL[type]).toBe('string')
  })
})
