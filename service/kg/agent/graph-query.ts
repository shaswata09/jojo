/**
 * L3.5 — "Ask the graph", as a query a model can write.
 *
 * The web app has had a visual query builder for this since long before there
 * was a model to talk to: pick a record type, pick a relationship, pick "has" or
 * "missing", get a table. It answers real questions — "applications with no
 * follow-up scheduled" is the one that costs people interviews — and the reason
 * it was a builder and not a text box is that a text box needs something to
 * parse and nobody wanted to invent a query language.
 *
 * A model removes that objection without removing the reason for it. The model
 * writes the STRUCTURE, not a string: `graph.query` takes the same shape the
 * builder produces, goes through the same schema every other tool's arguments
 * go through, and runs against the same engine. There is no string to parse, no
 * expression to evaluate, and nothing a bad generation can do except fail the
 * parse and be told why.
 *
 * WHY IT RUNS ON THE KG GRAPH AND NOT ON EITHER APP'S CANVAS. Both apps build a
 * presentation graph for drawing, and they are not the same one: web's has
 * `organisation`, `role` and `source`, mobile's has `org` and neither of the
 * others, because a 390pt canvas leaves out what a 1200px one can afford. A
 * query language defined over a drawing is a query language that answers
 * different questions on a phone. The kg graph underneath is identical
 * everywhere — eleven node types, seven relations — so that is what this asks.
 * Each app maps the answer back onto its own canvas by `recordId`, which both
 * of them already carry for exactly this kind of crossing.
 */

import { NODE_TYPES, RELS, TIMELINE_KIND_VALUES } from '../core/model'
import type { NodeId, NodeType, Rel, StoredNode } from '../core/model'
import type { GraphSnapshot } from '../core/snapshot'
import { s } from '../core/schema'
import { labelOf, render } from './queries'
import type { AgentRecord } from './queries'

/* -------------------------------- the shape ------------------------------- */

/**
 * The extra axis timeline items need.
 *
 * "Applications with no follow-up scheduled" and "reminders not linked to any
 * application" are the two questions a job-seeker actually asks, and neither is
 * expressible in node types alone: a follow-up is a `kind`, a reminder is a
 * flag. Every other node type ignores this.
 */
export const ITEM_FACETS = ['any', 'reminder', ...TIMELINE_KIND_VALUES] as const

export type ItemFacet = (typeof ITEM_FACETS)[number]

export type Quantifier = 'has' | 'missing' | 'atLeast'

export type PatternQuery = {
  kind: 'pattern'
  start: NodeType | 'any'
  startFacet?: ItemFacet
  quantifier: Quantifier
  /** Only for `atLeast`. Ignored otherwise. */
  atLeast?: number
  rel: Rel | 'any'
  end: NodeType | 'any'
  endFacet?: ItemFacet
  /**
   * Narrows the starting set to records carrying this keyword, BY NAME.
   *
   * By name rather than by id, unlike every other reference in the tool layer.
   * A keyword is the one record a person names in the question itself — "my
   * flagged Teaching applications" — so requiring an id here would force a
   * lookup round trip to turn a word the user already said into an id, every
   * time. Matched case-insensitively against the keyword's own name.
   */
  keyword?: string
}

export type PathQuery = {
  kind: 'path'
  /**
   * An id, or a label to match. See `resolve`.
   *
   * Optional here because the SCHEMA makes them optional — one input shape is
   * shared by both query kinds, and a pattern query names neither. Declaring
   * them required was the lie that let `runPath` call `.trim()` on undefined.
   */
  from?: string
  to?: string
}

export type GraphQuery = PatternQuery | PathQuery

export type QueryRow = {
  record: AgentRecord
  /** What it matched on. Empty for a `missing` query — that is the point. */
  matched: AgentRecord[]
  count: number
  /** Path queries only: the relationship that got you to this node. */
  via?: Rel
}

export type GraphQueryResult = {
  /** Prose, because the model has to be able to say the answer out loud. */
  summary: string
  rows: QueryRow[]
  /** Every id involved, so a canvas can highlight exactly the subgraph. */
  highlight: NodeId[]
}

