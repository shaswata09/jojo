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
 * WHY FIVE GENERIC TOOLS AND NOT ELEVEN TYPED ONES. There are eleven node types
 * and fifty-nine write tools already. A model choosing from seventy names picks
 * worse than one choosing from sixty-four, and this app points at whatever the
 * user is running at home — frequently a 7B, where the tool list is a real part
 * of the context budget. Generic also means a twelfth node type is readable the
 * day it is added rather than the day someone remembers to write its reader.
 *
 * The cost is that `type` becomes an argument the model can get wrong, which is
 * why it is an enum over `NODE_TYPES` rather than a string, and why
 * `memory.overview` exists: it is the cheapest possible first call, it names
 * every type that has records in it, and a model that starts there is never
 * guessing at the vocabulary.
 */

import { NODE_TYPES, RELS } from '../core/model'
import type { NodeId, NodeType, Rel, StoredNode } from '../core/model'
import type { GraphSnapshot } from '../core/snapshot'
import { s } from '../core/schema'
import { parseSources, readListings } from '../core/board'
import { CONSTANT_NAMES, FUNCTION_NAMES, evaluate } from '../core/expression'
import { format } from '../core/calculator'
import type { Infer, Schema } from '../core/schema'
import { GRAPH_QUERY_SCHEMA, runGraphQuery } from './graph-query'
import type { GraphQuery } from './graph-query'

/**
 * A read, in the same shape the catalog can hand to a model.
 *
 * `effect: 'read'` is not one of `Tool`'s five effects and is not meant to be:
 * the write tools' effect drives undo and the journal, and a read has neither.
 * It is here so the catalog can mark these as safe without a second lookup, and
 * so a UI can show them differently from a mutation.
 */
export type ReadTool<I = unknown> = {
  readonly name: string
  readonly title: string
  readonly summary: string
  readonly effect: 'read'
  readonly input: Schema<I>
  /**
   * May be async, unlike a write.
   *
   * The asymmetry is the point rather than an inconsistency. `tool.ts` forbids
   * `await` inside a write and explains why: an await on anything that is not
   * the transaction's own request ends the turn, the transaction auto-commits,
   * and the next call throws after some of the writes have landed. A read opens
   * no transaction, so none of that applies — and one read genuinely has to go
   * out to the network, because reading a PDF means asking MarkItDown.
   */
  readonly read: (
    memory: GraphSnapshot,
    input: I,
    ctx: ReadContext,
  ) => unknown | Promise<unknown>
}

/**
 * What a read may reach besides the graph.
 *
 * One optional function today, and it is optional because the thing behind it is
 * something the user chooses to run. A read that needs it and does not have it
 * says so; it does not fail.
 */
export type ReadContext = {
  /**
   * A job board's search page, as rows. Absent when nothing can reach one.
   *
   * Injected for the same reason `convert` is, plus one more: reading a board
   * means running the page's own JavaScript, and a portable layer has no DOM to
   * run it in. See `ToolHost.scan`.
   */
  readonly scan?: (
    url: string,
  ) => Promise<{ ok: true; rows: unknown } | { ok: false; reason: string }>
  /**
   * A stored document, as Markdown. Absent when no reader is configured.
   *
   * Supplied by the app, because getting the bytes and sending them are both
   * platform work: `check-platform` bans the network from this layer, and the
   * bytes live in IndexedDB on the web and on the filesystem on a phone.
   */
  convert?: (fileId: NodeId) => Promise<{ ok: true; markdown: string } | { ok: false; reason: string }>
}

const defineRead = <I>(t: ReadTool<I>): ReadTool<I> => t

/* ------------------------------- rendering -------------------------------- */

/**
 * The one human-readable field, per type, in the order worth trying.
 *
 * Not a switch over eleven types: every one of them names itself with `name`,
 * `title` or `role`, and a list rather than a switch is what makes a new type
 * legible for free. `slug` is the last resort and is never nothing.
 */
const LABEL_KEYS = ['name', 'title', 'role', 'slug'] as const

export function labelOf(node: StoredNode, memory: GraphSnapshot): string {
  const props = node.props as Record<string, unknown>
  const own = LABEL_KEYS.map((k) => props[k]).find((v) => typeof v === 'string' && v.length > 0)
  const label = typeof own === 'string' ? own : node.id
  // An application's role means little without the organisation — "Assistant
  // professor" is four of the twelve seeded records. The org is one hop away and
  // is what a person would have said.
  if (node.type !== 'application') return label
  const org = memory.one(node.id, 'AT', 'organisation')
  return org ? `${label} — ${org.props.name}` : label
}

