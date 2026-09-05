/**
 * The other direction through the published payload.
 *
 * The table reads six rows of totals. This reads one CONVERSATION across all
 * six, which is what a person who has picked a case wants — and it is only
 * meaningful if it lines up with the rubric it claims to be about.
 */

import { describe, expect, it } from 'vitest'
import { CONVERSATIONS } from '@jojo/service/agent/bench-conversations'
import report from '@/components/guide/tool-bench.json'
import {
  costText,
  noiseText,
  publishedConversations,
  rowTelemetry,
  runsFor,
  runsOf,
  stoppedText,
  stopsText,
  telemetryOf,
  type Payload,
} from '@/components/guide/bench-runs'

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

/* ------------------------- the runner's telemetry ------------------------- */

/**
 * A payload authored here rather than read from disk, because the published
 * one is a single pass with every field present and cannot show the absences
 * this layer exists to render honestly.
 */
type ScoreRun = {
  stoppedBy: string
  rounds: number
  verifyNudges: number
  stuckNudges: number
  compactions: number
  tokens: { prompt: number; completion: number }
}

const score = (conversation: string, clean: boolean, run?: ScoreRun) => ({
  conversation,
  clean,
  turns: [{ correct: clean }],
  state: [],
  ...(run === undefined ? {} : { run }),
})

const RUN = {
  stoppedBy: 'maxSteps',
  rounds: 8,
  verifyNudges: 1,
  stuckNudges: 2,
  compactions: 1,
  tokens: { prompt: 40_000, completion: 300 },
}

const FULL: Payload = {
  runs: 3,
  noise: {
    m: {
      full: { clean: { mean: 81.3, sd: 1.2 }, nodeF1: { mean: 0.76, sd: 0.01 }, unstable: ['flippy'] },
    },
  },
  report: [
    {
      model: 'm',
      label: 'M',
      condition: 'full',
      conversations: 2,
      cost: { rounds: { mean: 5.7 }, tokens: { prompt: 200_000 } },
      stops: { maxSteps: 1, stuck: 0 },
      scores: [score('flippy', false, RUN), score('steady', true, RUN)],
    },
  ],
}

const BARE: Payload = {
  report: [{ model: 'm', label: 'M', condition: 'full', scores: [score('flippy', true)] }],
}

