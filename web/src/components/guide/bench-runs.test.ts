/**
 * The other direction through the published payload.
 *
 * The table reads six rows of totals. This reads one CONVERSATION across all
 * six, which is what a person who has picked a case wants — and it is only
 * meaningful if it lines up with the rubric it claims to be about.
 */

import { describe, expect, it } from 'vitest'
import { CONVERSATIONS } from '@jojo/service/agent/bench-conversations'
import { publishedConversations, runsFor } from '@/components/guide/bench-runs'

describe('what the models did, per case', () => {
  const published = publishedConversations()

  it('has a run for the conversations the payload was measured on', () => {
    expect(published.size).toBeGreaterThan(0)
  })

  it('returns one entry per published row', () => {
    const [first] = [...published]
    // Three models by two conditions in the current payload; asserted as "more
    // than one" so adding a model does not fail a test about something else.
    expect(runsFor(first!).length).toBeGreaterThan(1)
  })

  it('lines its turns up with the rubric, or says it is measuring an older one', () => {
    /*
     * The failure this catches: a payload published before a conversation grew
     * a turn. The run would then report four turns for a five-turn case, and
     * the previewer would draw the fifth as though no model had reached it.
     *
     * It used to assert equality outright, and that was wrong in one direction:
     * a published payload is ALWAYS older than the suite, so an equality made
     * every added turn a red gate until somebody could re-run three models. The
     * two honest states are aligned, or marked `stale` and said out loud. What
     * must never happen is a misaligned run presented as an aligned one.
     */
    for (const c of CONVERSATIONS) {
      if (!published.has(c.id)) continue
      for (const run of runsFor(c.id)) {
        const where = `${c.id} / ${run.model} ${run.condition}`
        if (run.stale) {
          expect(
            run.turns.length !== c.turns.length || run.state.length !== c.finalState.length,
            `${where} is flagged stale but matches the rubric exactly`,
          ).toBe(true)
          continue
        }
        expect(run.turns.length, where).toBe(c.turns.length)
        expect(run.state.length, where).toBe(c.finalState.length)
      }
    }
  })

  it('flags a run as stale exactly when the rubric has moved under it', () => {
    // Guards the guard above: a `stale` that was always true would make the
    // equality unreachable and this file would assert nothing at all.
    const runs = CONVERSATIONS.flatMap((c) => runsFor(c.id))
    expect(runs.length).toBeGreaterThan(0)
    expect(runs.some((r) => !r.stale), 'every published run is stale — re-run the benchmark').toBe(
      true,
    )
  })

  it('says nothing rather than guessing for a case added since the publish', () => {
    // A conversation the payload has never seen is a real state — the previewer
    // says so instead of drawing an empty table that reads as total failure.
    expect(runsFor('a-case-that-does-not-exist')).toEqual([])
  })

  it('carries the failure reason when a turn went wrong', () => {
    const failures = CONVERSATIONS.flatMap((c) =>
      runsFor(c.id).flatMap((r) => r.turns.filter((t) => !t.correct)),
    )
    // Some run failed something, and every failure names its kind — otherwise
    // the detail view has a red mark and nothing to say about it.
    expect(failures.length).toBeGreaterThan(0)
    expect(failures.every((t) => typeof t.failure === 'string' && t.failure.length > 0)).toBe(true)
  })

  it('carries the reason a store check did not pass', () => {
    const missed = CONVERSATIONS.flatMap((c) => runsFor(c.id).flatMap((r) => r.state.filter((s) => !s.pass)))
    expect(missed.every((s) => s.why.length > 0)).toBe(true)
  })
})