/* -------------------------------- the schema ------------------------------ */

const facet = (label: string) =>
  s.optional(
    s.enum(ITEM_FACETS, {
      label,
      description:
        'Only for timelineItem. "reminder" means the item has a reminder set; the rest are kinds of item.',
    }),
  )

export const GRAPH_QUERY_SCHEMA = s.object({
  kind: s.enum(['pattern', 'path'] as const, {
    label: 'Question',
    description:
      '"pattern" finds records that have, lack, or have several of a relationship. "path" finds how two named records are joined.',
  }),
  start: s.optional(
    s.enum([...NODE_TYPES, 'any'] as const, {
      label: 'Records to look at',
      // Says TYPE NAME and says "not an id" because models put ids here.
      // Measured: Gemma and Qwen both answered "which applications share a
      // keyword" with `start: "application", end: "app:01a09f2…"` — the type in
      // one field and a specific record in the other, which is a coherent
      // reading of "the kind of record on the other end" if you are skimming.
      // It costs a refused call and a round trip on a local model.
      description:
        'pattern only. A TYPE NAME such as "application" or "keyword" — never the id of a particular record. The answer is a list of records of this type.',
    }),
  ),
  startFacet: facet('Facet of the starting records'),
  quantifier: s.optional(
    s.enum(['has', 'missing', 'atLeast'] as const, {
      label: 'Condition',
      description:
        'pattern only. "missing" is the useful one: records with NO such relationship.',
    }),
  ),
  atLeast: s.optional(
    s.number({ label: 'At least', description: 'Only with quantifier "atLeast".', min: 1 }),
  ),
  rel: s.optional(
    s.enum([...RELS, 'any'] as const, {
      label: 'Relationship',
      description:
        'pattern only. AT joins an application to an organisation, ABOUT joins a timeline item to an application, FILED_UNDER joins a vault record to an application, TAGS joins a keyword to anything.',
    }),
  ),
  end: s.optional(
    s.enum([...NODE_TYPES, 'any'] as const, {
      label: 'Joined to',
      description:
        'pattern only. A TYPE NAME, like "start" — never the id of a particular record. To ask about one named record, use kind "path" and its id, or memory.related.',
    }),
  ),
  endFacet: facet('Facet of the joined records'),
  keyword: s.optional(
    s.string({
      label: 'Keyword',
      description: 'pattern only. Narrow to records carrying this keyword, by its name.',
    }),
  ),
  from: s.optional(
    s.string({ label: 'From', description: 'path only. An id, or the name of a record.' }),
  ),
  to: s.optional(s.string({ label: 'To', description: 'path only. An id, or the name of a record.' })),
})

/* --------------------------------- helpers -------------------------------- */

const facetOk = (node: StoredNode, facet: ItemFacet | undefined): boolean => {
  if (!facet || facet === 'any') return true
  // Applies to timeline items alone; anything else fails a facet it cannot have,
  // which is the honest answer to "interviews that are files".
  if (node.type !== 'timelineItem') return false
  const props = node.props
  return facet === 'reminder' ? props.remind : props.kind === facet
}

const typeOk = (node: StoredNode, want: NodeType | 'any' | undefined) =>
  !want || want === 'any' || node.type === want

/**
 * A record by id, or by name if that fails.
 *
 * The fallback is what makes a path question answerable from a sentence: a user
 * asks how "Stripe" is joined to "my CV", and neither of those is an id. Exact
 * label match first so an unambiguous name always wins, then a substring, which
 * is where "Stripe" finds "ML engineer — Stripe".
 */
function resolve(memory: GraphSnapshot, needle: string): StoredNode | undefined {
  const direct = memory.node(needle as NodeId)
  if (direct) return direct
  const folded = needle.trim().toLowerCase()
  if (folded.length === 0) return undefined
  const all = memory.nodes()
  return (
    all.find((n) => labelOf(n, memory).toLowerCase() === folded) ??
    all.find((n) => labelOf(n, memory).toLowerCase().includes(folded))
  )
}

