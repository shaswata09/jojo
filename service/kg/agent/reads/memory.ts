/**
 * The plain memory reads: the survey, one record, a text search and the links
 * from one record. `memory.list` has its own module, `memory-list.ts`.
 */

import { NODE_TYPES, RELS } from '../../core/model'
import type { NodeId, NodeType, Rel } from '../../core/model'
import { s } from '../../core/schema'
import { render } from '../records'
import { defineRead } from './define'
import { ANY, haystack, limit, matched, nodeTypeOrAny, relatedTo } from './shared'

export const memoryOverview = defineRead({
  name: 'memory.overview',
  title: 'Survey memory',
  summary:
    'Count the records of every kind. The cheapest first call: it names which kinds exist and how much is in each, so nothing after it is a guess.',
  effect: 'read',
  input: s.object({}),
  read: (memory) => {
    const counts: Record<string, number> = {}
    for (const type of NODE_TYPES) {
      const n = memory.ofType(type).length
      // Only what is there. A model shown eleven types of which eight are zero
      // spends its attention on the eight.
      if (n > 0) counts[type] = n
    }
    return { counts, total: memory.nodes().length }
  },
})

export const memoryGet = defineRead({
  name: 'memory.get',
  title: 'Read one record',
  summary:
    'One record in full, with everything joined to it — its organisation, its keywords, its files, whatever there is.',
  effect: 'read',
  input: s.object({
    // `undefined` for the node type on purpose: this reads ANY record, and
    // scoping it to one would make the tool useless for the other ten.
    id: s.id(undefined, { label: 'Record', description: 'The id of the record to read.' }),
  }),
  read: (memory, input: { id: NodeId }, ctx) => {
    const node = memory.node(input.id)
    // Not a throw. A missing id is the commonest thing a model gets wrong, and
    // it recovers from a sentence telling it so far better than from an
    // exception that ends the turn.
    if (!node) return { found: false, id: input.id, hint: 'No record has that id.' }
    return { found: true, record: render(node, memory, ctx.today), related: relatedTo(node.id, memory) }
  },
})

export const memorySearch = defineRead({
  name: 'memory.search',
  title: 'Search memory',
  summary:
    'Find records whose text contains a phrase, across every kind at once. Use it when you know a name but not an id.',
  effect: 'read',
  input: s.object({
    query: s.string({
      label: 'Text',
      // Says where to go instead of an empty query, because an empty query is
      // what models send when they want "everything". Measured: GPT-OSS 120B
      // called this with a blank `query` five times in one benchmark run, each
      // one refused with "Cannot be blank" and each one a wasted round trip.
      description:
        'Matched anywhere in the record, ignoring case. Must not be blank — to see everything of a kind, use memory.list instead.',
      min: 1,
    }),
    type: s.optional(
      nodeTypeOrAny('Kind', 'Narrow to one kind of record. `any`, or omit it, searches every kind.'),
    ),
    limit,
  }),
  read: (memory, input: { query: string; type?: NodeType | 'any'; limit?: number }, ctx) => {
    const needle = input.query.trim().toLowerCase()
    // `'any'` is the same request as omitting it — see `nodeTypeOrAny`.
    const pool =
      input.type !== undefined && input.type !== ANY ? memory.ofType(input.type) : memory.nodes()
    return matched(
      pool.filter((n) => haystack(n, memory).includes(needle)).map((n) => render(n, memory, ctx.today)),
      input.limit,
    )
  },
})

export const memoryRelated = defineRead({
  name: 'memory.related',
  title: 'Follow a link',
  summary:
    'The records joined to this one. Narrow by relation to answer "what is filed under this application" without reading everything.',
  effect: 'read',
  input: s.object({
    id: s.id(undefined, { label: 'Record', description: 'The record to start from.' }),
    rel: s.optional(
      s.enum(RELS, { label: 'Relation', description: 'Only follow this kind of link.' }),
    ),
  }),
  read: (memory, input: { id: NodeId; rel?: Rel }) =>
    memory.node(input.id)
      ? relatedTo(input.id, memory, input.rel)
      : { found: false, id: input.id, hint: 'No record has that id.' },
})
