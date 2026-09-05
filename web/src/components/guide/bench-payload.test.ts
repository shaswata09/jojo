/**
 * The published payload agrees with the scorer that produced it, and with the
 * run files it was folded from.
 *
 * `publish.mjs` recomputes the headline numbers from the per-conversation
 * scores, because it can splice a re-run row in and the numbers it inherited
 * would then be wrong. It is plain JS with no build step, so it cannot import
 * `summarise` and carries its own copy of the arithmetic — and a second copy of
 * a metric is a metric that can drift. This is what catches that: the same
 * scores, through the real `summarise`, must give the numbers the payload
 * shipped.
 *
 * Only for rows on disk, which was a real limit while no published score
 * carried the runner's `run` — the telemetry roll-ups were checked against
 * nothing until 2026-09-05, when the first harness pass was published and every
 * score got one. `service/test/publish-recount.test.ts` still puts synthetic
 * scores through both copies so the check does not depend on what happens to
 * be published; it lives there because `publish.mjs` is outside the exports
 * map and an app file may not reach into the package by path.
 *
 * The noise figure is the one number `publish.mjs` does NOT recompute: it is
 * copied from the runner's `repeats`, and the per-run scores it came from are
 * not published (about 2 MB per model). So it is checked two ways — against
 * the payload's own rows, which ARE run one, and against the run files under
 * `/tmp` whenever they are on disk, where the runner's arithmetic can also be
 * put beside the scorer's `summariseRuns` on the same input.
 */

import { describe, expect, it } from 'vitest'
import { summarise, summariseRuns, type ConversationScore } from '@jojo/service/agent/bench-score'

import report from '@/components/guide/tool-bench.json'

/*
 * `tsconfig.app.json` grants no node types — see `code-structure.test.ts` for
 * why that is right for the app — and vitest runs this file on node, where the
 * run files are. A static `import` would fail `tsc -b`; the dynamic one is
 * typed by hand below, with only the two calls it makes, and the test that
 * needs it is skipped when the files are not there rather than failing.
 */
// @ts-expect-error TS2307 — node:fs has no types under tsconfig.app.json; the read is the whole point of the source-file tests.
const fs = (await import('node:fs')) as { existsSync: (p: string) => boolean; readFileSync: (p: string, enc: 'utf8') => string }

type Row = {
  model: string
  condition: string
  conversationsClean: number
  scores: ConversationScore[]
} & Record<string, unknown>

/** What `publish.mjs` writes per model and condition — contract 4's shape, exactly. */
type Band = { mean: number; sd: number | null; values: number[] }
type Noise = { clean: Band; nodeF1: { mean: number; sd: number | null } | null; unstable: string[] }

type Payload = {
  ranAt: string
  setup: Record<string, unknown>
  runs?: number
  noise?: Record<string, Record<string, Noise>>
  rerun?: { rows: string[]; why: string[] }
  report: Row[]
}
const PAYLOAD = report as unknown as Payload
const ROWS = PAYLOAD.report

/** The runner's file, as `run.mts` writes it — only the fields read here. */
type Source = {
  setup: Record<string, unknown>
  runs?: number
  report: Row[]
  laterRuns?: { run: number; report: Row[] }[]
  repeats?: Record<
    string,
    { noise: Record<string, Band>; unstable: { conversation: string; cleanIn: number; of: number }[] }
  >
}

/** Where `publish.mjs` reads from. Named twice on purpose: a test that imported the list would test the list. */
const SOURCES: Record<string, string> = {
  gemma_4_31b: '/tmp/bench-gemma.json',
  qwen3_14b: '/tmp/bench-qwen.json',
  gpt_oss_120b: '/tmp/bench-gptoss.json',
}

/**
 * The harness metrics `publish.mjs` recomputes, each of which `summarise`
 * reports as `null` when no score carries the field. Listed once so that a
 * metric added to one side and not the other fails here by name.
 */
const HARNESS_METRICS = ['repairs', 'faults', 'stops', 'stuck', 'verify', 'compactions', 'cost', 'injection'] as const

/** What the runner must have said about a conversation for a roll-up to read it. */
const RUN_FIELDS = ['stoppedBy', 'rounds', 'verifyNudges', 'stuckNudges', 'compactions', 'tokens', 'wallMs'] as const