/** Undirected, because nobody asking what connects two records holds a direction. */
function shortestPath(memory: GraphSnapshot, from: NodeId, to: NodeId) {
  if (from === to) return [{ id: from }]
  const seen = new Set<string>([from])
  const queue: { id: NodeId; trail: { id: NodeId; via?: Rel }[] }[] = [
    { id: from, trail: [{ id: from }] },
  ]
  while (queue.length > 0) {
    const here = queue.shift()
    if (!here) break
    for (const edge of memory.incident(here.id)) {
      const next = edge.from === here.id ? edge.to : edge.from
      if (seen.has(next)) continue
      seen.add(next)
      const trail = [...here.trail, { id: next, via: edge.rel }]
      if (next === to) return trail
      queue.push({ id: next, trail })
    }
  }
  return null
}

/* --------------------------------- the run -------------------------------- */

export function runGraphQuery(memory: GraphSnapshot, query: GraphQuery): GraphQueryResult {
  return query.kind === 'path' ? runPath(memory, query) : runPattern(memory, query)
}

function runPattern(memory: GraphSnapshot, q: PatternQuery): GraphQueryResult {
  const quantifier = q.quantifier ?? 'has'

  /*
   * A keyword nobody has is a different answer from a keyword nobody used.
   *
   * The same distinction `runPath` draws for a name that matched no record, and
   * for the same reason: "0 applications tagged Teaching" reads as a fact about
   * the applications when it is a fact about the word. Found by asking the real
   * model for "applications tagged Teaching" against a store whose keywords are
   * Developer, Research, Read, Referral, Negotiating and Waiting on them.
   */
  if (q.keyword && !hasKeywordNamed(memory, q.keyword)) {
    return {
      summary: `There is no keyword called "${q.keyword.trim()}".`,
      rows: [],
      highlight: [],
    }
  }

  const starts = memory
    .nodes()
    .filter((n) => typeOk(n, q.start) && facetOk(n, q.startFacet))
    .filter((n) => keywordOk(memory, n, q.keyword))

  const rows: QueryRow[] = []
  for (const node of starts) {
    const matched = memory
      .incident(node.id, q.rel && q.rel !== 'any' ? q.rel : undefined)
      .map((e) => memory.node(e.from === node.id ? e.to : e.from))
      .filter((n): n is StoredNode => n !== undefined)
      .filter((n) => typeOk(n, q.end) && facetOk(n, q.endFacet))

    const count = matched.length
    const keep =
      quantifier === 'missing'
        ? count === 0
        : quantifier === 'atLeast'
          ? count >= (q.atLeast ?? 2)
          : count > 0
    if (!keep) continue
    rows.push({
      record: render(node, memory),
      // A `missing` row has nothing to show, and that IS the finding.
      matched: quantifier === 'missing' ? [] : matched.map((n) => render(n, memory)),
      count,
    })
  }

  const highlight = rows.flatMap((r) => [
    r.record.id,
    ...r.matched.map((m) => m.id),
  ]) as NodeId[]
  return { summary: describePattern(q, quantifier, rows.length), rows, highlight }
}

const hasKeywordNamed = (memory: GraphSnapshot, name: string) => {
  const folded = name.trim().toLowerCase()
  return memory.ofType('keyword').some((k) => k.props.name.toLowerCase() === folded)
}

const keywordOk = (memory: GraphSnapshot, node: StoredNode, keyword: string | undefined) => {
  if (!keyword) return true
  const folded = keyword.trim().toLowerCase()
  return memory
    .incident(node.id, 'TAGS')
    .some((e) => {
      const other = memory.node(e.from === node.id ? e.to : e.from)
      return other?.type === 'keyword' && other.props.name.toLowerCase() === folded
    })
}

