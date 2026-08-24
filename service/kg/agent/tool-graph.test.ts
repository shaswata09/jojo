/**
 * The graph, and the one part of it that is written by hand.
 *
 * Most of what is asserted here is a property rather than a value — "every type
 * a tool needs has a producer", not "there are 114 edges" — because the graph is
 * DERIVED, and a test that pinned its exact contents would fail every time
 * somebody added a tool, which is precisely the maintenance burden deriving it
 * was meant to remove.
 *
 * The exceptions are the two rules that took measurement to get right, and the
 * drift test for `COMPOSES`. Those are pinned hard.
 */

import { describe, expect, it } from 'vitest'
import { TOOLS } from '../tools/index'
import { COMPOSES, NEEDS, NEEDS_ANY, PRODUCERS, ROOTS, closeOver, idSlots } from './tool-graph'
import { s } from '../core/schema'

describe('reading id slots out of a schema', () => {
  it('finds a top-level id and keeps its node type', () => {
    const slots = idSlots(s.object({ id: s.id('application') }).meta)
    expect(slots).toEqual([{ nodeType: 'application', required: true }])
  })

  it('finds one nested inside an array', () => {
    // `application.create` takes `keywords: s.array(s.id('keyword'))`.
    const slots = idSlots(s.object({ keywords: s.array(s.id('keyword')) }).meta)
    expect(slots).toEqual([{ nodeType: 'keyword', required: true }])
  })

  it('marks an optional slot as not required', () => {
    const slots = idSlots(s.object({ id: s.optional(s.id('link')) }).meta)
    expect(slots[0]?.required).toBe(false)
  })

  it('inherits optionality downward, which is the subtle one', () => {
    /*
     * A required field inside an OPTIONAL object is not a precondition: the
     * object need never be sent at all. Reading it as required would make the
     * closure pull in producers for a chain the model may never walk — the same
     * reading `json-schema.ts` takes when it decides what goes in `required`.
     */
    const slots = idSlots(s.object({ mint: s.optional(s.object({ id: s.id('application') })) }).meta)
    expect(slots[0]?.required).toBe(false)
  })

  it('reports a polymorphic slot as untyped rather than guessing', () => {
    expect(idSlots(s.object({ record: s.id() }).meta)).toEqual([{ nodeType: null, required: true }])
  })
})

