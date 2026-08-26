/**
 * The benchmark checking itself.
 *
 * ## Why this exists
 *
 * Three times now an expectation has gone stale and scored CORRECT model
 * behaviour as a failure — which is the worst way for a benchmark to be wrong,
 * because the number moves and the reason does not appear anywhere.
 *
 * The three:
 *   - `destructive-bait` and `no-such-record` asserted the vault still held
 *     three files. Both are RESTRAINT tests: the model correctly touched
 *     nothing, and the world had grown a fourth file since the checks were
 *     written. Two models were marked down for doing exactly the right thing.
 *   - `file-under-application` asserted three for the same reason, with a `why`
 *     that said "a fourth file means it created rather than filed" — describing
 *     a world that no longer existed.
 *
 * The fix for the individual numbers is arithmetic. The fix for the CLASS is
 * this file: a conversation cannot end with fewer records than the world began
 * with unless it deletes some, and that is checkable without running a model.
 */

import { describe, expect, it } from 'vitest'
import { CONVERSATIONS, GROUPS } from './bench-conversations'
import { WORLD_SHAPE } from './bench-world'
import { CATALOG } from './catalog'
import { TOOLS } from '../tools/index'
import { COMPOSES } from './tool-graph'

const SHAPE = WORLD_SHAPE as Readonly<Record<string, number>>

/**
 * The record TYPES a conversation could legitimately end up with fewer of.
 *
 * Per type, not per conversation — and that distinction is the whole guard.
 * Written first as "does this conversation remove anything at all", it exempted
 * `destructive-bait` entirely because that conversation clears a deadline; the
 * stale FILE count then sailed through the check written to catch it. Mutation
 * testing found it: restoring the original bad number left the suite green.
 *
 * Derived from the tools each turn is allowed to call, via the registry's own
 * `touches`, so it cannot drift from what the tools actually do.
 */
const shrinkable = (id: string): ReadonlySet<string> => {
  const out = new Set<string>()
  const c = CONVERSATIONS.find((x) => x.id === id)
  if (!c) return out

  for (const turn of c.turns) {
    for (const name of turn.mustCallOneOf ?? []) {
      /*
       * COMPOSITIONS included, and that is not a detail.
       *
       * `destructive-bait` is allowed only `application.update`, whose own
       * `touches` is `['application']` — yet clearing a deadline removes a
       * TIMELINE ITEM, because `application-fields.ts` calls
       * `timeline.item.delete` underneath. Nothing about the tool's own
       * declaration says so; `COMPOSES` in `tool-graph.ts` is where that is
       * written down, and `check-compositions.mjs` keeps it honest against the
       * real call sites.
       */
      for (const reached of [name, ...(COMPOSES.get(name) ?? [])]) {
        const entry = TOOLS[reached as keyof typeof TOOLS] as
          | { effect?: string; touches?: readonly string[] }
          | undefined
        if (entry === undefined) continue
        if (entry.effect !== 'delete' && entry.effect !== 'admin') continue
        for (const type of entry.touches ?? []) out.add(type)
      }
    }
  }
  return out
}

describe('the world and the checks agree', () => {
  it('never expects fewer records than the world starts with, unless it removes some', () => {
    /*
     * THE guard. A restraint test asserting a count below the starting shape is
     * asserting that the model destroyed something — the opposite of what it is
     * testing — and it fails on a model that behaves perfectly.
     */
    const stale: string[] = []
    for (const c of CONVERSATIONS) {
      for (const check of c.finalState) {
        if (check.kind !== 'count') continue
        const start = SHAPE[check.type]
        if (start === undefined) continue
        if (check.is < start && !shrinkable(c.id).has(check.type)) {
          stale.push(
            `${c.id}: expects ${String(check.is)} ${check.type}, world starts at ${String(start)} — "${check.why}"`,
          )
        }
      }
    }
    expect(stale, stale.join('\n')).toEqual([])
  })

  it('names a type the world actually has', () => {
    // A check against a type nothing seeds passes vacuously at zero for ever.
    for (const c of CONVERSATIONS) {
      for (const check of c.finalState) {
        if (check.kind !== 'count') continue
        expect(SHAPE[check.type], `${c.id} counts "${check.type}", which the world never makes`)
          .toBeDefined()
      }
    }
  })

  it('names only tools that exist', () => {
    /*
     * A renamed tool would otherwise read as a model regression: every turn
     * requiring it fails, the report says `no-required-call`, and nothing points
     * at the rename.
     */
    const known = new Set(CATALOG.map((e) => e.name))
    const missing: string[] = []
    for (const c of CONVERSATIONS) {
      for (const t of c.turns) {
        for (const name of [...(t.mustCallOneOf ?? []), ...(t.mustNotCall ?? [])]) {
          if (!known.has(name)) missing.push(`${c.id}: ${name}`)
        }
      }
    }
    expect(missing, missing.join('\n')).toEqual([])
  })

  it('gives every conversation a group the report knows about', () => {
    for (const c of CONVERSATIONS) expect(GROUPS).toContain(c.group)
  })

  it('gives every conversation at least one turn and one state check', () => {
    // A conversation with no state check scores on tool choice alone, which is
    // the axis a model can satisfy while leaving the store wrong.
    for (const c of CONVERSATIONS) {
      expect(c.turns.length, `${c.id} has no turns`).toBeGreaterThan(0)
      expect(c.finalState.length, `${c.id} checks nothing about the store`).toBeGreaterThan(0)
    }
  })
})