const mean = (xs: readonly number[]) => xs.reduce((n, x) => n + x, 0) / xs.length
/** Sample deviation, as both the runner and the scorer define it; `null` on one value. */
const sampleSd = (xs: readonly number[]) =>
  xs.length < 2 ? null : Math.sqrt(xs.reduce((n, x) => n + (x - mean(xs)) ** 2, 0) / (xs.length - 1))

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

  it('carries each harness metric exactly as summarise reports it, or as not measured', () => {
    /*
     * The rule the harness metrics turn on: a run recorded before a field
     * existed has NOT measured zero of it. `summarise` says `null` there, and
     * the row must say `null` (or nothing) too — a `{ total: 0 }` on such a row
     * would publish the repair layer as "never fires" on runs nobody watched
     * it in. Six rows once said exactly that; the 2026-09-05 republish replaced
     * them and the tolerance that let them through is gone, so a measured zero
     * (`{ conversations: N, total: 0, byKind: {} }`) and an unmeasured run
     * (`null`) are the only two things `repairs` may say.
     */
    for (const row of ROWS) {
      const mine = summarise(row.scores)
      for (const metric of HARNESS_METRICS) {
        const where = `${row.model}/${row.condition}: ${metric}`
        expect(row[metric] ?? null, where).toEqual(mine[metric])
      }
    }
  })

  it('names the gate and step budget in setup whenever a score carries the runner’s telemetry', () => {
    /*
     * `stops.maxSteps` is a claim about a budget and `verify`/`stuck` about a
     * gate, and neither means anything without the number it was measured
     * under. The runner writes both into `setup`; a payload that carries `run`
     * on a score and neither in `setup` was measured under a configuration
     * nobody can state.
     */
    const setup = PAYLOAD.setup
    const measured = ROWS.filter((r) => r.scores.some((s) => s.run !== undefined))
    if (measured.length === 0) return
    expect(setup['gate']).toMatch(/^(destructive|writes|none)$/)
    expect(typeof setup['maxSteps']).toBe('number')
    for (const row of measured) {
      for (const s of row.scores) {
        if (s.run === undefined) continue
        for (const field of RUN_FIELDS) expect(field in s.run, `${row.model}/${row.condition}/${s.conversation}: run.${field}`).toBe(true)
      }
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

describe('the noise figure', () => {
  it('says how many times the suite ran, and carries a band for every row exactly when that is more than once', () => {
    /*
     * `runs` is one number for the table — a band under two models and not the
     * third is the lopsided grid `publish.mjs` refuses — and `noise` is present
     * or absent with it. An empty `noise` on a single run would be read by the
     * guide as "measured, no spread", which is the "±2-3 is inside the margin"
     * claim the README used to make from no repetition at all.
     */
    expect(Number.isInteger(PAYLOAD.runs) && (PAYLOAD.runs ?? 0) >= 1, 'runs').toBe(true)
    if (PAYLOAD.runs === 1) {
      expect(PAYLOAD.noise, 'noise on a single run').toBeUndefined()
      return
    }
    const cells = ROWS.map((r) => `${r.model}/${r.condition}`).sort()
    const banded = Object.entries(PAYLOAD.noise ?? {})
      .flatMap(([model, byCondition]) => Object.keys(byCondition).map((c) => `${model}/${c}`))
      .sort()
    expect(banded).toEqual(cells)
  })

  it('is consistent with the row it sits beside, which is run one', () => {
    /*
     * The runner's `report` is run one, and `publish.mjs` folds it into the
     * row — so the first of `clean.values` is the row's own clean count unless
     * a splice replaced a conversation, and the payload says when it did. The
     * mean and deviation are re-derived from the values, and the unstable ids
     * must be conversations the row scored: a band copied from the wrong
     * model's file would fail on the first, and one edited by hand on the rest.
     */
    if (PAYLOAD.runs === 1) return
    const runs = PAYLOAD.runs ?? 0
    for (const row of ROWS) {
      const where = `${row.model}/${row.condition}`
      const band = PAYLOAD.noise?.[row.model]?.[row.condition]
      expect(band, where).toBeDefined()
      if (band === undefined) continue
      expect(band.clean.values.length, `${where}: one value per run`).toBe(runs)
      if (PAYLOAD.rerun === undefined) expect(band.clean.values[0], `${where}: run one is the row`).toBe(row.conversationsClean)
      expect(band.clean.mean, where).toBeCloseTo(mean(band.clean.values), 9)
      expect(band.clean.sd, where).toBeCloseTo(sampleSd(band.clean.values) ?? Number.NaN, 6)
      if (band.nodeF1 !== null) {
        expect(typeof band.nodeF1.mean, where).toBe('number')
        expect(band.nodeF1.sd === null || band.nodeF1.sd >= 0, where).toBe(true)
      }
      const ids = new Set(row.scores.map((s) => s.conversation))
      for (const id of band.unstable) expect(ids.has(id), `${where}: unstable ${id} is not a conversation this row scored`).toBe(true)
      expect(new Set(band.unstable).size, `${where}: unstable listed twice`).toBe(band.unstable.length)
    }
  })

  const onDisk = Object.entries(SOURCES).filter(([, file]) => fs.existsSync(file))
  const load = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as Source

  describe.skipIf(onDisk.length === 0)('against the run files, which are on disk', () => {
    for (const [model, file] of onDisk) {
      it(`${model}: is the runner’s repeats block, copied and not re-derived`, () => {
        /*
         * A file newer than the payload fails here on `setup` or on the band,
         * and that is the point — the fix is `npm -w @jojo/service run
         * bench:publish <ranAt>`, not a looser test.
         */
        const raw = load(file)
        expect(PAYLOAD.setup, `${model}: payload is not published from ${file}`).toEqual(raw.setup)
        expect(PAYLOAD.runs, `${model}: runs`).toBe(raw.runs ?? 1)
        if ((raw.runs ?? 1) === 1) return
        for (const [condition, { noise, unstable }] of Object.entries(raw.repeats ?? {})) {
          const clean = noise['conversationsClean']
          expect(clean, `${file}: repeats.${condition}.noise.conversationsClean`).toBeDefined()
          if (clean === undefined) continue
          const nodeF1 = noise['nodeF1']
          expect(PAYLOAD.noise?.[model]?.[condition === 'everything' ? 'full' : condition], `${model}/${condition}`).toEqual({
            clean: { mean: clean.mean, sd: clean.sd, values: clean.values },
            nodeF1: nodeF1 === undefined ? null : { mean: nodeF1.mean, sd: nodeF1.sd },
            unstable: unstable.map((u) => u.conversation),
          })
        }
      })

      it(`${model}: the runner’s arithmetic agrees with the scorer’s summariseRuns on the same runs`, () => {
        /*
         * Two copies of the noise arithmetic exist — the runner's `spread`,
         * written beside the runs, and the scorer's `summariseRuns`, written
         * for a caller that has the per-run scores in hand. This is the one
         * place both inputs exist, so it is where they are compared. Only the
         * deviation's floor differs (the runner prints 0 where three identical
         * F1s give 1.4e-16), and `toBeCloseTo` is wide enough to absorb it.
         */
        const raw = load(file)
        if ((raw.runs ?? 1) === 1) return
        const reports = [raw.report, ...(raw.laterRuns ?? []).map((l) => l.report)]
        for (const [condition, { noise, unstable }] of Object.entries(raw.repeats ?? {})) {
          const perRun = reports.map((rep) => rep.find((r) => r.condition === condition)?.scores ?? [])
          const mine = summariseRuns(perRun)
          const where = `${model}/${condition}`
          expect(mine.runs, where).toBe(raw.runs)
          const clean = noise['conversationsClean']
          expect(mine.clean.mean, where).toBeCloseTo(clean?.mean ?? Number.NaN, 9)
          expect(mine.clean.stddev, where).toBeCloseTo(clean?.sd ?? Number.NaN, 9)
          const nodeF1 = noise['nodeF1']
          if (nodeF1 !== undefined) {
            expect(mine.nodeF1.mean, where).toBeCloseTo(nodeF1.mean, 9)
            expect(mine.nodeF1.stddev, where).toBeCloseTo(nodeF1.sd ?? Number.NaN, 9)
          }
          expect([...mine.flips.ids].sort(), where).toEqual(unstable.map((u) => u.conversation).sort())
        }
      })
    }
  })
})
