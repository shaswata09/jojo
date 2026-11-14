/**
 * Executing one tool call: the offered check, argument repair, the refusals
 * for arguments that cannot run, the approval gate, and the tool itself.
 *
 * Every sentence the model reads about its own call is written here — see the
 * comment on a refused repair for why `repair.ts` does not get to write them.
 */

import type { ToolCall } from '../core/model-server'
import { CATALOG, needsConfirming } from './catalog'
import type { CatalogEntry } from './catalog'
import { callTool, renderOutcome } from './execute'
import type { CallOutcome } from './execute'
import { repairArgs, summarizeRepairs } from './repair'
import type { Repair, RepairResult } from './repair'
import { NEVER_IMPLICIT } from './retrieve'
import type { AgentOptions, AgentStep } from './types'

/** What a call needs to know about the run it belongs to. */
export type CallContext = {
  /** The step's id, stable across its `running` and settled emissions. */
  readonly id: string
  /** What this run was allowed to call. `null` is the whole catalog. */
  readonly offered: Set<string> | null
  /** True when the list is a boundary rather than the retriever's guess. */
  readonly enforced: boolean
  /**
   * The reply carrying this call stopped at the model's output limit.
   *
   * Changes the DIAGNOSIS, not the outcome: a truncated `arguments` string is
   * invalid JSON, and telling the model its JSON was malformed invites it to
   * send the same oversized call again.
   */
  readonly truncated: boolean
  /** Characters this result may have; `renderOutcome`'s own default without a window. */
  readonly resultChars: number | undefined
}

/** A call for a tool that was not offered, refused before anything runs. */
function refuseUnoffered(
  onEvent: AgentOptions['onEvent'],
  call: ToolCall,
  entry: CatalogEntry | undefined,
  { id, offered, enforced }: CallContext,
): AgentStep | null {
  /*
   * Refused before anything is looked up, let alone run.
   *
   * A model handed two read tools can still emit a write — small models do,
   * and the whole point of `AgentOptions.tools` is the caller saying which
   * operations belong to this surface. Until this check existed the caller was
   * only asking politely, and `callTool` would happily resolve and RUN a tool
   * that was never on the list.
   *
   * The sentence is the same shape as the unknown-name one on purpose. From the
   * model's side these are the same fact — that name is not available here — and
   * a different phrasing would invite it to retry the same call expecting a
   * different answer. It is emphatically NOT told the tool exists elsewhere,
   * because a model told that will ask for it again.
   */
  /*
   * `enforced`, OR one of the two tools that cannot be undone.
   *
   * The retriever's set is a suggestion — a miss falls through to the approval
   * gate, and the comment above `enforced` (offer.ts) says why that was safe: "with
   * approvals on the person is asked, and with them off a delete still stops".
   *
   * THAT SENTENCE STOPPED BEING TRUE when `auto` was added. `gate: 'none'`
   * stops nothing, so the last control under it was gone, and a run narrowed by
   * the retriever would execute a `memory.clear` the model produced from
   * nowhere — proven with a probe: prompt "what applications do I have at
   * Rice", no mention of wiping, whole store emptied, `undoable: false`.
   *
   * `NEVER_IMPLICIT` is stripped by `offeredFor` precisely because these two are
   * the only un-undoable operations in the app. Making that strip REAL rather
   * than advisory is the fix, and it is not an approval prompt in disguise: the
   * model asked for a name that was never offered, and `auto` still runs
   * everything that WAS. A person who says "wipe everything" gets `asksToWipe`,
   * the tool in `offered`, and no refusal here.
   */
  const neverImplicit = entry !== undefined && NEVER_IMPLICIT.includes(entry.name)
  if (entry && offered && (enforced || neverImplicit) && !offered.has(entry.name)) {
    const step: AgentStep = {
      id,
      name: entry.name,
      title: entry.title,
      effect: entry.effect,
      destructive: entry.destructive,
      args: call.args,
      status: 'failed',
      detail: `No tool is called ${call.name}. Use one of the names given in the tool list, exactly as spelled.`,
    }
    onEvent({ type: 'step', step })
    return step
  }
  return null
}

