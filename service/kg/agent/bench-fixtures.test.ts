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
import { DOCUMENTS, WORLD, WORLD_SHAPE } from './bench-world'
import { CATALOG } from './catalog'
import { TOOLS } from '../tools/index'
import { COMPOSES } from './tool-graph'
import { scoreWorkflow, shapeOf } from './bench-workflow'

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

/**
 * How much of the write surface this suite actually asks for.
 *
 * The number that explains why an impressive score and a broken import lived
 * together: the rubric required **16 of 82 write tools**, and both of the tools
 * that failed in real use — `profile.background.add` and `claim.add` — were in
 * the other sixty-six. A score is a claim about what was tested, and nobody had
 * ever measured what that was.
 *
 * Pinned as a FLOOR that must rise, not as an exact figure. An exact one turns
 * every new conversation into a failing test and gets deleted; a floor makes
 * shrinking coverage the thing that fails.
 */
describe('how much of the catalog this suite reaches', () => {
  const required = new Set(CONVERSATIONS.flatMap((c) => c.turns.flatMap((t) => [...(t.mustCallOneOf ?? [])])))
  const writes = CATALOG.filter((e) => e.effect !== 'read').map((e) => e.name)
  const covered = writes.filter((w) => required.has(w))

  it('requires the write tools the real failures came from', () => {
    /*
     * Named individually, because these are not a sample — they are the two
     * that broke a deployment while this suite reported everything was fine.
     */
    for (const tool of ['profile.background.add', 'claim.add', 'profile.background.update']) {
      expect(required.has(tool), `${tool} is never required by any conversation`).toBe(true)
    }
  })

  it('does not shrink below what it reaches today', () => {
    /*
     * A floor. Raise it when coverage rises; a drop is a conversation deleted
     * or a rubric loosened, and that should have to be argued for.
     *
     * 19 for a long time, and the number behind "the benchmark says 30/30 and
     * the feature is broken": 63 of the 82 write tools had never been asked
     * for by any case, so `scout.*`, `vault.person.*`, `vault.link.*` and most
     * of `timeline.item.*` could break without a single test going red. The
     * twelve conversations that took it to 39 were written against those
     * families specifically.
     */
    expect(covered.length).toBeGreaterThanOrEqual(39)
  })

  it('keeps every tool family the suite reaches represented', () => {
    /*
     * Per FAMILY, because the count above can be held up by one domain while
     * another disappears. Named individually for the same reason the two
     * regression tools above are: each of these was absent from the suite
     * while the feature it names was shipping.
     */
    for (const prefix of ['scout.', 'vault.person.', 'vault.link.', 'timeline.item.']) {
      const reached = writes.filter((w) => w.startsWith(prefix) && required.has(w))
      expect(reached.length, `no conversation requires any ${prefix}* tool`).toBeGreaterThan(0)
    }
  })

  it('reaches every GROUP it declares', () => {
    // A group with no conversations is a heading in the report over an empty
    // column, which reads as "nothing failed here".
    for (const group of GROUPS) {
      expect(
        CONVERSATIONS.some((c) => c.group === group),
        `the "${group}" group has no conversations`,
      ).toBe(true)
    }
  })
})

/**
 * An answer assertion has to be a fact, not a coincidence.
 *
 * `answerMust` is a substring match, so a bare one- or two-digit string passes
 * vacuously on any answer containing a year — `'6'` matches "2026" — and fails
 * a correct per-stage breakdown that never happens to say "6". A check that can
 * pass by accident and fail when right is worse than no check.
 */
describe('the answer assertions', () => {
  const facts = CONVERSATIONS.flatMap((c) =>
    c.turns.flatMap((t) => (t.answerMust ?? []).map((f) => ({ id: c.id, fact: f }))),
  )

  it('exists at all — the read-only escape needs closing somewhere', () => {
    // A do-nothing agent that always answers scored 16/36 before these. If they
    // all get deleted, that is the number the suite goes back to.
    expect(facts.length).toBeGreaterThanOrEqual(6)
  })

  it('never asserts a bare one- or two-digit number', () => {
    const weak = facts.filter((f) => /^\d{1,2}$/.test(f.fact.trim()))
    expect(weak.map((f) => `${f.id}: "${f.fact}"`), 'use a name or a distinctive word').toEqual([])
  })

  it('never asserts something too short to be distinctive', () => {
    const weak = facts.filter((f) => f.fact.trim().length < 3)
    expect(weak.map((f) => `${f.id}: "${f.fact}"`)).toEqual([])
  })
})

/**
 * An asserted fact has to exist in the world the conversation runs against.
 *
 * Written three times this session and wrong three times: `is: 'compensation'`
 * against a `prop` check that compares with `===`; a keyword the world already
 * seeded; and `answerMust: ['Teaching-track']` for a pipeline the world calls
 * "Industry research roles". Every one of them failed a model that had done
 * exactly the right thing, and every one read as a model failure until someone
 * checked the world.
 *
 * The fixture is text, so this is a substring search over it — crude, and it
 * catches the whole class in fifteen lines.
 */
