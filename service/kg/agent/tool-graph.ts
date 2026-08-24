/**
 * Which tools can follow which — derived from the registry, not written down. L3.
 *
 * A model cannot call `keyword.attach` until something has produced a keyword
 * id, and it cannot produce one except with `keyword.create`. That is an edge,
 * and there are 114 more like it. Together they are the fact a guided retriever
 * needs: if you offer a model a tool, you must also offer whatever produces the
 * ids that tool requires, or you have offered it a dead end.
 *
 * ## Why it is derived
 *
 * Because a hand-written graph is a second copy of the truth, and this repo has
 * a guard against exactly that. `catalog.ts` states the principle for the tool
 * list — "a tool added to `TOOLS` is callable by a model, and listed over MCP,
 * on the same day, without anybody remembering to update a manifest" — and a
 * graph maintained by hand would break it on the first tool somebody added
 * while thinking about something else. Nothing here is authored except the
 * `COMPOSES` table below, which cannot be derived and has a drift test instead.
 *
 * The derivation works because the schema keeps what it needs. `s.id('keyword')`
 * stores `nodeType` on `FieldMeta` (see `core/schema.ts`), and every combinator
 * — optional, nullable, array, record, object — copies the inner meta by value.
 * So walking `tool.input.meta` recovers every id slot with its type, its path
 * and whether it is required.
 *
 * ## It must be built from Schema, never from JSON Schema
 *
 * `json-schema.ts` erases `nodeType` into a bare `string`, keeping it only as an
 * English sentence in the description. Recovering the type by parsing that
 * sentence back out would be the second-copy problem again, wearing a regex.
 *
 * ## Two rules that took measurement to get right
 *
 * **A producer is `effect === 'create'` AND not a consumer of the same type.**
 * The obvious rule — `touches` × create — mints false producers:
 * `scout.posting.promote` declares `touches: ['posting', 'application']` while
 * REQUIRING a posting id, so it looks like it produces the thing it consumes.
 * Believing that would let a closure stop early and hand the model a chain it
 * cannot start.
 *
 * **Only REQUIRED id slots are preconditions.** About a third of the id slots in
 * the registry are optional — `application.create` takes `keywords[]?`, for
 * instance. An optional slot is a thing the model MAY fill, not something it
 * must first obtain, and treating it as a precondition makes the offered set
 * larger rather than smaller, which is the opposite of the point.
 */

import { TOOLS } from '../tools/index'
import type { NodeType } from '../core/model'
import type { FieldMeta } from '../core/schema'
import { READS } from './queries'

/**
 * The types a polymorphic id slot could point at.
 *
 * Three tools — `keyword.attach`, `keyword.detach`, `keyword.record.set` — take
 * a `record` id with no node type, because a keyword may sit on any of five
 * kinds of record. The schema checks the value against `TAGGABLE` at parse
 * time; here the slot expands to the whole union, so the closure offers every
 * producer that could satisfy it. A union, never a hole: a slot this cannot
 * type must widen the graph, not silently leave it disconnected.
 */
const TAGGABLE: readonly NodeType[] = ['application', 'timelineItem', 'link', 'file', 'snippet']

/** One id-shaped field, wherever it sits in a nested input. */
export type IdSlot = {
  /** Null for the polymorphic slots, which expand to `TAGGABLE`. */
  readonly nodeType: NodeType | null
  /** False under an `optional()` anywhere above it. */
  readonly required: boolean
}

/**
 * Every id field in a schema, however deeply nested.
 *
 * `required` is inherited: a required field inside an optional object is not a
 * precondition, because the object it sits in need never be sent. That is the
 * same reading `json-schema.ts` takes when it decides what goes in `required`.
 */
export function idSlots(meta: FieldMeta, inherited = true): IdSlot[] {
  const required = inherited && meta.optional !== true
  const out: IdSlot[] = []
  if (meta.kind === 'id') out.push({ nodeType: meta.nodeType ?? null, required })
  if (meta.fields) for (const field of Object.values(meta.fields)) out.push(...idSlots(field, required))
  if (meta.of) out.push(...idSlots(meta.of, required))
  return out
}

/** The node types a tool must be handed an id of before it can run at all. */
export const NEEDS: ReadonlyMap<string, ReadonlySet<NodeType>> = (() => {
  const out = new Map<string, Set<NodeType>>()
  for (const tool of Object.values(TOOLS)) {
    const types = new Set<NodeType>()
    for (const slot of idSlots(tool.input.meta)) {
      if (!slot.required) continue
      if (slot.nodeType === null) for (const t of TAGGABLE) types.add(t)
      else types.add(slot.nodeType)
    }
    out.set(tool.name, types)
  }
  // Reads are excluded deliberately. A read's id comes from another read, and
  // every read is always offered, so expanding them would add nothing and pull
  // half the registry in behind `memory.get`.
  for (const read of Object.values(READS)) out.set(read.name, new Set())
  return out
})()

