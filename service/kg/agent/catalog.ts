/**
 * L3 — every operation this app can perform, described for a model.
 *
 * One catalog, two envelopes. The tools are the same objects the UI has always
 * run; what changes is the wrapper — OpenAI's `{type:'function', function:{…}}`
 * for the chat endpoint, MCP's `{name, description, inputSchema}` for
 * `tools/list`. Writing them as one list and two thin adapters is the whole
 * point: a tool added to `TOOLS` is callable by a model, and listed over MCP, on
 * the same day, without anybody remembering to update a manifest.
 *
 * WHAT IS IN IT. Every write tool plus every read. Internal tools
 * are included, and that is a change of position worth stating: `Tool.internal`
 * means "hidden from the palette and the inspector", which is a claim about
 * screen space, not about safety — `org.ensure` is exactly the kind of thing a
 * model composing a create ought to be able to reach. Nothing is hidden from the
 * catalog. What IS marked is destructiveness, so the caller can decide.
 *
 * THE NAME PROBLEM. Tool names here are `domain.noun.verb` and have been since
 * the registry was written. OpenAI-compatible servers constrain function names
 * to `^[a-zA-Z0-9_-]{1,64}$` — a dot is rejected outright, and vLLM's grammar
 * backend will refuse the whole request rather than the one tool. So names are
 * transliterated on the way out and mapped back on the way in, in one place,
 * with the round trip asserted for every tool in the registry. MCP has no such
 * restriction, but it gets the same spelling anyway: two names for one operation
 * is how a trace stops matching a manifest.
 */

import { TOOLS } from '../tools/index'
import type { AnyTool } from '../tools/tool'
import { toJsonSchema } from './json-schema'
import type { JsonSchema } from './json-schema'
import { READS } from './queries'
import type { ReadTool } from './queries'

/** What a caller needs to decide whether to run something without asking. */
export type Effect = AnyTool['effect'] | 'read'

export type CatalogEntry = {
  /** The registry name: `application.create`. The id everything else keys off. */
  readonly name: string
  /** The wire name: `application_create`. See THE NAME PROBLEM above. */
  readonly wireName: string
  readonly title: string
  readonly summary: string
  readonly effect: Effect
  /**
   * True for `delete` and `admin`.
   *
   * `admin` is `memory.reset` and `memory.clear`, which replace or empty the
   * whole store. Those are excluded from the journal by `Tool.undoable: false`
   * — they go through a confirmation dialog instead — which means they are the
   * two operations in this app a model could perform that a user could NOT then
   * undo. That is the line this flag draws, and it is why it is computed from
   * the same facts rather than hand-listed.
   */
  readonly destructive: boolean
  /** False for the admin pair; every other write can be taken back. */
  readonly undoable: boolean
  readonly parameters: JsonSchema
}

/**
 * `.` to `_`, which is safe because no tool name contains an underscore.
 *
 * Asserted below over the whole registry rather than assumed — a tool named
 * `foo_bar.baz` would collide with `foo.bar.baz` and the two would be
 * indistinguishable on the wire, which is a silent misroute rather than an
 * error.
 */
export const toWireName = (name: string) => name.replaceAll('.', '_')

/**
 * `ReadTool<any>`, because `ReadTool<I>` is invariant in its `read` parameter.
 *
 * `ReadTool` alone means `ReadTool<unknown>`, and a reader declared over `{}` is
 * not assignable to one declared over `unknown` — the input position makes the
 * generic contravariant, so the whole `READS` union is rejected at the door.
 * The `any` is confined to this one signature; every caller past it goes through
 * the tool's own schema, which is what actually decides the type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildEntry(tool: AnyTool | ReadTool<any>, effect: Effect): CatalogEntry {
  const destructive = effect === 'delete' || effect === 'admin'
  return {
    name: tool.name,
    wireName: toWireName(tool.name),
    title: tool.title,
    summary: tool.summary,
    effect,
    destructive,
    undoable: effect !== 'read' && (tool as AnyTool).undoable !== false,
    parameters: toJsonSchema(tool.input.meta),
  }
}

/**
 * Reads first, deliberately.
 *
 * A model reads the tool list top to bottom and its attention is not uniform
 * across it. Nearly every correct plan in this app starts with a read — you
 * cannot advance a stage without an id — so the five that come first are the
 * five that should.
 */