describe('facts the rubric asserts', () => {
  /*
   * The seeded DATA, not the source text — `node:fs` is banned in `kg/`, and
   * the values are the right thing to search anyway: a fact the rubric asserts
   * has to be in the world the conversation runs against, not merely somewhere
   * in a file.
   */
  const world = `${JSON.stringify(WORLD)} ${JSON.stringify(DOCUMENTS)}`

  const asserted = CONVERSATIONS.flatMap((c) =>
    (c.turns ?? []).flatMap((t) => (t.answerMust ?? []).map((f) => ({ id: c.id, fact: f }))),
  )

  it('names something the seeded world actually contains', () => {
    /*
     * Numbers are exempt: a count or a percentage is computed FROM the world
     * and will not appear in its source. Names are not — a name the world does
     * not contain is a name somebody invented.
     */
    const invented = asserted
      .filter((a) => !/^[\d.,%]+$/.test(a.fact.trim()))
      .filter((a) => !world.toLowerCase().includes(a.fact.toLowerCase()))
    expect(
      invented.map((a) => `${a.id} asserts "${a.fact}", which bench-world.ts never mentions`),
      'the rubric is asserting a fact it invented',
    ).toEqual([])
  })
})

/**
 * An asserted fact must not be a word the question already contains.
 *
 * `source-comparison` asked "Do referrals do better than the job boards?" and
 * asserted the answer contained "referral" — which any restatement of the
 * question satisfies, including one from a model that did no work at all. That
 * is the exact hole `answerMust` was added to close, reopened by the check
 * meant to close it.
 */
describe('answer assertions that could pass by echo', () => {
  const echoes = CONVERSATIONS.flatMap((c) =>
    c.turns.flatMap((t) =>
      (t.answerMust ?? [])
        .filter((f) => t.say.toLowerCase().includes(f.toLowerCase().replace(/s$/, '')))
        .map((f) => `${c.id}: "${f}" is already in the question`),
    ),
  )

  it('asserts something the question does not already say', () => {
    expect(echoes, echoes.join('\n')).toEqual([])
  })
})

/*
 * -----------------------------------------------------------------------------
 * The gold workflows
 * -----------------------------------------------------------------------------
 *
 * The graph axis is a second rubric, written by hand, and every failure mode
 * the state rubric has already had applies to it: a tool that does not exist, a
 * fact taken from memory rather than from the world, an expectation that
 * contradicts another expectation in the same case. It is worse than the state
 * rubric in one way — a wrong gold graph does not fail loudly, it just scores
 * every model down on a dependency nobody actually has, and the number still
 * looks like a number.
 */
