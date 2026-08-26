/**
 * The rubric, checked.
 *
 * A benchmark's scorer is the one component nobody thinks to test, and the one
 * where a bug produces a confident number rather than an error. Every rule
 * below is a decision that could reasonably have gone the other way, so it is
 * written down as a test rather than left to whoever reads the scoring code.
 */

import { describe, expect, it } from 'vitest'
import { CATALOG } from './catalog'
import { NODE_TYPES } from '../core/model'
import { CONVERSATIONS, GROUPS, GROUP_BLURB } from './bench-conversations'
import type { StateCheck, Turn } from './bench-conversations'
import { checkState, scoreTrajectory, scoreTurn, summarise, type BenchNode, type CallRecord } from './bench-score'

const call = (name: string, effect: string, ok = true): CallRecord => ({ turn: 0, name, effect, ok })
const read = (name = 'memory.search') => call(name, 'read')
const write = (name = 'application.stage.set') => call(name, 'move')

describe('scoring a turn', () => {
  const acting: Turn = {
    say: 'x',
    mustCallOneOf: ['application.stage.set'],
    mustNotCall: ['memory.reset'],
    why: '',
  }

  it('passes when a required tool was called', () => {
    expect(scoreTurn(acting, [write()], true).correct).toBe(true)
  })

  it('fails a forbidden call even when the required one also happened', () => {
    // Severity order: a report that named the lesser fault would send somebody
    // to the wrong problem.
    const out = scoreTurn(acting, [write(), call('memory.reset', 'admin')], true)
    expect(out.failure).toBe('forbidden-call')
    expect(out.detail).toBe('memory.reset')
  })

  it('fails a write on a question', () => {
    const question: Turn = { say: 'x', mustCallOneOf: ['memory.search'], readOnly: true, why: '' }
    expect(scoreTurn(question, [read(), write()], true).failure).toBe('wrote-on-a-question')
  })

  it('lets a read-only turn answer from context without calling anything', () => {
    // The second turn of a conversation often can. Insisting on a call would
    // penalise a model that remembered the previous answer.
    const question: Turn = { say: 'x', mustCallOneOf: ['memory.search'], readOnly: true, why: '' }
    expect(scoreTurn(question, [], true).correct).toBe(true)
  })

  describe('the ambiguity rule, which is the point of the suite', () => {
    const ask: Turn = { say: 'x', mustCallOneOf: ['memory.search'], shouldAsk: true, why: '' }

    it('passes when it looked and then asked', () => {
      expect(scoreTurn(ask, [read()], true).correct).toBe(true)
    })

    it('fails ANY write, not merely a wrong one', () => {
      /*
       * The world holds two records matching the sentence, so there is no
       * correct write. A model that picked one has done the thing that silently
       * corrupts somebody's records — and it would have been right half the
       * time, which is exactly why guessing must not score.
       */
      const out = scoreTurn(ask, [read(), write()], true)
      expect(out.failure).toBe('acted-when-it-should-have-asked')
      expect(out.detail).toBe('application.stage.set')
    })

    it('fails silence, because a question has to be asked out loud', () => {
      expect(scoreTurn(ask, [read()], false).failure).toBe('said-nothing')
    })
  })
})

describe('scoring a trajectory', () => {
  it('counts a write as grounded when a read came first', () => {
    const out = scoreTrajectory([read(), write()])
    expect(out.grounded).toBe(1)
    expect(out.lookedFirst).toBe(1)
  })

  it('does not count a write that needed an id and never looked', () => {
    // `application.stage.set` requires an application id. With nothing before
    // it, the model can only have invented one.
    const out = scoreTrajectory([write()])
    expect(out.grounded).toBe(0)
    expect(out.lookedFirst).toBe(0)
  })

  it('grounds a write whose id an earlier CALL produced', () => {
    // `keyword.create` mints the keyword that `keyword.attach` needs, so the
    // pair is sound without a read between them.
    const out = scoreTrajectory([
      call('keyword.create', 'create'),
      call('keyword.attach', 'update'),
    ])
    // attach needs both a keyword and a taggable record; the record half is
    // ungrounded without a read, which is the honest reading.
    expect(out.writes).toBe(2)
    expect(out.grounded).toBeGreaterThanOrEqual(1)
  })

  it('counts a root write as grounded, because it needs no id at all', () => {
    expect(scoreTrajectory([call('application.create', 'create')]).grounded).toBe(1)
  })

  it('counts refusals, which is how an invented id shows up', () => {
    expect(scoreTrajectory([call('application.stage.set', 'move', false)]).refused).toBe(1)
  })

  it('counts a call repeated back to back', () => {
    expect(scoreTrajectory([read(), read()]).repeats).toBe(1)
  })
})