/**
 * The state axis has to be able to fail.
 *
 * Scored against a world nothing had acted on, 32 of the 52 state checks
 * passed. Those 32 are damage-guards — `absent`, and `count` at the world's own
 * starting shape — and they earn their place: they are what catches a model
 * that invents a record or deletes one it was only asked about. But they pass
 * for a model that does nothing at all, so a rubric made only of them would
 * report a broken agent as perfect.
 *
 * What keeps the axis honest is the other kind: a check that is FALSE until the
 * right action happens. `exists`, `tagged`, and `prop` are all of that kind —
 * they name a record or a field that the conversation has to bring into being.
 *
 * This asserts the mix, per group, so the rubric cannot quietly drift into
 * all-guards as conversations are added. The floor is deliberately low: some
 * groups are read-only by design and have nothing to demand.
 */
describe('the state rubric discriminates', () => {
  /*
   * Checks that cannot pass until the conversation has actually done something.
   *
   * `exists`, `tagged` and `prop` always qualify — each names a record or field
   * that has to be brought into being. A `count` usually does not, because most
   * of them restate the world's own starting shape and so pass untouched — but
   * one that expects a DIFFERENT number is demanding a create or a delete, and
   * `destructive-bait` is scored almost entirely on one of those.
   */
  const shape = WORLD_SHAPE as Record<string, number>
  const demanding = (c: (typeof CONVERSATIONS)[number]) =>
    c.finalState.filter((s) =>
      s.kind === 'count' ? s.is !== shape[s.type] : s.kind !== 'absent',
    )

  it('asks every conversation that writes to prove it wrote', () => {
    // A conversation whose turns name a write tool but whose rubric only ever
    // guards against damage is scored entirely on restraint: it would pass with
    // the write silently missing. `readOnly`/`shouldAsk` turns are the ones
    // where that is the intended reading, so a conversation made only of those
    // is exempt.
    const acting = CONVERSATIONS.filter((c) => c.turns.some((t) => t.readOnly !== true && t.shouldAsk !== true))
    const blind = acting.filter((c) => demanding(c).length === 0)
    expect(blind.map((c) => c.id)).toEqual([])
  })

  it('keeps a demanding check in every group that acts', () => {
    const byGroup = new Map<string, number>()
    for (const c of CONVERSATIONS) {
      byGroup.set(c.group, (byGroup.get(c.group) ?? 0) + demanding(c).length)
    }
    // Two groups are exempt, for opposite reasons. In `restraint`, doing
    // nothing IS the whole answer. In `analytics`, every turn is a question:
    // the right behaviour leaves the store identical, so the positive
    // requirement lives on the turn axis (`stats.report` and friends) and the
    // state checks can only ever be guards. Asserting a demanding check there
    // would mean inventing a write the conversation should not perform.
    const acts = GROUPS.filter((g) => g !== 'restraint' && g !== 'analytics')
    expect(acts.filter((g) => (byGroup.get(g) ?? 0) === 0)).toEqual([])
  })
})

/**
 * A forbidden list has to name every tool that reaches the same field.
 *
 * The three `ambiguity` conversations forbade `application.stage.set` and
 * `application.stage.advance` — and said nothing about `application.update`,
 * which takes a `stage` and stamps the same "Moved to X". A model that guessed
 * which of two records to move, and did it through `update`, passed the
 * forbidden-call check. **The reported `forbidden-call` counts were a floor.**
 *
 * That is the worst kind of gap in a benchmark: it does not fail, it under-
 * reports, and the number looks like evidence of safety.
 *
 * So the list is checked against the tool SCHEMAS rather than against memory.
 * A fifth way to write a stage fails here on the day it is added.
 */
describe('forbidding a change means forbidding every way to make it', () => {
  /** Every write tool whose input mentions this field, at any depth. */
  const writersOf = (field: string): string[] =>
    CATALOG.filter((entry) => {
      if (entry.effect === 'read') return false
      const meta = (TOOLS as Record<string, { input?: { meta?: unknown } }>)[entry.name]?.input?.meta
      return JSON.stringify(meta ?? {}).includes(`"${field}"`)
    }).map((entry) => entry.name)

  it('names every tool that can move a stage', () => {
    const forbidding = CONVERSATIONS.flatMap((c) =>
      c.turns.filter((t) => (t.mustNotCall ?? []).includes('application.stage.set')),
    )
    expect(forbidding.length).toBeGreaterThan(0)

    const writers = writersOf('stage')
    // Four today: create, update, stage.set, stage.advance.
    expect(writers.length).toBeGreaterThan(2)

    for (const turn of forbidding) {
      const forbidden = new Set(turn.mustNotCall ?? [])
      const missed = writers.filter((name) => !forbidden.has(name))
      expect(missed, `these can move a stage and are not forbidden: ${missed.join(', ')}`).toEqual(
        [],
      )
    }
  })

  it('accepts every tool that can move a stage where one is required', () => {
    // The other direction, and the reason `rice-resolved` failed against a
    // model that did the right thing: it moved the stage with
    // `application.update`, which the rubric did not list. `mustCallOneOf` is
    // meant to be generous — a suite that insists on one of several correct
    // moves is measuring agreement with whoever wrote it.
    const requiring = CONVERSATIONS.flatMap((c) =>
      c.turns.filter((t) => (t.mustCallOneOf ?? []).includes('application.stage.set')),
    )
    expect(requiring.length).toBeGreaterThan(0)

    for (const turn of requiring) {
      const allowed = new Set(turn.mustCallOneOf ?? [])
      // `application.create` is excluded on purpose: making a NEW record at the
      // target stage is not moving the one that was named.
      const missed = writersOf('stage')
        .filter((n) => n !== 'application.create')
        .filter((name) => !allowed.has(name))
      expect(missed, `these move a stage and are not accepted: ${missed.join(', ')}`).toEqual([])
    }
  })
})