describe('what a model row cost', () => {
  it('reads cost, noise and stops from a payload that carries them', () => {
    const t = telemetryOf(FULL, 'm', 'full')
    // Prompt tokens are published as a SUM over the row; the table wants the
    // per-conversation figure, so it is divided by the row's count and not by
    // anything else — a mutant that skips the division prints 200k.
    expect(t.cost).toEqual({ rounds: 5.7, promptPerConversation: 100_000 })
    expect(t.stops).toEqual({ maxSteps: 1, stuck: 0 })
    expect(t.noise).toEqual({
      runs: 3,
      clean: { mean: 81.3, sd: 1.2 },
      nodeF1: { mean: 0.76, sd: 0.01 },
      unstable: ['flippy'],
    })
  })

  it('says null, not zero, for every field a payload does not carry', () => {
    // The rule the whole layer turns on. A row published before `stops`
    // existed has not measured zero stops, and "0 capped" would be a finding.
    expect(telemetryOf(BARE, 'm', 'full')).toEqual({ cost: null, noise: null, stops: null })
    expect(telemetryOf(FULL, 'nobody', 'full')).toEqual({ cost: null, noise: null, stops: null })
  })

  it('has no noise on a single pass, even when the file carries a figure', () => {
    // A deviation over one value is not a measurement. `runs: 1` with a noise
    // block is what a runner writes when BENCH_RUNS defaulted; rendering the
    // mean with no band would assert stability from nothing.
    const once: Payload = { ...FULL, runs: 1 }
    expect(telemetryOf(once, 'm', 'full').noise).toBeNull()
    // And exactly two passes is the first band worth printing.
    expect(telemetryOf({ ...FULL, runs: 2 }, 'm', 'full').noise?.runs).toBe(2)
  })

  it('reads the noise from the row when the file put it there, spelled either way', () => {
    /*
     * The contract is top-level `noise[model][condition]` with `sd` and
     * `unstable`; the first publish.mjs wrote a row-level `noise` with
     * `stddev` and `flips.ids`. Both must render, so the guide is never one
     * rename behind the runner.
     */
    const rowLevel: Payload = {
      report: [
        {
          model: 'm',
          label: 'M',
          condition: 'full',
          scores: [score('flippy', false), score('steady', true)],
          noise: { runs: 4, clean: { mean: 80, stddev: 2 }, flips: { ids: ['flippy'] } },
        },
      ],
    }
    expect(telemetryOf(rowLevel, 'm', 'full').noise).toEqual({
      runs: 4,
      clean: { mean: 80, sd: 2 },
      nodeF1: null,
      unstable: ['flippy'],
    })
    // The top level wins when both exist — it is the one `publish.mjs` recounts
    // — on the figure AND on the pass count, and both differ here so that a
    // reader that fell through to the row would be caught on either.
    const both: Payload = {
      ...rowLevel,
      runs: 3,
      noise: { m: { full: { runs: 9, clean: { mean: 81.3, sd: 1.2 }, unstable: [] } } },
    }
    expect(telemetryOf(both, 'm', 'full').noise).toEqual({
      runs: 3,
      clean: { mean: 81.3, sd: 1.2 },
      nodeF1: null,
      unstable: [],
    })
  })

  it('has no noise when the scorer had nothing to spread', () => {
    // `spread([])` is `{ mean: null, stddev: null }` — every run withheld the
    // figure. That is an absence, not a band around nothing.
    const empty: Payload = { runs: 3, noise: { m: { full: { clean: { mean: null, sd: null } } } }, report: FULL.report }
    expect(telemetryOf(empty, 'm', 'full').noise).toBeNull()
  })

  it('divides the token sum by the row’s own count, not by however many scores it holds', () => {
    // A spliced row can carry fewer scores than `conversations` says; the sum
    // was taken over `conversations`, so that is the denominator.
    const spliced: Payload = {
      report: [{ ...FULL.report![0]!, conversations: 4, scores: [score('flippy', true)] }],
    }
    expect(telemetryOf(spliced, 'm', 'full').cost?.promptPerConversation).toBe(50_000)
    // And no count at all means no per-conversation figure.
    const uncounted: Payload = { report: [{ ...FULL.report![0]!, conversations: undefined }] }
    expect(telemetryOf(uncounted, 'm', 'full').cost).toBeNull()
  })

  it('treats a published null the way it treats an absence', () => {
    // `summarise` writes `null` for a metric no score carried; the file then
    // says `stops: null`, and that is "not measured", not a row to print.
    const nulled: Payload = {
      report: [{ ...FULL.report![0]!, cost: null, stops: null }],
    }
    expect(telemetryOf(nulled, 'm', 'full')).toMatchObject({ cost: null, stops: null })
    // Half a cost is no cost: rounds without a token sum cannot say tokens.
    const halved: Payload = { report: [{ ...FULL.report![0]!, cost: { rounds: { mean: 5 } } }] }
    expect(telemetryOf(halved, 'm', 'full').cost).toBeNull()
  })

  it('withholds the band, not the mean, when the scorer withheld the deviation', () => {
    const noSd: Payload = { runs: 2, noise: { m: { full: { clean: { mean: 81 } } } }, report: FULL.report }
    expect(telemetryOf(noSd, 'm', 'full').noise).toEqual({
      runs: 2,
      clean: { mean: 81, sd: null },
      nodeF1: null,
      unstable: [],
    })
  })

  it('agrees with the published rows about what they carry', () => {
    // Against the real file: every row on the page has a cost and a stops
    // figure, and the per-conversation prompt size is the row's sum divided by
    // its count. If a republish drops the telemetry this says so by name.
    const rows = (
      report as { report: { model: string; condition: string; conversations: number; cost: { tokens: { prompt: number } } }[] }
    ).report
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const t = rowTelemetry(row.model, row.condition)
      expect(t.cost?.promptPerConversation, `${row.model}/${row.condition}`).toBeCloseTo(
        row.cost.tokens.prompt / row.conversations,
        6,
      )
      expect(t.stops, `${row.model}/${row.condition}`).not.toBeNull()
    }
  })
})

