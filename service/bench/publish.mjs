/*
 * The three run files, folded into the payload the in-app guide reads.
 *
 * The guide publishes these numbers to the person choosing a model, so it
 * carries the date and the full per-conversation detail rather than the
 * headline alone — a summary nobody can drill into is a summary nobody should
 * believe.
 *
 * The arithmetic (`recount` and what it calls) is exported and the file only
 * publishes when it is the script being run, so that
 * `web/src/components/guide/bench-payload.test.ts` can put synthetic scores
 * through both this and the real `summarise` and prove they agree BEFORE a
 * run exists to publish. The first version could only be checked against
 * rows already on disk, and none of those carried the runner's telemetry, so
 * every new roll-up would have been "tested" by a loop over nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const LABEL = {
  gemma_4_31b: 'Gemma 4 31B',
  qwen3_14b: 'Qwen3 14B',
  gpt_oss_120b: 'GPT-OSS 120B',
}

/*
 * A conversation re-run after the code changed under a run in flight.
 *
 * A full three-model pass takes hours, and a fix landing halfway through leaves
 * the rest of the run describing code that no longer exists. Re-running the one
 * affected conversation is sound — each gets a fresh world and a fresh history,
 * so it is independent of the others by construction — and it is spliced here
 * rather than edited into the file by hand so that WHICH rows were replaced is
 * a fact in the output instead of something only this commit message knows.
 *
 * Every patch names its conversation and its reason, both of which are written
 * into the published payload.
 */
/*
 * EMPTY, and that is the finished state rather than an unused feature.
 *
 * The one entry that lived here spliced a re-run of `stripe-offer` after
 * `application.offer.decide`'s refusal was rewritten mid-run. Every model has
 * since been re-measured end to end on code that includes the rewrite, so the
 * splice would now replace fresh rows with older ones — the exact mixing this
 * mechanism exists to make visible.
 *
 * Leave it empty unless a run is genuinely interrupted by a fix again. Each
 * entry names its conversation and its reason, and both are written into the
 * published payload.
 */
const PATCHES = []

const patched = []

const applyPatches = (model, row) => {
  let scores = row.scores
  for (const patch of PATCHES) {
    let source
    try {
      source = JSON.parse(readFileSync(patch.file(model), 'utf8'))
    } catch {
      continue
    }
    const fresh = source.report
      .find((r) => r.condition === row.condition)
      ?.scores.find((s) => s.conversation === patch.conversation)
    if (!fresh) continue
    scores = scores.map((s) => (s.conversation === patch.conversation ? fresh : s))
    patched.push(`${model}/${row.condition}/${patch.conversation}`)
  }
  return scores
}

/**
 * The graph axis, recomputed from `scores`.
 *
 * Duplicated from `summarise` rather than imported because this script is plain
 * JS run by node with no build step. The duplication is deliberate and narrow —
 * a mean and a ratio — and `web/src/components/guide/bench-payload.test.ts`
 * puts every published row back through the real `summarise` and asserts they
 * agree, so a drift between the two fails a test instead of quietly publishing
 * a different metric than the runner measured.
 */
export const regraph = (scores) => {
  const scored = scores.map((s) => s.workflow).filter((w) => w != null)
  const mean = (pick) => (scored.length === 0 ? null : scored.reduce((n, w) => n + pick(w), 0) / scored.length)
  const checked = scored.reduce((n, w) => n + w.args.checked, 0)
  const matched = scored.reduce((n, w) => n + w.args.matched, 0)
  return {
    conversations: scored.length,
    nodeF1: mean((w) => w.nodes.f1),
    nodePrecision: mean((w) => w.nodes.precision),
    nodeRecall: mean((w) => w.nodes.recall),
    linkF1: mean((w) => w.links.f1),
    argAccuracy: checked === 0 ? null : matched / checked,
    argsChecked: checked,
    edgesAdjudicable: scored.reduce((n, w) => n + (w.edges?.adjudicable ?? 0), 0),
    edges: scored.reduce((n, w) => n + (w.edges?.of ?? 0), 0),
  }
}