export const CATALOG: readonly CatalogEntry[] = [
  ...Object.values(READS).map((r) => buildEntry(r, 'read')),
  ...Object.values(TOOLS).map((t) => buildEntry(t as AnyTool, (t as AnyTool).effect)),
]

const BY_WIRE = new Map(CATALOG.map((e) => [e.wireName, e]))
const BY_NAME = new Map(CATALOG.map((e) => [e.name, e]))

/** Module-load assertion, matching the one `tools/index.ts` makes on its keys. */
if (BY_WIRE.size !== CATALOG.length) {
  throw new Error('agent catalog: two tools transliterate to the same wire name')
}

export const entryForWire = (wireName: string) => BY_WIRE.get(wireName)
export const entryFor = (name: string) => BY_NAME.get(name)

/* ------------------------------- envelopes -------------------------------- */

/** OpenAI's `tools` array, which vLLM, Ollama and LM Studio all accept. */
export type FunctionSpec = {
  type: 'function'
  function: { name: string; description: string; parameters: JsonSchema }
}

/**
 * The description a model actually reads.
 *
 * Title and summary joined, because they were written for different readers and
 * both are useful: the title is the imperative a menu shows ("Add application")
 * and the summary is the sentence under it. A destructive tool says so in the
 * text as well as in the flag — the flag is for our code, and a model that never
 * sees the flag still needs to know that delete means delete.
 */
export function describeEntry(entry: CatalogEntry): string {
  /*
   * A separator, because there was none and every one of the descriptions a
   * model reads was a run-on: "Ask the graph Find records by how they are
   * connected", "Edit application Saves the form". Not one title in the catalog
   * ends in punctuation, so this was universal — and it is the cheapest
   * accuracy the small-model path has available, at one character per tool.
   *
   * Guarded anyway, so a title that ever does end in punctuation is not given
   * a second full stop.
   */
  const title = /[.!?:—-]$/u.test(entry.title.trim()) ? entry.title.trim() : `${entry.title.trim()}.`
  const parts = [title, entry.summary]
  if (entry.destructive) {
    parts.push(
      entry.undoable
        ? 'Destructive: this removes a record. Confirm with the user before calling it.'
        : 'Destructive and NOT undoable: this replaces or empties the whole store. Never call it unless the user has asked for exactly this in the current turn.',
    )
  }
  return parts.join(' ')
}

export const toFunctionSpec = (entry: CatalogEntry): FunctionSpec => ({
  type: 'function',
  function: {
    name: entry.wireName,
    description: describeEntry(entry),
    parameters: entry.parameters,
  },
})

/** MCP's `tools/list` entry. Same names, same schema, different envelope. */
export type McpToolSpec = {
  name: string
  title: string
  description: string
  inputSchema: JsonSchema
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean }
}

export const toMcpSpec = (entry: CatalogEntry): McpToolSpec => ({
  name: entry.wireName,
  title: entry.title,
  description: describeEntry(entry),
  inputSchema: entry.parameters,
  // MCP's own hint vocabulary, filled from the same two facts rather than
  // guessed per tool. `idempotentHint` is true for a read and for a `set`-shaped
  // update, and claiming it for a create would be a lie a client may act on.
  annotations: {
    readOnlyHint: entry.effect === 'read',
    destructiveHint: entry.destructive,
    idempotentHint: entry.effect === 'read' || entry.effect === 'update',
  },
})

export const functionSpecs = (): FunctionSpec[] => CATALOG.map(toFunctionSpec)
export const mcpSpecs = (): McpToolSpec[] => CATALOG.map(toMcpSpec)