function runPath(memory: GraphSnapshot, q: PathQuery): GraphQueryResult {
  // `from` and `to` are REQUIRED on `PathQuery` and OPTIONAL on the schema the
  // model is handed, so the type says they are here and the runtime does not
  // agree. `{"kind":"path"}` and `{"kind":"path","from":"Rice"}` both parse,
  // and `resolve` then called `.trim()` on undefined — a TypeError thrown out
  // of a READ tool, which `execute` promises never throws, straight through the
  // agent run and into a thread that could not be recovered.
  //
  // Answered rather than thrown: a path question missing an endpoint is the
  // same KIND of failure as one naming a record that does not exist, so it gets
  // the same sentence. The model reads it and can ask again.
  const asked = { from: q.from ?? '', to: q.to ?? '' }
  if (asked.from.trim() === '' || asked.to.trim() === '') {
    return {
      summary: 'A path needs two records — name the one to start from and the one to reach.',
      rows: [],
      highlight: [],
    }
  }

  const from = resolve(memory, asked.from)
  const to = resolve(memory, asked.to)
  if (!from || !to) {
    const missing = !from ? asked.from : asked.to
    return {
      // Named, not "no results". A path question that failed because a name
      // matched nothing is a different answer from one that failed because the
      // two records are genuinely unconnected, and the user needs to know which.
      summary: `No record matches "${missing}".`,
      rows: [],
      highlight: [],
    }
  }
  const trail = shortestPath(memory, from.id, to.id)
  if (!trail) {
    return {
      summary: `${labelOf(from, memory)} and ${labelOf(to, memory)} are not connected.`,
      rows: [],
      highlight: [from.id, to.id],
    }
  }
  const rows: QueryRow[] = trail.map((step) => {
    const node = memory.node(step.id)
    const rendered = node ? render(node, memory) : ({ id: step.id } as AgentRecord)
    return step.via
      ? { record: rendered, matched: [], count: 0, via: step.via }
      : { record: rendered, matched: [], count: 0 }
  })
  const hops = trail.length - 1
  return {
    summary: `${labelOf(from, memory)} and ${labelOf(to, memory)} are ${String(hops)} ${hops === 1 ? 'step' : 'steps'} apart.`,
    rows,
    highlight: trail.map((t) => t.id),
  }
}

/**
 * The answer in words, so the model can say it without re-deriving it.
 *
 * BOTH facets, and the end one is the correction. This described only
 * `startFacet`, so "applications with no FOLLOW-UP" came back reading
 * "9 applications with no timeline items" — a true count under a false
 * description, which is the worst combination available: the number checks out,
 * so nothing prompts anybody to doubt the sentence. Caught by counting the
 * store by hand: nine applications have no follow-up and only three have no
 * timeline item at all, so the sentence and the rows were answering different
 * questions.
 */
function describePattern(q: PatternQuery, quantifier: Quantifier, n: number): string {
  const start = q.start && q.start !== 'any' ? plural(q.start, n) : n === 1 ? 'record' : 'records'
  const endWord = q.end && q.end !== 'any' ? plural(q.end, 2) : 'anything'
  const end = `${describeFacet(q.endFacet)}${endWord}`
  const rel = q.rel && q.rel !== 'any' ? ` by ${q.rel}` : ''
  const facet = q.startFacet && q.startFacet !== 'any' ? ` (${q.startFacet})` : ''
  const kw = q.keyword ? ` tagged ${q.keyword}` : ''
  const count = n === 0 ? 'No' : String(n)
  if (quantifier === 'missing') return `${count} ${start}${facet}${kw} with no ${end}${rel}.`
  if (quantifier === 'atLeast') {
    return `${count} ${start}${facet}${kw} joined to at least ${String(q.atLeast ?? 2)} ${end}${rel}.`
  }
  return `${count} ${start}${facet}${kw} joined to ${end}${rel}.`
}

/** 'follow-up ' — an adjective on the thing counted, so it reads as English. */
const describeFacet = (facet: ItemFacet | undefined) =>
  !facet || facet === 'any' ? '' : facet === 'reminder' ? 'reminding ' : `${facet} `

const plural = (type: NodeType, n: number) => {
  const word = type === 'timelineItem' ? 'timeline item' : type
  return n === 1 ? word : `${word}s`
}