/**
 * The harness metrics, recomputed from `scores` the way `summarise` does it.
 *
 * Each is `null` when NO conversation carries the field — a run recorded before
 * the field existed has not measured zero of anything. The first version of
 * `repairs` here reported `{ total: 0 }` on exactly such runs; the 2026-09-05
 * republish replaced those six rows, and the payload test no longer tolerates
 * that shape. The other direction is the runner's job: a measured run in which
 * the layer fired nothing has `repairKinds: []` on every conversation and rolls
 * up to `{ conversations: N, total: 0, byKind: {} }` here, never to null.
 */
const rerepairs = (scores) => {
  const measured = scores.filter((s) => s.trajectory?.repairKinds !== undefined)
  if (measured.length === 0) return null
  const all = measured.flatMap((s) => s.trajectory.repairKinds)
  const byKind = {}
  for (const k of all) byKind[k] = (byKind[k] ?? 0) + 1
  return { conversations: measured.length, total: all.length, byKind }
}

const refaults = (scores) => {
  const measured = scores.flatMap((s) => (s.trajectory?.faults === undefined ? [] : [s.trajectory.faults]))
  if (measured.length === 0) return null
  const total = (pick) => measured.reduce((n, f) => n + pick(f), 0)
  const repaired = total((f) => f.repaired)
  const refused = total((f) => f.refused)
  return {
    conversations: measured.length,
    injected: total((f) => f.injected),
    repaired,
    refused,
    absorbed: total((f) => f.absorbed),
    repairRate: repaired + refused === 0 ? null : repaired / (repaired + refused),
  }
}

/*
 * The runner's telemetry, rolled up the way `summarise` does it: over the
 * scores that carry `run`, and `null` on every roll-up when none does. A score
 * without `run` is not zero of anything, and each function below keeps that
 * apart on its own rather than trusting a caller to.
 */
const measuredOf = (scores) => scores.filter((s) => s.run !== undefined)

const restops = (scores) => {
  const measured = measuredOf(scores)
  if (measured.length === 0) return null
  const stops = { answered: 0, maxSteps: 0, stuck: 0, aborted: 0, error: 0 }
  for (const s of measured) stops[s.run.stoppedBy] += 1
  return stops
}

const restuck = (scores) => {
  const measured = measuredOf(scores)
  if (measured.length === 0) return null
  const stopped = measured.filter((s) => s.run.stoppedBy === 'stuck')
  return {
    stopped: stopped.length,
    // The state axis, not `clean` — see `summarise`: the cut-off itself marks
    // a turn wrong, so a detector scored on `clean` could never be shown wrong.
    stoppedButClean: stopped.filter((s) => s.state.every((c) => c.pass)).length,
    nudges: measured.reduce((n, s) => n + s.run.stuckNudges, 0),
  }
}

const reverify = (scores) => {
  const measured = measuredOf(scores)
  if (measured.length === 0) return null
  return {
    nudges: measured.reduce((n, s) => n + s.run.verifyNudges, 0),
    // A bound, not a count: one nudge per turn, and a turn that never wrote
    // cannot have written after it. `summarise` says the rest.
    followedByWrite: measured.reduce((n, s) => n + Math.min(s.run.verifyNudges, s.trajectory.turnsWithWrite), 0),
  }
}

const recompactions = (scores) => {
  const measured = measuredOf(scores)
  if (measured.length === 0) return null
  return {
    conversations: measured.filter((s) => s.run.compactions > 0).length,
    total: measured.reduce((n, s) => n + s.run.compactions, 0),
  }
}

const meanMax = (xs) => ({ mean: xs.reduce((n, x) => n + x, 0) / xs.length, max: Math.max(...xs) })

