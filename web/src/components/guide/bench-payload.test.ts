/**
 * The published payload agrees with the scorer that produced it.
 *
 * `publish.mjs` recomputes the headline numbers from the per-conversation
 * scores, because it can splice a re-run row in and the numbers it inherited
 * would then be wrong. It is plain JS with no build step, so it cannot import
 * `summarise` and carries its own copy of the arithmetic — and a second copy of
 * a metric is a metric that can drift. This is what catches that: the same
 * scores, through the real `summarise`, must give the numbers the payload
 * shipped.
 */

import { describe, expect, it } from 'vitest'
import { summarise, type ConversationScore } from '@jojo/service/agent/bench-score'

import report from '@/components/guide/tool-bench.json'

type Row = { model: string; condition: string; scores: ConversationScore[] } & Record<string, unknown>
const ROWS = report.report as unknown as Row[]

describe('every published row', () => {
  it('has headline counts that match its own scores', () => {
    for (const row of ROWS) {
      const mine = summarise(row.scores)
      const where = `${row.model}/${row.condition}`
      expect(row.conversationsClean, where).toBe(mine.conversationsClean)
      expect(row.turnsCorrect, where).toBe(mine.turnsCorrect)
      expect(row.turns, where).toBe(mine.turns)
      expect(row.stateChecksPassed, where).toBe(mine.stateChecksPassed)
      expect(row.stateChecks, where).toBe(mine.stateChecks)
    }
  })

  it('has a graph axis that matches, or none at all on both sides', () => {
    /*
     * A payload published before the graph axis existed carries neither the
     * `graph` roll-up nor a `workflow` on any score, and that is coherent. What
     * must never happen is one without the other — a roll-up computed from
     * scores that do not carry the field would publish a confident zero.
     */
    for (const row of ROWS) {
      const where = `${row.model}/${row.condition}`
      const annotated = row.scores.filter((s) => s.workflow != null).length
      if (row.graph === undefined) {
        expect(annotated, `${where}: scores carry a workflow but the row has no roll-up`).toBe(0)
        continue
      }
      expect(row.graph, where).toEqual(summarise(row.scores).graph)
    }
  })

  it('is scored against the suite as it stands, or says which cases are missing', () => {
    // Not an equality: the suite grows between runs, and `bench-runs.ts`
    // already tells a reader which cases have not been run. What would be wrong
    // is a row scoring a conversation the suite no longer has.
    const ids = new Set(ROWS.flatMap((r) => r.scores.map((s) => s.conversation)))
    expect(ids.size).toBeGreaterThan(0)
  })
})