/** The call's arguments repaired against the tool's schema, or `null` when not attempted. */
function repairFor(entry: CatalogEntry | undefined, call: ToolCall, truncated: boolean): RepairResult | null {
  /*
   * The arguments repaired against the tool's own schema, BEFORE anything is
   * shown, gated or run.
   *
   * ## Why here and not later
   *
   * The position is the whole safety argument. `base` is what the approval gate
   * is handed and what the UI renders, so a repair that happened after it would
   * ask a person to approve one set of arguments and then run another — which
   * is the exact shape of the thing the gate exists to prevent. Repairing first
   * means the person sees, approves and gets the same call. Every check below
   * this line — the approval gate, `runtime.check`, `callTool`'s own catalogue
   * resolution — runs on the repaired call exactly as it ran on the raw one.
   *
   * `NEVER_IMPLICIT` and the offered-list refusal are decided above this line,
   * on the NAME, and repair cannot touch a name. A model that asks for
   * `memory.clear` when it was not offered is refused before this runs, and
   * nothing here can change that.
   *
   * ## What is passed in
   *
   * One call covers both failures, because `repairArgs` takes `unknown`:
   * arguments that parsed go in as the object, arguments that did not go in as
   * the raw string — and the second is the half that currently costs a whole
   * turn, because trailing garbage, a prose-wrapped object and a
   * double-JSON-encoded one all live there.
   *
   * ## The two cases it is deliberately NOT given
   *
   * No entry means no schema, and nothing to repair against — a name the
   * catalogue does not know is already a refusal one line down.
   *
   * A TRUNCATED reply is not repaired at all, even though `repairArgs` would
   * refuse most of them on its own. A reply cut off at the model's output limit
   * has arguments that are genuinely incomplete: thirty facts from a CV import
   * cut partway through the second title. Recovering the first fifteen and
   * running them is not a formatting fix, it is a silent partial write that the
   * person is then told succeeded — and the measured remedy, "send the same call
   * again with FEWER items", stops being sent. This costs almost nothing: in a
   * length-truncated turn only the call that actually failed to parse is
   * affected, and the earlier calls in the same turn parsed fine and are
   * repaired normally.
   */
  return entry !== undefined && !(truncated && call.args === null)
    ? repairArgs(entry.parameters, call.args === null ? call.raw : call.args)
    : null
}

/** Emits a step's settled form, carrying the repair kinds when there were any. */
function settlerFor(onEvent: AgentOptions['onEvent'], repairs: readonly Repair[]) {
  const settle = (step: AgentStep): AgentStep => {
    // Spread conditionally, and only when something was repaired: under
    // `exactOptionalPropertyTypes` an explicit `undefined` is not an absent key,
    // and an empty array on every step would be noise in every trace.
    const settled: AgentStep = {
      ...step,
      ...(repairs.length === 0 ? {} : { repairs: repairs.map((r) => r.kind) }),
    }
    onEvent({ type: 'step', step: settled })
    return settled
  }
  return settle
}

/** A lone value sent to a field that replaces a whole list. */
function refusePartialList(base: AgentStep, repaired: RepairResult | null): AgentStep | null {
  /*
   * A lone value aimed at a list that replaces the set. Refused here, not
   * passed on: the tool would either ignore the stray singular key and report
   * success, or replace every tag with the one sent (R11a). The sentence says
   * what the field does and what to send instead.
   */
  if (repaired?.ok === false && repaired.replacesList !== undefined) {
    const fields = repaired.replacesList.join(', ')
    return {
      ...base,
      status: 'failed',
      detail: `Error: ${fields} replaces the whole list on this tool, so sending one item would remove every other one. Nothing was changed. Read the record for its current list, then send the full list: every item to keep plus the new one, under the field name ${fields}.`,
    }
  }
  return null
}

/** Arguments that did not parse, quoted back with the right diagnosis. */
function refuseUnparsed(base: AgentStep, args: unknown, call: ToolCall, truncated: boolean): AgentStep | null {
  /*
   * Arguments that were not JSON. Quoted back rather than guessed at: the model
   * is the only thing that knows what it meant, and a repair here would be a
   * silent edit to what the user is about to be told happened.
   *
   * TRUNCATION IS A DIFFERENT FAILURE and gets a different sentence. A reply cut
   * off at the model's output limit leaves `arguments` ending mid-string, which
   * reaches `safeParse` as invalid JSON — so the model was told its JSON was
   * malformed, which is not what happened and invites it to send the SAME
   * oversized call again. Reported from a CV import: `profile.background.add`
   * with thirty facts in one array, cut off partway through the second title.
   *
   * The remedy has to be in the sentence, because the model cannot see its own
   * output limit. "Send fewer" is the only thing that works, and the bulk tools
   * are precisely the ones that can be split.
   */
  if (args === null) {
    return {
      ...base,
      status: 'failed',
      detail: truncated
        ? `Error: your reply hit the model's output limit partway through the arguments, so they could not be read. Send the same call again with FEWER items — a third of them — and then call it again for the rest. You sent: ${call.raw.slice(0, 200)}`
        : `Error: the arguments were not valid JSON. You sent: ${call.raw.slice(0, 200)}`,
    }
  }
  return null
}