const recost = (scores) => {
  const measured = measuredOf(scores)
  if (measured.length === 0) return null
  const reported = measured.map((s) => s.run.tokens).filter((t) => t !== null)
  return {
    rounds: meanMax(measured.map((s) => s.run.rounds)),
    // Every conversation or none: a total with gaps in it is a subtotal.
    tokens:
      reported.length === measured.length
        ? reported.reduce(
            (acc, t) => ({ prompt: acc.prompt + t.prompt, completion: acc.completion + t.completion }),
            { prompt: 0, completion: 0 },
          )
        : null,
    wallMs: meanMax(measured.map((s) => s.run.wallMs)),
  }
}

const reinjection = (scores) => {
  const injected = measuredOf(scores).flatMap((s) => (s.run.injection === undefined ? [] : [s.run.injection]))
  if (injected.length === 0) return null
  const total = (pick) => injected.reduce((n, i) => n + pick(i), 0)
  return {
    exposures: total((i) => i.exposures),
    attempted: total((i) => i.attempted),
    landed: total((i) => i.landed),
    conversationsFollowed: injected.filter((i) => i.attempted > 0).length,
  }
}

/**
 * The runner's `repeats` block, cut down to what the guide shows.
 *
 * Under `BENCH_RUNS>1` the runner writes, per condition, the spread of every
 * headline number and the conversations that were clean in some runs and not
 * others. The guide shows two of those numbers — `clean`, with its values so a
 * reader sees the band and not only its width, and `nodeF1` — and the unstable
 * cases by id. NOT recomputed here, unlike every roll-up above: the arithmetic
 * lives in the runner beside the runs it was computed from, and `laterRuns`
 * (about 2 MB per model) is not published, so a recount here would have
 * nothing to recount from. The payload test checks the published figure
 * against the source files instead, whenever they are on disk, and puts the
 * per-run scores in those files through the scorer's own `summariseRuns` so
 * the two copies of the arithmetic are compared where both inputs exist.
 *
 * `nodeF1` is `null` when the runner left it out — it drops a metric that was
 * null in any run — and the guide renders that as "—", not as zero.
 */
export const renoise = (repeats) =>
  Object.fromEntries(
    Object.entries(repeats).map(([condition, { noise, unstable }]) => {
      const clean = noise.conversationsClean
      if (clean === undefined) throw new Error(`\`repeats.${condition}\` carries no conversationsClean — not a runner file`)
      return [
        // Older runs called it `everything`; the guide has always said `full`.
        condition === 'everything' ? 'full' : condition,
        {
          clean: { mean: clean.mean, sd: clean.sd, values: clean.values },
          nodeF1: noise.nodeF1 === undefined ? null : { mean: noise.nodeF1.mean, sd: noise.nodeF1.sd },
          unstable: unstable.map((u) => u.conversation),
        },
      ]
    }),
  )

/** The headline counts, recomputed from whatever `scores` ended up being. */
export const recount = (row, scores) => ({
  ...row,
  scores,
  conversationsClean: scores.filter((s) => s.clean).length,
  turnsCorrect: scores.flatMap((s) => s.turns).filter((t) => t.correct).length,
  turns: scores.flatMap((s) => s.turns).length,
  stateChecksPassed: scores.flatMap((s) => s.state).filter((c) => c.pass).length,
  stateChecks: scores.flatMap((s) => s.state).length,
  graph: regraph(scores),
  /*
   * Recomputed like the rest, and for the same reason: a spliced re-run row
   * carries its own repairs, and inheriting the pre-splice count would report
   * the layer firing on work that was thrown away. Same for every harness
   * metric below it — and the telemetry roll-ups OVERWRITE anything the runner
   * wrote under the same key, so the published number is always the scorer's
   * definition and never a runner-side tally with a different shape.
   */
  repairs: rerepairs(scores),
  faults: refaults(scores),
  stops: restops(scores),
  stuck: restuck(scores),
  verify: reverify(scores),
  compactions: recompactions(scores),
  cost: recost(scores),
  injection: reinjection(scores),
  /*
   * No noise here. It is a fact about the FILE — the runner's `repeats`, one
   * per model — and not about a row, and a splice does not touch it: the
   * figure is a claim about repetition on one build, and a re-run on a later
   * build does not belong in it.
   */
})

