/**
 * `graph.query`: the read for questions about how records are connected.
 * The engine and its schema live in `../graph-query.ts`.
 */

import type { Infer } from '../../core/schema'
import { GRAPH_QUERY_SCHEMA, runGraphQuery } from '../graph-query'
import type { GraphQuery } from '../graph-query'
import { defineRead } from './define'

/**
 * "Ask the graph", the question the other four cannot express.
 *
 * `memory.list` and `memory.related` answer "what is there" and "what is joined
 * to this one". Neither can answer "which applications have NO follow-up
 * scheduled", because the answer is defined by an ABSENCE and there is nothing
 * to list. That question — and the two-record path question next to it — is what
 * the Graph page has always been for, and it is why this is a fifth read rather
 * than a flag on one of the others.
 *
 * Defined here rather than in `graph-query.ts` so that the whole read surface is
 * one list: the catalog, MCP and the loop each iterate `READS`, and a tool that
 * registered itself somewhere else would be a second place to look.
 */
export const graphQuery = defineRead({
  name: 'graph.query',
  title: 'Ask the graph',
  summary:
    'Find records by how they are connected: those that HAVE a relationship, those MISSING one, those with several, or the path between two named records. Use it for questions about gaps — applications with no follow-up, files filed under nothing. For dates, counts, order or totals — the furthest deadline, how many are upcoming — use memory.list.',
  effect: 'read',
  input: GRAPH_QUERY_SCHEMA,
  read: (memory, input: Infer<typeof GRAPH_QUERY_SCHEMA>, ctx) =>
    runGraphQuery(memory, input as unknown as GraphQuery, ctx.today),
})
