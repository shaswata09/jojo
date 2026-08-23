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
  /**
   * A stored document as Markdown, when the app has a reader configured.
   *
   * On the host rather than in the service because both halves are platform
   * work — the bytes are in IndexedDB or on a filesystem, and the conversion is
   * a network call `check-platform` forbids this layer to make.
   */
  convert?: (fileId: string) => Promise<{ ok: true; markdown: string } | { ok: false; reason: string }>
  /**
   * The rows of a job board's search page, when the app can reach one.
   *
   * The second capability injected here and the same shape as the first: the
   * network is banned in this layer by `check-platform`, and reading a board
   * additionally needs a DOM to run the page's own JavaScript — neither of
   * which a portable layer has or should. On the web it is the capture
   * extension driving a background tab; on a phone it is a plain fetch, which
   * reaches the boards that render on the server and honestly cannot reach the
   * ones that do not.
   *
   * Returns rows UNVETTED. `core/board.ts` decides what is a job, so the rule
   * has one owner and the extension never has to carry a copy of it.
   */
  scan?: (
    url: string,
  ) => Promise<{ ok: true; rows: unknown } | { ok: false; reason: string }>
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

/**
 * Async, because one read is.
 *
 * Reading a PDF means asking MarkItDown, which is a round trip. Everything else
 * here resolves immediately, and a write still cannot await anything — see the
 * note on `ReadTool.read` for why the asymmetry is the safe way round.
 */
export async function callTool(
  host: ToolHost,
  name: string,
  args: unknown,
): Promise<CallOutcome> {
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
    const ctx = {
      ...(host.convert ? { convert: host.convert } : {}),
      ...(host.scan ? { scan: host.scan } : {}),
    }
    return {
      ok: true,
      entry,
      result: await read.read(host.memory(), parsed.value as never, ctx),
    }
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
  return `${json.slice(0, budget)}${TRUNCATION_MARK}${String(budget)} characters. Narrow the search or lower the limit to see the rest.]`
}

/**
 * The sentence a truncated read carries, split out so it has one author.
 *
 * It is appended OUTSIDE the JSON, which is the detail that matters to anyone
 * reading a result back: the longest results — the only ones anybody actually
 * needs help reading — are the ones that will not `JSON.parse`. A UI that
 * sniffed for JSON with a try/catch would beautify every short result and give
 * up on every long one.
 */
const TRUNCATION_MARK = '\n\n[Truncated at '

/**
 * A step's result, told apart into machine data and prose.
 *
 * `detail` is one string carrying two completely different things, because
 * `renderOutcome` above branches on `effect`: a READ comes back as compact JSON
 * and a WRITE comes back as the toast sentence the app would have shown. The
 * trace was rendering both as an undifferentiated wall of monospace, which for
 * a read of forty records is a single 6000-character line.
 *
 * Discriminated on `effect` and `status` rather than by sniffing for a leading
 * brace, and the difference is not fastidiousness — it is the same predicate
 * `renderOutcome` used to CHOOSE the format, so it cannot disagree with it. It
 * also survives storage: `effect` and `status` are both persisted on a stored
 * step, while `output` — the real object, which would be prettier still — is
 * not, so anything built on that would look right during a live run and revert
 * to a wall of text the moment the conversation was reopened.
 */
export type StepDetail =
  | { kind: 'json'; value: unknown; truncated: boolean }
  | { kind: 'text'; value: string }

export function readStepDetail(step: {
  effect: string
  status: string
  detail?: string
}): StepDetail | null {
  const { detail } = step
  if (detail === undefined || detail.length === 0) return null

  // A write's detail is app-authored prose, and a failed or declined step's is
  // an error sentence. Neither is ever JSON, whatever it happens to start with.
  if (step.effect !== 'read' || step.status !== 'done') return { kind: 'text', value: detail }

  const cut = detail.indexOf(TRUNCATION_MARK)
  const head = cut === -1 ? detail : detail.slice(0, cut)
  try {
    return { kind: 'json', value: JSON.parse(head) as unknown, truncated: cut !== -1 }
  } catch {
    // A truncated read is cut mid-value, so its head is not parseable. Showing
    // the raw text is the honest fallback — it is still the result.
    return { kind: 'text', value: detail }
  }
}