const publish = () => {
  const ranAt = process.argv[2]
  if (!ranAt) throw new Error('pass the run timestamp as ISO-8601 — the clock is not read here (D26)')

  /*
   * The setup every row must agree on.
   *
   * A model's score and the configuration it was measured under are one fact,
   * and publishing them apart is how three models measured under three
   * different setups end up in one grid looking comparable. The runner writes
   * `setup`; this refuses to build a payload unless all three match, and
   * refuses a file that predates the field rather than guessing what it was.
   */
  let setup = null
  const describeSetup = (s) =>
    `${s.harness ? `harness, window ${s.window}` : 'no harness'}, reserve ${s.reserve ?? 'unrecorded'}`

  /*
   * `runs` is one number for the table, like `setup`, and for the same reason:
   * the runner keeps it out of `setup` because repeating a measurement does not
   * change what was measured, but a noise band shown under two models and not
   * the third is the lopsided grid the setup check exists to refuse. A file
   * from before `runs` existed ran the suite once.
   */
  let runs = null
  const noise = {}

  const report = []
  for (const [model, file] of Object.entries({
    gemma_4_31b: '/tmp/bench-gemma.json',
    qwen3_14b: '/tmp/bench-qwen.json',
    gpt_oss_120b: '/tmp/bench-gptoss.json',
  })) {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (!raw.setup) {
      throw new Error(
        `${file} carries no \`setup\` — it predates the field, so what it measured is unknown. Re-run it rather than publishing a number whose configuration nobody can state.`,
      )
    }
    if (setup === null) setup = raw.setup
    else if (JSON.stringify(setup) !== JSON.stringify(raw.setup)) {
      throw new Error(
        `${file} was measured under a different setup (${describeSetup(raw.setup)}) than the runs before it (${describeSetup(setup)}). One table, one configuration — re-run the odd one out.`,
      )
    }
    const ran = raw.runs ?? 1
    if (runs === null) runs = ran
    else if (ran !== runs) {
      throw new Error(
        `${file} ran the suite ${ran} time(s) where the runs before it ran it ${runs} — a noise band under some models and not others is not one table. Re-run the odd one out with BENCH_RUNS=${runs}.`,
      )
    }
    if (ran > 1) {
      if (!raw.repeats) throw new Error(`${file} ran the suite ${ran} times and carries no \`repeats\` — it predates the field. Re-run it.`)
      noise[model] = renoise(raw.repeats)
    }
    for (const row of raw.report) {
      // Older runs called it `everything`; the guide has always said `full`.
      const condition = row.condition === 'everything' ? 'full' : row.condition
      const scores = applyPatches(model, row)
      report.push({ model, label: LABEL[model], ...recount(row, scores), condition })
    }
  }

  const out = 'web/src/components/guide/tool-bench.json'
  writeFileSync(
    `../${out}`,
    `${JSON.stringify(
      {
        ranAt,
        setup,
        runs,
        ...(runs > 1 ? { noise } : {}),
        ...(patched.length > 0 ? { rerun: { rows: patched, why: PATCHES.map((p) => p.why) } } : {}),
        report,
      },
      null,
      2,
    )}\n`,
  )
  if (patched.length > 0) console.log(`spliced ${patched.length} re-run row(s): ${patched.join(', ')}`)
  console.log(
    `${out}: ${report.length} rows, ${report.map((r) => `${r.label}/${r.condition} ${r.conversationsClean}/${r.conversations}`).join('  ')}`,
  )
  if (runs > 1) {
    const band = (b) => `${b.clean.mean}±${b.clean.sd === null ? '—' : b.clean.sd.toFixed(2)} [${b.clean.values.join(',')}] ${b.unstable.length} unstable`
    console.log(
      `noise over ${runs} runs: ${Object.entries(noise)
        .map(([model, byCondition]) => `${LABEL[model]} ${Object.entries(byCondition).map(([c, b]) => `${c} ${band(b)}`).join(' / ')}`)
        .join('  |  ')}`,
    )
  }
}

// Only when run as `node bench/publish.mjs …` — imported by the payload test, it publishes nothing.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) publish()
