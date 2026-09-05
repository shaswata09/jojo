/**
 * `publish.mjs` recounts what `summarise` counts — proven on scores that carry
 * the runner's telemetry, before any published row does.
 *
 * `web/src/components/guide/bench-payload.test.ts` puts every PUBLISHED row
 * back through the real `summarise` and asserts the payload agrees. That is
 * the right check for what shipped, and it is vacuous for a roll-up no row on
 * disk carries yet: `stops`, `stuck`, `verify`, `compactions`, `cost` and
 * `injection` all read `run`, which no published score has. A drift in any of
 * them would have passed that test by looping over nothing, and been found by
 * the first person to publish a run.
 *
 * WHY IT IS HERE and not beside the payload test: `publish.mjs` is outside the
 * package's exports map, and `check-no-copies.mjs` refuses an app file that
 * reaches into the package by relative path — correctly, since that is how a
 * module arrives twice in a bundle. Inside the package the reach is one
 * directory over. Loaded by path at run time rather than statically because
 * the script has no types, and a `.d.ts` for it would be a third copy of the
 * shapes this file exists to keep at two.
 */

import { describe, expect, it } from 'vitest'
import { summarise, type ConversationScore, type RunTelemetry } from '../kg/agent/bench-score'

const publishPath = new URL('../bench/publish.mjs', import.meta.url).pathname
const loadPublish = async () =>
  (await import(publishPath)) as {
    recount: (row: Record<string, unknown>, scores: readonly ConversationScore[]) => Record<string, unknown>
  }

/** Every harness metric both sides compute. A metric added to one side fails here by name. */
const HARNESS_METRICS = ['repairs', 'faults', 'stops', 'stuck', 'verify', 'compactions', 'cost', 'injection'] as const

/*
 * Synthetic scores, built to exercise every branch the telemetry roll-ups
 * have: each stop reason, a stuck stop on a clean store and on a broken one,
 * nudges above and below the turns that wrote, a compaction, tokens reported
 * everywhere and then missing once, an injection attempted and refused, and a
 * score with no `run` at all sitting among them.
 */
const check = (pass: boolean) => ({ check: { kind: 'count' as const, type: 'application' as const, is: 0, why: '' }, pass, saw: '' })
const score = (
  conversation: string,
  over: Omit<Partial<ConversationScore>, 'run'> & { run?: Partial<RunTelemetry>; turnsWithWrite?: number },
): ConversationScore => {
  const { run, turnsWithWrite, ...rest } = over
  return {
    conversation,
    group: 'fetch',
    turns: [{ correct: true }],
    trajectory: { grounded: 0, writes: 0, lookedFirst: 0, refused: 0, calls: 0, repeats: 0, turnsWithWrite: turnsWithWrite ?? 0 },
    state: [check(true)],
    workflow: null,
    clean: true,
    ...(run === undefined
      ? {}
      : { run: { stoppedBy: 'answered', rounds: 1, verifyNudges: 0, stuckNudges: 0, compactions: 0, tokens: null, wallMs: 1, ...run } }),
    ...rest,
  }
}
const tokens = { prompt: 10, completion: 2 }
const measured: ConversationScore[] = [
  score('answered', { run: { rounds: 3, wallMs: 30, tokens, compactions: 1 } }),
  score('capped', { run: { stoppedBy: 'maxSteps', rounds: 8, wallMs: 80, tokens, verifyNudges: 2 }, turnsWithWrite: 1 }),
  score('stuck-clean', { run: { stoppedBy: 'stuck', stuckNudges: 2, tokens }, turns: [{ correct: false, failure: 'said-nothing' }], clean: false }),
  score('stuck-broken', { run: { stoppedBy: 'stuck', tokens }, state: [check(false)], clean: false }),
  score('aborted', { run: { stoppedBy: 'aborted', tokens, verifyNudges: 1 }, turnsWithWrite: 3 }),
  score('errored', { run: { stoppedBy: 'error', tokens, compactions: 2 } }),
]
const injecting = measured.map((s, i) => ({
  ...s,
  run: { ...s.run!, injection: { exposures: 1, attempted: i === 1 ? 1 : 0, landed: 0 } },
}))
const unmeasured = [score('old-a', {}), score('old-b', {})]

describe('the recount in publish.mjs, against the real summarise', () => {
  const cases: [string, ConversationScore[]][] = [
    ['telemetry on every score', measured],
    ['telemetry on none', unmeasured],
    ['mixed', [...measured, ...unmeasured]],
    ['tokens missing once', [...measured, score('no-usage', { run: { tokens: null } })]],
    ['injecting', injecting],
  ]

  for (const [name, scores] of cases) {
    it(`agrees on every harness metric: ${name}`, async () => {
      const { recount } = await loadPublish()
      const mine = summarise(scores)
      const theirs = recount({}, scores)
      for (const metric of HARNESS_METRICS) expect(theirs[metric], metric).toEqual(mine[metric])
    })
  }

  it('is checking something: the measured case has a value on every telemetry roll-up', () => {
    // Agreement on `null` everywhere would prove nothing. The measured case
    // must reach every branch, or a drift in one of them would pass unseen.
    const mine = summarise(measured)
    expect(mine.stops).toEqual({ answered: 1, maxSteps: 1, stuck: 2, aborted: 1, error: 1 })
    expect(mine.stuck).toEqual({ stopped: 2, stoppedButClean: 1, nudges: 2 })
    expect(mine.verify).toEqual({ nudges: 3, followedByWrite: 2 })
    expect(mine.compactions).toEqual({ conversations: 2, total: 3 })
    expect(mine.cost).toEqual({ rounds: { mean: 2.5, max: 8 }, tokens: { prompt: 60, completion: 12 }, wallMs: { mean: 19, max: 80 } })
    expect(summarise(injecting).injection).toEqual({ exposures: 6, attempted: 1, landed: 0, conversationsFollowed: 1 })
    expect(summarise([...measured, score('no-usage', { run: { tokens: null } })]).cost?.tokens).toBeNull()
    // And the unmeasured case is null on all of them, so "agrees on none" is agreeing on absence.
    const none = summarise(unmeasured)
    for (const metric of ['stops', 'stuck', 'verify', 'compactions', 'cost', 'injection'] as const) expect(none[metric], metric).toBeNull()
  })
})