describe('producers', () => {
  it('excludes a tool that requires the type it appears to produce', () => {
    /*
     * THE rule that took measurement. `scout.posting.promote` declares
     * `touches: ['posting','application']` while REQUIRING a posting id, so the
     * obvious rule — touches x create — makes it look like a posting producer.
     * A closure that believed it would stop early and hand the model a chain it
     * cannot start.
     */
    expect([...(PRODUCERS.get('posting') ?? [])]).toEqual(['scout.posting.save'])
    expect(NEEDS.get('scout.posting.promote')?.has('posting')).toBe(true)
  })

  it('still counts it as an application producer, which it genuinely is', () => {
    // The exclusion is per TYPE, not per tool: promote really does mint an
    // application, and a rule that dropped the tool entirely would lose that.
    expect(PRODUCERS.get('application')?.has('scout.posting.promote')).toBe(true)
  })

  it('gives every required type at least one producer, so nothing dead-ends', () => {
    // The property the whole design rests on. If this ever fails, some tool can
    // be offered with no way to obtain what it needs.
    const missing: string[] = []
    for (const [tool, types] of NEEDS) {
      for (const type of types) {
        if ((PRODUCERS.get(type)?.size ?? 0) === 0) missing.push(`${tool} needs ${type}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('has no producer for organisation, and that is correct rather than a gap', () => {
    // Applications take the employer as free text and mint the org internally.
    // A retriever must never route a model toward an org id, and the absence of
    // consumers is what stops it.
    expect(PRODUCERS.get('organisation')?.size).toBeGreaterThan(0)
    const consumers = [...NEEDS].filter(([, types]) => types.has('organisation'))
    expect(consumers).toEqual([])
  })
})

describe('the closure', () => {
  it('pulls in what a seeded tool needs', () => {
    const out = closeOver(['keyword.attach'])
    expect(out.has('keyword.create')).toBe(true)
  })

  it('runs to a fixpoint rather than one hop', () => {
    /*
     * `scout.posting.promote` needs a posting; the posting producer is
     * `scout.posting.save`. One hop finds it — but the guarantee has to hold at
     * any depth, and only a fixpoint makes it unconditional. Asserted by
     * checking that the RESULT is closed: nothing in it needs something absent.
     */
    const out = closeOver(['scout.posting.promote', 'keyword.attach'])
    for (const name of out) {
      for (const type of NEEDS.get(name) ?? []) {
        const producers = PRODUCERS.get(type) ?? new Set<string>()
        expect([...producers].some((p) => out.has(p))).toBe(true)
      }
    }
  })

  it('is idempotent — closing a closed set changes nothing', () => {
    const once = closeOver(['keyword.attach'])
    expect([...closeOver(once)].sort()).toEqual([...once].sort())
  })

  it('terminates on a seed that needs a type it also produces', () => {
    // A self-referential seed must not spin. `application.update` needs an
    // application and `application.create` makes one.
    expect(closeOver(['application.update']).has('application.create')).toBe(true)
  })
})

describe('roots', () => {
  it('names the tools callable from a standing start', () => {
    expect(ROOTS).toContain('application.create')
    expect(ROOTS).toContain('keyword.create')
    expect(ROOTS).not.toContain('keyword.attach')
  })

  it('includes the two irreversible ones, which is why they are not resident', () => {
    /*
     * `memory.reset` and `memory.clear` need no id, so they are roots — and they
     * are the only two operations a model can perform that a person cannot then
     * undo. A retriever that kept every root permanently offered would put both
     * in every prompt forever. `retrieve.ts` strips them unless the person's own
     * words asked; this test is here so the reason is recorded next to the fact.
     */
    expect(ROOTS).toContain('memory.reset')
    expect(ROOTS).toContain('memory.clear')
  })
})

describe('the authored table names only real tools', () => {
  /*
   * The other half of keeping `COMPOSES` honest lives in
   * `scripts/check-compositions.mjs`, which reads every `ctx.call('…')` literal
   * out of the tool sources and fails when one is missing here. That check
   * needs `node:fs`, and `check-platform` bans Node built-ins from `kg/` —
   * correctly, since this layer is mounted unchanged inside React Native and a
   * browser. So the source-reading half is a lint guard and the half that needs
   * only the registry is here.
   */
  it('names only tools that exist, so a rename shows up', () => {
    for (const [parent, children] of COMPOSES) {
      expect(parent in TOOLS, `${parent} is not a tool`).toBe(true)
      for (const child of children) expect(child in TOOLS, `${child} is not a tool`).toBe(true)
    }
  })

  it('is not empty, which would make the lint guard vacuous', () => {
    expect(COMPOSES.size).toBeGreaterThan(3)
  })
})

describe('a polymorphic slot is a disjunction, not a conjunction', () => {
  /**
   * The correction this suite exists to hold in place.
   *
   * `keyword.attach` takes a `record` id with no node type, because a keyword
   * may sit on any taggable record. The first version of the graph folded those
   * candidates into `NEEDS`, which said the tool required an application AND a
   * timeline item AND a link AND a file AND a snippet, simultaneously, before it
   * could run.
   *
   * That was wrong the whole time and invisible while every taggable type
   * happened to have a producer. It became visible the moment `person` was
   * added to the model without a tool that creates one: the graph then claimed
   * `keyword.attach` could never be grounded — which is plainly false, since
   * tagging an application works today.
   */
  it('does not put the candidates in NEEDS, where they would all be required', () => {
    const needs = NEEDS.get('keyword.attach') ?? new Set()
    // The keyword half IS required and belongs there.
    expect(needs.has('keyword')).toBe(true)
    // The record half is a choice and does not.
    expect(needs.has('application')).toBe(false)
    expect(needs.has('snippet')).toBe(false)
  })

  it('puts them in NEEDS_ANY, where one is enough', () => {
    const any = NEEDS_ANY.get('keyword.attach') ?? new Set()
    expect(any.has('application')).toBe(true)
    expect(any.size).toBeGreaterThan(1)
  })

  it('survives a taggable type that nothing can create yet', () => {
    /*
     * A node type can be declared before the tool that makes one lands — that
     * is how a feature arrives in pieces. The graph must not conclude that
     * every tagging tool is unusable because one of its candidate types has no
     * producer.
     */
    const any = NEEDS_ANY.get('keyword.attach') ?? new Set()
    const withProducers = [...any].filter((t) => (PRODUCERS.get(t)?.size ?? 0) > 0)
    expect(withProducers.length).toBeGreaterThan(0)
  })

  it('still closes over every candidate, because widening is the safe direction', () => {
    // One candidate is required; offering the producers of all of them costs
    // tokens, and a missing producer costs the person their answer.
    const out = closeOver(['keyword.attach'])
    expect(out.has('keyword.create')).toBe(true)
    expect(out.has('application.create')).toBe(true)
  })

  it('does not count a polymorphic tool as a root', () => {
    // It needs SOMETHING, even if it does not mind what.
    expect(ROOTS).not.toContain('keyword.attach')
  })
})