describe('the gold workflows', () => {
  const withGraph = CONVERSATIONS.filter((c) => c.workflow !== undefined)

  it('names only tools that exist', () => {
    const known = new Set(CATALOG.map((e) => e.name))
    const missing = withGraph.flatMap((c) =>
      c.workflow!.nodes.filter((n) => !known.has(n.tool)).map((n) => `${c.id}: ${n.tool}`),
    )
    expect(missing, missing.join('\n')).toEqual([])
  })

  it('gives every node a distinct id', () => {
    const clashes = withGraph
      .filter((c) => new Set(c.workflow!.nodes.map((n) => n.id)).size !== c.workflow!.nodes.length)
      .map((c) => c.id)
    expect(clashes).toEqual([])
  })

  it('links only nodes that are there', () => {
    const dangling = withGraph.flatMap((c) => {
      const ids = new Set(c.workflow!.nodes.map((n) => n.id))
      return c.workflow!.links
        .filter((l) => !ids.has(l.source) || !ids.has(l.target))
        .map((l) => `${c.id}: ${l.source} -> ${l.target}`)
    })
    expect(dangling, dangling.join('\n')).toEqual([])
  })

  it('is acyclic, so the dependencies can actually be satisfied', () => {
    /*
     * A cycle is not a hard case to draw, it is an impossible expectation: no
     * ordering of calls can put both ends first. Kahn's algorithm, and what it
     * cannot drain is the cycle.
     */
    const cyclic = withGraph
      .filter((c) => {
        const w = c.workflow!
        const left = new Map(w.nodes.map((n) => [n.id, 0]))
        for (const l of w.links) left.set(l.target, (left.get(l.target) ?? 0) + 1)
        const queue = [...left.entries()].filter(([, n]) => n === 0).map(([id]) => id)
        let drained = 0
        while (queue.length > 0) {
          const id = queue.shift()!
          drained += 1
          for (const l of w.links.filter((x) => x.source === id)) {
            const n = left.get(l.target)! - 1
            left.set(l.target, n)
            if (n === 0) queue.push(l.target)
          }
        }
        return drained !== w.nodes.length
      })
      .map((c) => c.id)
    expect(cyclic).toEqual([])
  })

  it('never requires a call no turn of the conversation allows', () => {
    /*
     * The contradiction that makes a case unpassable: a gold graph asking for a
     * tool there is no turn on which it could be called without failing.
     *
     * EVERY turn, not any. The first version unioned `mustNotCall` across the
     * conversation and reported `profile-relate-two-facts` and
     * `profile-correct-a-fact`, both of which are correct: turn one adds a
     * background fact, and turn two forbids adding another because the right
     * answer there is to UPDATE the one that exists. `mustNotCall` is a
     * per-turn rule, and a guard that reads it as a per-conversation one turns
     * the suite's most careful cases into false positives — which is how a
     * guard gets loosened until it catches nothing.
     */
    const contradictions = withGraph.flatMap((c) =>
      c
        .workflow!.nodes.filter((n) => c.turns.every((t) => (t.mustNotCall ?? []).includes(n.tool)))
        .map((n) => `${c.id}: ${n.tool} is forbidden on every turn`),
    )
    expect(contradictions, contradictions.join('\n')).toEqual([])
  })

  it('never asks a read-only conversation to write', () => {
    const wrote = withGraph.flatMap((c) => {
      if (!c.turns.every((t) => t.readOnly === true || t.shouldAsk === true)) return []
      const effects = new Map(CATALOG.map((e) => [e.name, e.effect]))
      return c.workflow!.nodes.filter((n) => effects.get(n.tool) !== 'read').map((n) => `${c.id}: ${n.tool}`)
    })
    expect(wrote, wrote.join('\n')).toEqual([])
  })

  it('points every runtime argument at a node it actually depends on', () => {
    /*
     * `$s1` means "whatever step s1 returned". If s1 is not an ancestor of the
     * node using it, the value is not available when the call happens — the
     * graph is claiming a data dependency it did not draw an edge for, and the
     * scorer will happily skip the argument and report a graph that cannot run.
     */
    const problems: string[] = []
    for (const c of withGraph) {
      const w = c.workflow!
      const parents = new Map(w.nodes.map((n) => [n.id, new Set<string>()]))
      // Ancestors by repeated relaxation; the graphs are tiny and acyclic.
      for (let pass = 0; pass < w.nodes.length; pass += 1) {
        for (const l of w.links) {
          const into = parents.get(l.target)
          if (!into) continue
          into.add(l.source)
          for (const up of parents.get(l.source) ?? []) into.add(up)
        }
      }
      for (const node of w.nodes) {
        for (const [name, value] of Object.entries(node.args ?? {})) {
          if (!value.startsWith('$')) continue
          const from = value.slice(1)
          if (!parents.get(node.id)?.has(from)) {
            problems.push(`${c.id}: ${node.id}.${name} takes ${value}, which is not upstream of it`)
          }
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('declares the shape its links actually draw', () => {
    /*
     * Through the SHIPPED `shapeOf` rather than a copy of it. The copy that
     * stood here read `tag-new-keyword` — two independent calls feeding one
     * write — as a chain, because it checked that every link had a distinct
     * source and forgot that a chain also needs distinct targets. A rubric
     * guard with its own private idea of the rule is a guard that certifies the
     * bug it is supposed to catch.
     */
    const wrong = withGraph
      .filter((c) => c.workflow!.nodes.length > 0)
      .map((c) => {
        const drawn = shapeOf(c.workflow!)
        return drawn === c.workflow!.shape ? null : `${c.id}: says ${c.workflow!.shape}, draws ${drawn}`
      })
      .filter((x): x is string => x !== null)
    expect(wrong, wrong.join('\n')).toEqual([])
  })

  it('keeps most of the edge axis judgeable', () => {
    /*
     * An edge between two tools the gold graph names more than once cannot be
     * adjudicated from a call list — three `memory.list` calls do not say which
     * occurrence was which — so it is excluded from link precision and only
     * recall sees it. Measured on 2026-08-27: 33 of 55 gold edges, 60%.
     *
     * A floor rather than a target, because the alternative failure is silent.
     * A suite that drifted to mostly-repeated reads would still publish a link
     * precision, and that number would be made almost entirely of absent
     * evidence rather than of measurement. `long-correction-after-drift` is
     * already at zero of three and is blind to a full reversal of its own
     * graph; it is one case, and this is what stops it becoming the norm.
     */
    const totals = withGraph
      .filter((c) => c.workflow!.nodes.length > 0)
      .map((c) => scoreWorkflow(c.workflow!, []))
    const of = totals.reduce((n, s) => n + s.edges.of, 0)
    const adjudicable = totals.reduce((n, s) => n + s.edges.adjudicable, 0)
    expect(of).toBeGreaterThan(0)
    expect(adjudicable / of, `only ${String(adjudicable)}/${String(of)} gold edges are judgeable`).toBeGreaterThanOrEqual(0.55)
  })

  it('covers the suite, and says how much of it when it does not', () => {
    /*
     * A floor rather than an equality. The suite grows, and a case added today
     * without a graph should not fail the build — but the axis has to keep
     * covering most of the suite or its macro-average is a statement about a
     * handful of conversations dressed up as one about the benchmark.
     */
    expect(withGraph.length / CONVERSATIONS.length).toBeGreaterThanOrEqual(0.9)
  })
})