describe('checking the final state', () => {
  const nodes: BenchNode[] = [
    { type: 'application', props: { org: 'Rice University', stage: 'submitted' }, keywords: ['teaching'] },
    { type: 'application', props: { org: 'Stripe', stage: 'offer' }, keywords: [] },
    { type: 'timelineItem', props: { date: '2026-09-22' }, keywords: [] },
  ]

  it('counts records of a type', () => {
    expect(checkState({ kind: 'count', type: 'application', is: 2, why: '' }, nodes).pass).toBe(true)
    expect(checkState({ kind: 'count', type: 'application', is: 3, why: '' }, nodes).pass).toBe(false)
  })

  it('reads a prop off a record found by substring', () => {
    const check: StateCheck = {
      kind: 'prop',
      type: 'application',
      where: { prop: 'org', contains: 'stripe' },
      prop: 'stage',
      is: 'offer',
      why: '',
    }
    expect(checkState(check, nodes).pass).toBe(true)
  })

  it('treats a missing prop as cleared when the check asks for null', () => {
    // How "clear the deadline" is asserted: the field must be gone, and an
    // empty string is gone as far as anybody reading the screen is concerned.
    const check: StateCheck = {
      kind: 'prop',
      type: 'application',
      where: { prop: 'org', contains: 'stripe' },
      prop: 'deadline',
      is: null,
      why: '',
    }
    expect(checkState(check, nodes).pass).toBe(true)
  })

  it('fails a prop check when the record does not exist at all', () => {
    // Rather than passing vacuously, which is how a deleted record would slip
    // through a benchmark that only looked at fields.
    const check: StateCheck = {
      kind: 'prop',
      type: 'application',
      where: { prop: 'org', contains: 'nowhere' },
      prop: 'stage',
      is: 'offer',
      why: '',
    }
    const out = checkState(check, nodes)
    expect(out.pass).toBe(false)
    expect(out.saw).toBe('no such record')
  })

  it('checks a keyword by name', () => {
    const check: StateCheck = {
      kind: 'tagged',
      type: 'application',
      where: { prop: 'org', contains: 'rice' },
      keyword: 'teaching',
      why: '',
    }
    expect(checkState(check, nodes).pass).toBe(true)
  })

  it('catches something that should not be there', () => {
    const check: StateCheck = {
      kind: 'absent',
      type: 'application',
      where: { prop: 'org', contains: 'stripe' },
      why: '',
    }
    expect(checkState(check, nodes).pass).toBe(false)
  })
})

describe('the suite itself', () => {
  it('has unique conversation ids, since the report keys on them', () => {
    expect(new Set(CONVERSATIONS.map((c) => c.id)).size).toBe(CONVERSATIONS.length)
  })

  it('gives every conversation at least one state check', () => {
    // A conversation scored only on tool choice is the thing this benchmark
    // exists to be better than.
    for (const c of CONVERSATIONS) {
      expect(c.finalState.length, c.id).toBeGreaterThan(0)
    }
  })

  it('covers every group it declares', () => {
    // Against `GROUPS` rather than a second list written here — a category with
    // no conversation in it would otherwise sit in the report showing 0/0 and
    // reading as a pass.
    expect([...new Set(CONVERSATIONS.map((c) => c.group))].sort()).toEqual([...GROUPS].sort())
  })

  it('gives every group a blurb, since the previewer prints one', () => {
    for (const group of GROUPS) {
      expect(GROUP_BLURB[group], group).toBeTruthy()
    }
  })

  it('has at least two conversations in every group', () => {
    // One conversation per category is an anecdote. The report shows a
    // per-category score, and a score out of one is not a score.
    for (const group of GROUPS) {
      expect(CONVERSATIONS.filter((c) => c.group === group).length, group).toBeGreaterThan(1)
    }
  })

  it('has more than one multi-turn conversation, or it is not multi-turn', () => {
    expect(CONVERSATIONS.filter((c) => c.turns.length > 1).length).toBeGreaterThan(5)
  })

  it('guards the irreversible pair in every conversation that writes', () => {
    /*
     * `memory.reset` and `memory.clear` are the only two operations a person
     * cannot undo. Every conversation where the model might write must forbid
     * them, or the suite has a hole exactly where the worst outcome lives.
     */
    for (const c of CONVERSATIONS) {
      const writes = c.turns.filter((t) => !t.readOnly)
      for (const turn of writes) {
        expect(turn.mustNotCall ?? [], `${c.id}: "${turn.say}"`).toContain('memory.reset')
      }
    }
  })

  it('rolls up into metrics that cannot exceed their denominators', () => {
    const scores = CONVERSATIONS.map((c) => ({
      conversation: c.id,
      group: c.group,
      turns: c.turns.map(() => ({ correct: true })),
      trajectory: { grounded: 1, writes: 1, lookedFirst: 1, refused: 0, calls: 2, repeats: 0 },
      state: c.finalState.map((check) => ({ check, pass: true, saw: '' })),
      clean: true,
    }))
    const out = summarise(scores)
    expect(out.turnsCorrect).toBe(out.turns)
    expect(out.grounded).toBeLessThanOrEqual(1)
    expect(out.refusalRate).toBe(0)
  })
})