/**
 * Which tools mint a fresh id of each type.
 *
 * `effect === 'create'` and not itself requiring one of the same type — see the
 * header for the two promotes this second clause excludes and why believing
 * them would break a closure.
 */
export const PRODUCERS: ReadonlyMap<NodeType, ReadonlySet<string>> = (() => {
  const out = new Map<NodeType, Set<string>>()
  for (const tool of Object.values(TOOLS)) {
    if (tool.effect !== 'create') continue
    const needs = NEEDS.get(tool.name) ?? new Set<NodeType>()
    for (const type of tool.touches) {
      if (needs.has(type)) continue
      const set = out.get(type) ?? new Set<string>()
      set.add(tool.name)
      out.set(type, set)
    }
  }
  return out
})()

/**
 * Tools that call other tools inside their own `run`, which no schema declares.
 *
 * `application.create` mints an organisation, keywords and timeline items while
 * declaring `touches: ['application']`; `application.stage.advance` mints a
 * timeline item. These are DOWNSTREAM edges — they add no producers, they tell
 * the retriever that offering the parent already covers the child, so a message
 * about filing an application does not also need the timeline tools.
 *
 * This is the one authored thing in the file, because a `ctx.call` inside a
 * function body cannot be derived from a type. It is kept honest by
 * `tool-graph.test.ts`, which reads every `ctx.call('…')` literal out of
 * `kg/tools/*.ts` and fails when one is missing here — so it is a list that
 * cannot silently fall behind rather than a second copy of the truth.
 */
export const COMPOSES: ReadonlyMap<string, readonly string[]> = new Map([
  /*
   * The two application writers reach furthest, and not obviously: they call
   * `syncKeywords` and `syncDeadline` in `application-fields.ts`, which are
   * where the timeline and keyword calls actually live. Nothing about
   * `application.create`'s own source says it touches the timeline — which is
   * exactly why the drift test reads the call sites rather than trusting a
   * reading of the tool files.
   */
  [
    'application.create',
    [
      'org.ensure',
      'keyword.record.set',
      'timeline.item.create',
      'timeline.item.update',
      'timeline.item.delete',
    ],
  ],
  [
    'application.update',
    [
      'org.ensure',
      'keyword.record.set',
      'timeline.item.create',
      'timeline.item.update',
      'timeline.item.delete',
    ],
  ],
  ['application.stage.advance', ['timeline.item.create']],
  ['scout.posting.promote', ['application.create']],
  ['scout.match.promote', ['application.create']],
  ['profile.document.add', ['vault.file.add']],
  /*
   * `pipeline.proposal.approve` calls whatever tool the stored proposal names —
   * `ctx.call(tool as ToolName, …)`, the one dynamic dispatch in the registry.
   * Its callees cannot be listed because they are data, not code, so the entry
   * is empty and deliberately so. The drift test only matches string LITERALS,
   * so this site does not appear there either, and the two absences agree.
   */
  ['pipeline.proposal.approve', []],
])

/** Callable with nothing in hand — where a run with no ids can start. */
export const ROOTS: readonly string[] = Object.values(TOOLS)
  .filter((t) => (NEEDS.get(t.name)?.size ?? 0) === 0)
  .map((t) => t.name)

/**
 * The tools that must be offered alongside these, so no chain dead-ends.
 *
 * A FIXPOINT rather than one hop, and that is what makes "no dead ends" true
 * end to end: seeding `application.stage.advance` pulls in `application.create`,
 * which is fine, but seeding `scout.posting.promote` pulls in a posting
 * producer, and if THAT needed something the walk has to keep going. It
 * converges quickly — the graph is shallow — but "quickly" is not "always", and
 * the loop is the only thing that makes the guarantee unconditional.
 */
export function closeOver(seed: Iterable<string>): Set<string> {
  const set = new Set(seed)
  let growing = true
  while (growing) {
    growing = false
    for (const name of [...set]) {
      for (const type of NEEDS.get(name) ?? []) {
        for (const producer of PRODUCERS.get(type) ?? []) {
          if (set.has(producer)) continue
          set.add(producer)
          growing = true
        }
      }
    }
  }
  return set
}
