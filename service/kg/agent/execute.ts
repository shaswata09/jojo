/**
 * L3 — one place a named tool call is turned into a result.
 *
 * MCP's `tools/call` and the agent loop's tool step are the same operation
 * arriving through two doors, and the moment they are two functions they start
 * to differ: one validates and the other does not, one catches `ToolFailure` and
 * the other lets it escape, one accepts wire names and the other registry names.
 * So there is one, and both doors call it.
 *
 * WHAT IT REFUSES TO DO. It does not trust the model. Arguments arrive as
 * `unknown` and go through `runtime.check` — the same parser the forms use —
 * before anything is run, so a hallucinated field is a message back to the model
 * rather than a `TypeError` from inside a tool. `json-schema.ts` says the same
 * thing from the other end: the schema tells the model what to send, and nothing
 * downstream trusts it.
 *
 * It also never throws. A model that names a tool that does not exist, or sends
 * a string where a date belongs, has made an ordinary mistake and needs a
 * sentence it can act on. An exception would end the turn instead, and the model
 * would have no idea which of its arguments was wrong.
 */

import { formatIssues } from '../core/schema'
import type { GraphSnapshot } from '../core/snapshot'
import type { ToolName } from '../tools/index'
import type { Announcement, ToolError } from '../tools/tool'
import { entryFor, entryForWire } from './catalog'
import type { CatalogEntry } from './catalog'
import { READS } from './queries'
import type { ReadName } from './queries'

/**
 * The runtime, narrowed to what a call needs.
 *
 * Written as a structural type rather than importing `ToolRuntime` so this can
 * be handed a real runtime by the app and a two-line fake by a test, and so the
 * generic `ToolName` machinery does not leak into a signature that receives
 * `unknown` from a socket anyway.
 */
export type ToolHost = {
  memory: () => GraphSnapshot
  check: (name: ToolName, input: unknown) => { ok: true; value: unknown } | { ok: false; issues: readonly { path: string; message: string }[] }
  run: (
    name: ToolName,
    input: unknown,
  ) =>
    | { ok: true; output: unknown; announcement: Announcement; undo: (() => void) | null }
    | { ok: false; errors: readonly ToolError[] }
}

export type CallOutcome =
  | {
      ok: true
      entry: CatalogEntry
      result: unknown
      /** The sentence the app's own toast would have shown. Absent for a read. */
      announcement?: Announcement
      undo?: (() => void) | null
    }
  | { ok: false; entry?: CatalogEntry; error: string }

/** Accepts either spelling, because MCP clients and our own loop use wire names. */
const lookup = (name: string) => entryForWire(name) ?? entryFor(name)

export function callTool(host: ToolHost, name: string, args: unknown): CallOutcome {
  const entry = lookup(name)
  if (!entry) {
    return {
      ok: false,
      // Naming the shape rather than listing sixty-four tools: the list is
      // already in the model's context, and repeating it in an error is how a
      // recoverable mistake costs a thousand tokens.
      error: `No tool is called ${name}. Use one of the names given in the tool list, exactly as spelled.`,
    }
  }

  // `{}` for a tool that takes no arguments — models routinely omit the key
  // entirely for those, and `undefined` fails an object parse that `{}` passes.
  const input = args === undefined || args === null ? {} : args

  if (entry.effect === 'read') {
    const read = READS[entry.name as ReadName]
    const parsed = read.input.parse(input)
    if (!parsed.ok) return { ok: false, entry, error: formatIssues(parsed.issues) }
    return { ok: true, entry, result: read.read(host.memory(), parsed.value as never) }
  }

  const toolName = entry.name as ToolName
  // Checked before run, so a bad argument never opens a transaction. `run` would
  // parse it again anyway; doing it here is what turns the issues into a
  // sentence addressed to the caller rather than a generic refusal.
  const checked = host.check(toolName, input)
  if (!checked.ok) return { ok: false, entry, error: formatIssues(checked.issues) }

  const result = host.run(toolName, checked.value)
  if (!result.ok) {
    return { ok: false, entry, error: result.errors.map((e) => e.message).join('; ') }
  }
  return {
    ok: true,
    entry,
    result: result.output,
    announcement: result.announcement,
    undo: result.undo,
  }
}

/**
 * What a model is shown after a call, as text.
 *
 * JSON for a read, because the model has to reason over the fields. A sentence
 * for a write, because the output of a write is usually just an id and the
 * useful part is what the app would have told the user — `describe` already
 * wrote that sentence for the toast, and it is better prose than anything a
 * serialiser would produce.
 *
 * Truncated hard. A `memory.list` over a full store can be tens of kilobytes,
 * and a model that spends its window on one call has none left to act with. The
 * cut is announced so the model knows to narrow rather than assuming it saw
 * everything — a silent truncation reads as a complete answer.
 */
export function renderOutcome(outcome: CallOutcome, budget = 6000): string {
  if (!outcome.ok) return `Error: ${outcome.error}`
  if (outcome.entry.effect !== 'read') {
    const a = outcome.announcement
    const said = a ? [a.title, a.description].filter(Boolean).join(' — ') : 'Done.'
    // The id goes back too: the model has just created something and the next
    // step almost always needs to name it.
    return typeof outcome.result === 'string' ? `${said} (id: ${outcome.result})` : said
  }
  const json = JSON.stringify(outcome.result)
  if (json.length <= budget) return json
  return `${json.slice(0, budget)}\n\n[Truncated at ${String(budget)} characters. Narrow the search or lower the limit to see the rest.]`
}