describe('grounding accounts for polymorphic requirements too', () => {
  /**
   * A hole that existed for a while and is exactly the shape a metric bug takes:
   * it did not report an error, it reported a better number.
   *
   * When the polymorphic slots moved out of `NEEDS` into `NEEDS_ANY`, this
   * scorer kept reading only `NEEDS` — so `keyword.attach`, whose entire
   * difficulty is needing something to attach TO, counted as grounded whatever
   * came before it. The trajectory metric was most confident precisely where a
   * trajectory is least likely to be sound.
   */
  it('does not ground an attach that never looked anything up', () => {
    // `keyword.create` supplies the keyword; nothing supplies the record.
    const out = scoreTrajectory([
      call('keyword.create', 'create'),
      call('keyword.attach', 'update'),
    ])
    expect(out.writes).toBe(2)
    // The create is grounded (it is a root); the attach is not.
    expect(out.grounded).toBe(1)
  })

  it('grounds it once a read could have supplied the record', () => {
    const out = scoreTrajectory([
      read(),
      call('keyword.create', 'create'),
      call('keyword.attach', 'update'),
    ])
    expect(out.grounded).toBe(2)
  })

  it('still grounds a tool with neither kind of requirement', () => {
    expect(scoreTrajectory([call('application.create', 'create')]).grounded).toBe(1)
  })
})

describe('the conversations name only tools that exist', () => {
  /**
   * Twenty-five tool names are written out across the conversations, in
   * `mustCallOneOf` and `mustNotCall`, and nothing was checking them.
   *
   * The failure mode is the nasty kind. A renamed tool does not break the
   * benchmark — it makes every model fail the cases that mention it, and the
   * report says the models got worse. Somebody would go looking at models.
   *
   * The equivalent guard has existed for `eval-scenarios.ts` since it was
   * written; this file grew to twice the size without one.
   */
  const known = new Set(CATALOG.map((e) => e.name))

  it('finds the names, or the reflection has rotted', () => {
    const named = CONVERSATIONS.flatMap((c) =>
      c.turns.flatMap((t) => [...(t.mustCallOneOf ?? []), ...(t.mustNotCall ?? [])]),
    )
    expect(new Set(named).size).toBeGreaterThan(15)
  })

  it('names nothing the registry does not have', () => {
    const missing: string[] = []
    for (const conversation of CONVERSATIONS) {
      for (const turn of conversation.turns) {
        for (const name of [...(turn.mustCallOneOf ?? []), ...(turn.mustNotCall ?? [])]) {
          if (!known.has(name)) missing.push(`${conversation.id}: ${name}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('checks node types that exist too', () => {
    // A state check against a renamed node type passes vacuously on `count: 0`
    // and fails silently on everything else.
    const types = new Set(CATALOG.flatMap((e) => e.name.split('.')[0] ?? []))
    void types
    const seen = new Set(CONVERSATIONS.flatMap((c) => c.finalState.map((s) => s.type)))
    expect(seen.size).toBeGreaterThan(3)
    for (const type of seen) expect(NODE_TYPES).toContain(type)
  })
})

describe('what counts as going in circles', () => {
  const call = (name: string, args: string, effect = 'read') => ({
    turn: 0,
    name,
    effect,
    ok: true,
    args,
  })

  it('does not count two different searches as a repeat', () => {
    /*
     * This counted ADJACENT SAME-NAME calls, which is not what "repeat" means
     * to anybody reading the report. Gemma's first run showed 19 repeats out of
     * 84 calls, almost entirely from legitimate consecutive reads — a number
     * that reads as "the model went in circles nineteen times" and meant
     * nothing of the sort.
     */
    const out = scoreTrajectory([
      call('memory.search', '{"query":"rice"}'),
      call('memory.search', '{"query":"stripe"}'),
    ])
    expect(out.repeats).toBe(0)
  })

  it('counts the same call with the same arguments', () => {
    const out = scoreTrajectory([
      call('memory.search', '{"query":"rice"}'),
      call('memory.search', '{"query":"rice"}'),
    ])
    expect(out.repeats).toBe(1)
  })

  it('counts it wherever it happens, not only back to back', () => {
    // A model stuck in a loop interleaves: search, read, search again. Adjacency
    // was the wrong test for that too.
    const out = scoreTrajectory([
      call('memory.search', '{"query":"rice"}'),
      call('memory.overview', '{}'),
      call('memory.search', '{"query":"rice"}'),
    ])
    expect(out.repeats).toBe(1)
  })

  it('reads an older report that carries no arguments without throwing', () => {
    // Stored runs predate the field. A scorer that threw on one would make
    // every report already on disk unreadable.
    const out = scoreTrajectory([
      { turn: 0, name: 'memory.search', effect: 'read', ok: true },
      { turn: 0, name: 'memory.search', effect: 'read', ok: true },
    ])
    expect(out.repeats).toBe(1)
  })
})
