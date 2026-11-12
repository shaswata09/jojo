/**
 * `graph-query.ts` and `queries.ts` used to import each other, and the order
 * decided whether either loaded: `queries` reads `GRAPH_QUERY_SCHEMA` at module
 * top level, so entering through `graph-query` threw a ReferenceError before
 * either file finished. This file must import `graph-query` FIRST — the test is
 * the import order, and nothing above it may reach `queries`.
 */
import { GRAPH_QUERY_SCHEMA } from './graph-query'
import { describe, expect, it } from 'vitest'

describe('graph-query ↔ queries', () => {
  it('loads when graph-query is imported before queries', async () => {
    expect(GRAPH_QUERY_SCHEMA).toBeDefined()
    const { READS } = await import('./queries')
    expect(READS['graph.query'].input).toBe(GRAPH_QUERY_SCHEMA)
  })
})