/**
 * A record, flattened for a model to read.
 *
 * `props` is spread rather than nested. A model asked to read
 * `result.props.stage` and then to pass `stage` to a write tool has to perform
 * one act of translation, and translation is where small models drop fields.
 * The three keys that are not props are prefixed so nothing can collide with a
 * prop of the same name.
 */
export type AgentRecord = { id: NodeId; type: NodeType; label: string } & Record<string, unknown>

export const render = (node: StoredNode, memory: GraphSnapshot): AgentRecord => ({
  id: node.id,
  type: node.type,
  label: labelOf(node, memory),
  ...(node.props as Record<string, unknown>),
})

/** Everything joined to a record, in both directions, because a person would. */
function relatedTo(id: NodeId, memory: GraphSnapshot, rel?: Rel) {
  return memory
    .incident(id, rel)
    .map((edge) => {
      const otherId = edge.from === id ? edge.to : edge.from
      const other = memory.node(otherId)
      if (!other) return null
      return {
        rel: edge.rel,
        // Which way the edge points, in words. "An application is AT an
        // organisation" reads one way and not the other, and a model told only
        // `AT` will invent the direction it needs.
        direction: edge.from === id ? ('out' as const) : ('in' as const),
        id: other.id,
        type: other.type,
        label: labelOf(other, memory),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
}

/**
 * Every string in a record, folded, for a substring match — plus its label.
 *
 * The label is the half that was missing, and a real model found it. Asked to
 * flag "my UT Austin application", gemma's first and most natural call was
 * `memory.search {query: 'UT Austin', type: 'application'}`, which returned
 * NOTHING: an application's props hold the role and the stage, and the
 * employer's name is a prop of the organisation one hop away. It recovered —
 * searched again without the type, found the organisation, tried `related`,
 * then listed every application and matched by eye — but that is four round
 * trips to answer a question the first one asked correctly.
 *
 * `labelOf` already crosses that hop for display, so searching what is
 * displayed costs one edge lookup and makes the obvious query work. The
 * alternative — telling the model in prose that employers are separate records
 * — is asking it to know our schema, which is exactly what a search tool is for
 * not needing.
 */
const haystack = (node: StoredNode, memory: GraphSnapshot): string =>
  [...Object.values(node.props as Record<string, unknown>), labelOf(node, memory)]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase()

/* --------------------------------- tools ---------------------------------- */

const nodeType = (label: string, description: string) =>
  s.enum(NODE_TYPES, { label, description })

/** A ceiling on every list, so one call cannot spend the whole context window. */
const LIMIT_MAX = 200
const limit = s.optional(
  s.number({
    label: 'Limit',
    description: `How many records at most. Defaults to 50, never more than ${String(LIMIT_MAX)}.`,
    min: 1,
    max: LIMIT_MAX,
  }),
)

const capped = (n: number | undefined) => Math.min(n ?? 50, LIMIT_MAX)

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

export const memoryList = defineRead({
  name: 'memory.list',
  title: 'List records',
  summary:
    'Every record of one kind, newest first. Use it to find the id of something before acting on it.',
  effect: 'read',
  input: s.object({
    type: nodeType('Kind', 'Which kind of record to list.'),
    limit,
  }),
  read: (memory, input: { type: NodeType; limit?: number }) =>
    [...memory.ofType(input.type)]
      // Newest first: a person asking "what did I add" means the recent end, and
      // a truncated list should keep the half they meant.
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, capped(input.limit))
      .map((n) => render(n, memory)),
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
  read: (memory, input: { id: NodeId }) => {
    const node = memory.node(input.id)
    // Not a throw. A missing id is the commonest thing a model gets wrong, and
    // it recovers from a sentence telling it so far better than from an
    // exception that ends the turn.
    if (!node) return { found: false, id: input.id, hint: 'No record has that id.' }
    return { found: true, record: render(node, memory), related: relatedTo(node.id, memory) }
  },
})

export const memorySearch = defineRead({
  name: 'memory.search',
  title: 'Search memory',
  summary:
    'Find records whose text contains a phrase, across every kind at once. Use it when you know a name but not an id.',
  effect: 'read',
  input: s.object({
    query: s.string({ label: 'Text', description: 'Matched anywhere in the record, ignoring case.', min: 1 }),
    type: s.optional(nodeType('Kind', 'Narrow to one kind of record.')),
    limit,
  }),
  read: (memory, input: { query: string; type?: NodeType; limit?: number }) => {
    const needle = input.query.trim().toLowerCase()
    const pool = input.type ? memory.ofType(input.type) : memory.nodes()
    return pool
      .filter((n) => haystack(n, memory).includes(needle))
      .slice(0, capped(input.limit))
      .map((n) => render(n, memory))
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
    'Find records by how they are connected: those that HAVE a relationship, those MISSING one, those with several, or the path between two named records. Use it for questions about gaps — applications with no follow-up, files filed under nothing.',
  effect: 'read',
  input: GRAPH_QUERY_SCHEMA,
  read: (memory, input: Infer<typeof GRAPH_QUERY_SCHEMA>) =>
    runGraphQuery(memory, input as unknown as GraphQuery),
})

/**
 * Reads a document in the Vault, through MarkItDown.
 *
 * The tool the whole integration exists for. Everything else the agent can do
 * with a file — rename it, file it under a job, delete it — treats the document
 * as an opaque thing with a name; this is the one that opens it. A model that
 * can read the posting can answer questions about the posting.
 *
 * It refuses rather than fails when nothing is configured, and says what to
 * install. The alternative is a model that keeps trying and a user who never
 * learns why it cannot.
 */
export const vaultFileRead = defineRead({
  name: 'vault.file.read',
  title: 'Read a document',
  summary:
    'Read what is inside a stored document — a PDF, a Word file, a deck, a spreadsheet — as text. Use it before answering questions about a posting, a CV or anything else filed in the Vault.',
  effect: 'read',
  input: s.object({
    id: s.id('file', { label: 'Document', description: 'The id of the file to read.' }),
  }),
  read: async (memory, input: { id: NodeId }, ctx) => {
    const node = memory.node(input.id, 'file')
    if (!node) return { ok: false, hint: 'No document has that id.' }
    if (!ctx.convert) {
      return {
        ok: false,
        hint: 'No document reader is connected, so the inside of this file cannot be read. Settings is where its address goes.',
        name: node.props.name,
      }
    }
    const out = await ctx.convert(input.id)
    return out.ok
      ? { ok: true, name: node.props.name, markdown: out.markdown }
      : { ok: false, name: node.props.name, hint: out.reason }
  },
})

/**
 * Reads a job board's search page and returns the postings on it.
 *
 * Refuses rather than fails when nothing can reach a board, exactly as
 * `vault.file.read` does when no document reader is configured — the model
 * needs to learn that browsing is unavailable here, not that it went wrong.
 *
 * The URL is the user's, not the model's invention: it comes from the
 * pipeline's own `source`, which the prompt lists, and a model that makes one
 * up gets whatever that address serves. That is the same trust the capture
 * extension already extends to a link the user pasted, and it is bounded by the
 * same thing — nothing fetched here is written anywhere without the person
 * approving the card it becomes.
 */
export const boardSearch = defineRead({
  name: 'board.search',
  title: 'Read a job board',
  summary:
    'Open one of the job boards this pipeline watches and list the postings on it. Use the addresses you were given; do not invent one.',
  effect: 'read',
  input: s.object({
    url: s.string({
      min: 1,
      label: 'Board',
      description: 'The address of the board or search page to read.',
    }),
  }),
  read: async (_memory, input: { url: string }, ctx) => {
    if (!ctx.scan) {
      return {
        ok: false,
        hint: 'Nothing here can open a web page, so the boards cannot be read. On a computer this is what the jojo browser extension is for; on a phone only boards that work without JavaScript can be read.',
      }
    }

    const sources = parseSources(input.url)
    const target = sources[0]
    if (target === undefined) {
      return { ok: false, hint: 'That is not an address I can open. Give me the board’s URL.' }
    }

    const out = await ctx.scan(target)
    if (!out.ok) return { ok: false, url: target, hint: out.reason }

    const listings = readListings(out.rows, target)
    return {
      ok: true,
      url: target,
      count: listings.length,
      // Said out loud rather than left to be inferred from an empty list: a
      // board that renders its results in a way this cannot read looks
      // identical to a board with no jobs on it, and the two want different
      // next moves from the model.
      ...(listings.length === 0
        ? { hint: 'That page listed no postings this could read. It may need a sign-in, or it may render its results in a way nothing here can follow.' }
        : {}),
      postings: listings,
    }
  },
})

/** Keyed by name so the catalog and MCP both look them up the same way. */
/**
 * Arithmetic, so the model stops doing it in its head.
 *
 * THE PROBLEM THIS SOLVES is not that the model cannot add. It is that when it
 * adds wrongly there is no signal — a bad total arrives in the same even
 * sentence as a good one, phrased with the same confidence, and the person
 * reading it has no way to tell which they got. Every other read here can be
 * checked against the graph; a number the model produced from nothing cannot.
 *
 * WHY ONE TOOL AND NOT SEVERAL. `sum`, `mean` and `median` as three names would
 * be three more entries in a list this file's header argues hard for keeping
 * short — "a model choosing from seventy names picks worse than one choosing
 * from sixty-four", on hardware that is frequently a 7B at home. One name and
 * one grammar covers arithmetic and descriptive statistics together, and the
 * grammar composes in a way a fixed set of tools cannot: `mean(58000/9*12,
 * 72000)` is one call.
 *
 * WHY A LIST OF EXPRESSIONS. An answer about a job search wants several figures
 * at once — the total, the average, the gap — and one call returning three
 * beats three round trips through a local model. One bad expression reports its
 * own error and the others still answer, because a typo in the third should not
 * cost the two that were fine.
 *
 * It takes no `memory` argument and touches no records on purpose. Pairing it
 * with `memory.list` is the intended shape: read the records, then compute over
 * what came back. Letting it reach into the graph itself would make it a second
 * query language beside `graph.query`.
 */
export const calcEval = defineRead({
  name: 'calc.eval',
  title: 'Work out a number',
  summary:
    `Work out arithmetic exactly instead of doing it in your head — always use this for any sum, ` +
    `average, percentage or comparison whose answer you are going to state. ` +
    `Operators + - * / % ^ and brackets. Functions: ${FUNCTION_NAMES.join(', ')}. ` +
    `Constants: ${CONSTANT_NAMES.join(', ')}. The aggregates take any number of arguments, ` +
    `so mean(58000, 72000, 65000) works. Write plain numbers with no currency symbols and no ` +
    `thousand separators: 50000, never 50,000 and never 50 000 — a comma is how you separate one ` +
    `argument from the next, so a separator inside a number silently becomes two numbers. Every ` +
    `result echoes the numbers it actually read; if that list is longer than you meant, that is ` +
    `what happened. Percentages are decimals: 20% is 0.2, and % is the remainder operator. ` +
    `There is no trigonometry here.`,
  effect: 'read',
  input: s.object({
    expressions: s.array(
      s.string({ min: 1, label: 'Expression', description: 'One expression, for example mean(58000, 72000).' }),
      {
        min: 1,
        max: 20,
        label: 'Expressions',
        description: 'The expressions to work out. Send several at once when an answer needs several figures.',
      },
    ),
  }),
  read: (_memory, input: { expressions: string[] }) => {
    const results = input.expressions.map((expression) => {
      const outcome = evaluate(expression)
      return outcome.ok
        ? {
            expression,
            ok: true,
            // `value` and `display` both, because they are for different
            // readers: the raw double is what a following expression should be
            // given, and `format` is the rounded text a person should be shown.
            // Handing back only the rounded one would make the model quote
            // 0.30000000000000004 as 0.3 and then compute with 0.3.
            value: outcome.value,
            display: format(outcome.value),
            /*
             * Every literal that was read, in order. The audit trail for the one
             * hazard the evaluator cannot detect: `mean(72,500, 65,250)` is four
             * arguments and two arguments at the same time, and nothing in the
             * text tells them apart. Rather than guess, it reports — a caller
             * that meant two numbers sees four here, beside the answer.
             */
            read: outcome.numbers,
          }
        : { expression, ok: false, error: outcome.error }
    })

    const failed = results.filter((r) => !r.ok).length
    return {
      results,
      // Said out loud rather than left to be counted. A model that skims the
      // list and reports a figure from a row that failed is the failure mode
      // this whole tool exists to prevent.
      ...(failed > 0
        ? {
            hint: `${String(failed)} of ${String(results.length)} could not be worked out. Do not state a number for those — fix the expression and ask again.`,
          }
        : {}),
    }
  },
})

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as const satisfies Record<string, ReadTool<any>>

export type ReadName = keyof typeof READS
