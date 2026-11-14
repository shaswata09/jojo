/**
 * L2 — the read half of the agent's surface.
 *
 * `tools/index.ts` states the rule that keeps the write registry honest: "a card
 * action that writes nothing to memory is not a tool… keeping that line sharp is
 * what stops the registry becoming a list of every `onClick` in the app." That
 * rule is right and it is not relaxed here. These are not in TOOLS, they take no
 * `Tx`, they open no transaction and they write no journal row. They are a
 * separate surface that happens to be offered to the same caller.
 *
 * WHY A FEW GENERIC TOOLS AND NOT ONE PER NODE TYPE. There are seventeen node
 * types and eighty-five write tools already; the catalog is ninety-five entries.
 * A model choosing from a hundred and seven names picks worse than one choosing
 * from ninety-five, and this app points at whatever the user is running at home
 * — frequently a 7B, where the tool list is a real part of the context budget.
 * Generic also means an eighteenth node type is readable the day it is added
 * rather than the day someone remembers to write its reader.
 *
 * (Those numbers said eleven types and sixty-four tools until the counts were
 * checked. `catalog.test.ts` pins them now, so the next person to add a tool is
 * told to update this paragraph rather than leaving it to rot again — the
 * argument survives a wrong number, but a comment nobody trusts is one nobody
 * reads.)
 *
 * The cost is that `type` becomes an argument the model can get wrong, which is
 * why it is an enum over `NODE_TYPES` rather than a string, and why
 * `memory.overview` exists: it is the cheapest possible first call, it names
 * every type that has records in it, and a model that starts there is never
 * guessing at the vocabulary.
 */

import type { ReadTool } from './reads/define'
import { memoryGet, memoryOverview, memoryRelated, memorySearch } from './reads/memory'
import { memoryList } from './reads/memory-list'
import { graphQuery } from './reads/graph'
import { vaultFileRead } from './reads/vault-file'
import { boardSearch } from './reads/board'
import { calcEval } from './reads/calc'
import { statsReport } from './reads/stats'

/*
 * Each read lives in its own module under `reads/`; this file is the one list
 * of them and the stable place to import from. Every name it exported before
 * the split is re-exported here.
 */
export type { ReadContext, ReadTool } from './reads/define'
export { memoryGet, memoryOverview, memoryRelated, memorySearch } from './reads/memory'
export { memoryList } from './reads/memory-list'
export { graphQuery } from './reads/graph'
export { DOCUMENT_CLOSE, DOCUMENT_OPEN, unfenceable } from './reads/fence'
export { vaultFileRead } from './reads/vault-file'
export { boardSearch } from './reads/board'
export { calcEval } from './reads/calc'
export { statsReport } from './reads/stats'

/* ------------------------------- rendering -------------------------------- */

/*
 * `labelOf`, `render` and `AgentRecord` live in `records.ts`, a leaf both this
 * file and `graph-query.ts` import. They used to live here, and `graph-query`
 * imported them back while this file read `GRAPH_QUERY_SCHEMA` at top level —
 * a cycle that left `graph.query` without a schema whenever `graph-query` was
 * the module loaded first. Re-exported so existing imports keep working.
 */
export { labelOf, render } from './records'
export type { AgentRecord } from './records'

/** Keyed by name so the catalog and MCP both look them up the same way. */
export const READS = {
  'memory.overview': memoryOverview,
  'memory.list': memoryList,
  'memory.get': memoryGet,
  'memory.search': memorySearch,
  'memory.related': memoryRelated,
  'graph.query': graphQuery,
  'vault.file.read': vaultFileRead,
  'board.search': boardSearch,
  'calc.eval': calcEval,
  'stats.report': statsReport,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as const satisfies Record<string, ReadTool<any>>

export type ReadName = keyof typeof READS