/** Whether this step has to be approved before it runs, under the caller's policy. */
function isGated(options: AgentOptions, base: AgentStep): boolean {
  /*
   * `'unknown'` is excluded deliberately: it means the model named a tool that
   * does not exist, and `callTool` refuses it a line later regardless. Asking a
   * person to approve a call that cannot happen is asking them to rubber-stamp.
   */
  /*
   * Three settings, and the middle one is where the interesting failure lives.
   *
   *   writes       — every non-read step (85 of 95 tools)
   *   destructive  — `delete` and `admin`, plus the tools that ask (19 of 95),
   *                  plus a call whose arguments ask (`Tool.confirms`)
   *   none         — nothing, and the person chose that explicitly
   *
   * `destructive` USED to be exactly "the ones that remove a record", and is
   * now that plus the few tools that declare themselves so — an offer package
   * being cleared, and the agent's own permission being raised. Closing an application is a `move`, so it passes here — which is
   * the measured gap this exists to be honest about, not a bug in this line.
   */
  const mode = options.gate ?? 'destructive'
  const gated =
    mode === 'none'
      ? false
      : mode === 'writes'
        ? base.effect !== 'read' && base.effect !== 'unknown'
        : base.destructive
  return gated
}

/** The tool's outcome, as the settled step. */
function outcomeStep(base: AgentStep, outcome: CallOutcome, resultChars: number | undefined): AgentStep {
  const detail = renderOutcome(outcome, resultChars)
  if (!outcome.ok) return { ...base, status: 'failed', detail }
  // Spread conditionally: under `exactOptionalPropertyTypes` an explicit
  // `undefined` is not the same as an absent key, and `AgentStep` declares both
  // of these optional rather than optional-or-undefined.
  return {
    ...base,
    status: 'done',
    detail,
    output: outcome.result,
    ...(outcome.announcement ? { announcement: outcome.announcement } : {}),
    ...(outcome.undo ? { undo: outcome.undo } : {}),
  }
}

/**
 * One tool call: describe it, ask permission if it is destructive, run it.
 *
 * Emits twice — `running` then settled — so the UI can show a row appear and
 * then resolve. Both carry the same id.
 */
export async function performCall(options: AgentOptions, call: ToolCall, ctx: CallContext): Promise<AgentStep> {
  const { host, onEvent, approve } = options
  const { id, truncated, resultChars } = ctx
  const entry = CATALOG.find((e) => e.wireName === call.name || e.name === call.name)

  const refused = refuseUnoffered(onEvent, call, entry, ctx)
  if (refused !== null) return refused

  const repaired = repairFor(entry, call, truncated)

  /*
   * A refused repair changes NOTHING. The original arguments carry on to the
   * paths that were already there — the not-valid-JSON sentence below for a
   * `null`, `runtime.check`'s own message for an object it cannot fix — because
   * those messages are accurate and `repairArgs`'s `reason` is deliberately not
   * model-facing. This file keeps ownership of every sentence a model reads.
   */
  const args = repaired?.ok === true ? repaired.args : call.args
  const repairs = repaired?.ok === true ? repaired.repairs : []

  const base: AgentStep = {
    id,
    name: entry?.name ?? call.name,
    title: entry?.title ?? call.name,
    effect: entry?.effect ?? 'unknown',
    // Per call, on the repaired arguments the gate is about to be shown: a
    // pipeline rename passes, pointing it at new boards asks. See `Tool.confirms`.
    destructive: entry === undefined ? false : needsConfirming(entry, args, host.memory()),
    args,
    status: 'running',
  }
  onEvent({ type: 'step', step: base })

  /*
   * Said out loud, as an app note, and not to the model.
   *
   * A repair is a change to what the person is about to be told happened, and
   * the header's original objection to repairing at all — that it "makes the
   * trace a worse record of what happened than the thing it is a trace of" — is
   * answered by this line and only by this line. `app: true` keeps it out of the
   * model's next turn: telling a model its own arguments were reformatted
   * teaches it nothing it can act on and costs tokens on every subsequent
   * request.
   */
  if (repairs.length > 0) {
    onEvent({ type: 'note', app: true, text: `Fixed the arguments: ${summarizeRepairs(repairs)}.` })
  }

  const settle = settlerFor(onEvent, repairs)

  const malformed = refusePartialList(base, repaired) ?? refuseUnparsed(base, args, call, truncated)
  if (malformed !== null) return settle(malformed)

  if (isGated(options, base) && approve) {
    const allowed = await approve(base)
    if (!allowed) {
      return settle({
        ...base,
        status: 'declined',
        detail:
          'The person declined this. Do not try it again in this turn; ask them what they would like instead.',
      })
    }
  }

  // The repaired arguments, which are also the ones on `base` that the approval
  // gate was just shown. One value, so what was approved and what runs cannot
  // differ.
  const outcome = await callTool(host, call.name, args, options.signal)
  return settle(outcomeStep(base, outcome, resultChars))
}