describe('how the table says it', () => {
  it('prints an em dash for an absence and never a zero', () => {
    for (const text of [costText(null), noiseText(null), stopsText(null)]) {
      expect(text).toBe('—')
      expect(text).not.toMatch(/0/)
    }
  })

  it('prints a present zero as a zero', () => {
    // The other half of the rule: "0 capped · 0 stuck" is a finding about a
    // run that was watched, and collapsing it to "—" would hide the result.
    expect(stopsText({ maxSteps: 0, stuck: 0 })).toBe('0 capped · 0 stuck')
    expect(stopsText({ maxSteps: 3, stuck: 1 })).toBe('3 capped · 1 stuck')
  })

  it('rounds cost to what a reader can compare', () => {
    expect(costText({ rounds: 5.6938, promptPerConversation: 99_884 })).toBe('5.7 rounds · 100k tokens')
    // Below ten thousand the "k" would lose the digit that matters.
    expect(costText({ rounds: 4, promptPerConversation: 850.4 })).toBe('4.0 rounds · 850 tokens')
  })

  it('prints the band and the count of cases that made it wide', () => {
    expect(noiseText({ runs: 3, clean: { mean: 81.3, sd: 1.247 }, nodeF1: null, unstable: ['a', 'b'] })).toBe(
      '81.3 ± 1.2 · 2 unstable',
    )
    // No deviation: no "±", and not "± 0" either.
    expect(noiseText({ runs: 2, clean: { mean: 81, sd: null }, nodeF1: null, unstable: [] })).toBe(
      '81.0 · 0 unstable',
    )
  })

  it('names every way the loop can stop, and passes an unknown one through', () => {
    expect(stoppedText('answered')).toBe('answered')
    expect(stoppedText('maxSteps')).toBe('hit the step cap')
    expect(stoppedText('stuck')).toBe('stopped as stuck')
    expect(stoppedText('aborted')).toBe('aborted')
    expect(stoppedText('error')).toBe('errored')
    // A stop the loop grows later must not vanish into "answered".
    expect(stoppedText('timeout')).toBe('timeout')
  })
})

describe('what one case cost, per run', () => {
  it('carries the loop’s account of the run when the score has one', () => {
    const [run] = runsOf(FULL, 'flippy')
    expect(run?.run).toEqual({
      stoppedBy: 'maxSteps',
      rounds: 8,
      promptTokens: 40_000,
      completionTokens: 300,
      compactions: 1,
      verifyNudges: 1,
      stuckNudges: 2,
    })
  })

  it('says null for a score published before the loop reported anything', () => {
    expect(runsOf(BARE, 'flippy')[0]?.run).toBeNull()
  })

  it('marks a case unstable only when the noise names it, and unknown on one pass', () => {
    expect(runsOf(FULL, 'flippy')[0]?.unstable).toBe(true)
    expect(runsOf(FULL, 'steady')[0]?.unstable).toBe(false)
    // One pass cannot call a case stable — it can only say it passed this time.
    expect(runsOf({ ...FULL, runs: 1 }, 'steady')[0]?.unstable).toBeNull()
    expect(runsOf(BARE, 'flippy')[0]?.unstable).toBeNull()
  })

  it('carries a run block for every published score that has one', () => {
    // The real file: the runner wrote `run` on every score, so every entry
    // here must carry it — a mapping that dropped a field would show up as
    // "—" on a case that was measured.
    const runs = CONVERSATIONS.flatMap((c) => runsFor(c.id))
    expect(runs.length).toBeGreaterThan(0)
    for (const r of runs) {
      expect(r.run, `${r.model}/${r.condition}`).not.toBeNull()
      expect(r.run?.rounds).toBeGreaterThan(0)
      expect(r.run?.promptTokens).toBeGreaterThan(0)
    }
  })
})
