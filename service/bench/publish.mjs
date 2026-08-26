/*
 * The three run files, folded into the payload the in-app guide reads.
 *
 * The guide publishes these numbers to the person choosing a model, so it
 * carries the date and the full per-conversation detail rather than the
 * headline alone — a summary nobody can drill into is a summary nobody should
 * believe.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const LABEL = {
  gemma_4_31b: 'Gemma 3 31B',
  qwen3_14b: 'Qwen3 14B',
  gpt_oss_120b: 'GPT-OSS 120B',
}

const ranAt = process.argv[2]
if (!ranAt) throw new Error('pass the run timestamp as ISO-8601 — the clock is not read here (D26)')

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

/** The headline counts, recomputed from whatever `scores` ended up being. */
const recount = (row, scores) => ({
  ...row,
  scores,
  conversationsClean: scores.filter((s) => s.clean).length,
  turnsCorrect: scores.flatMap((s) => s.turns).filter((t) => t.correct).length,
  turns: scores.flatMap((s) => s.turns).length,
  stateChecksPassed: scores.flatMap((s) => s.state).filter((c) => c.pass).length,
  stateChecks: scores.flatMap((s) => s.state).length,
})

/*
 * The setup every row must agree on.
 *
 * A model's score and the configuration it was measured under are one fact, and
 * publishing them apart is how three models measured under three different
 * setups end up in one grid looking comparable. The runner writes `setup`; this
 * refuses to build a payload unless all three match, and refuses a file that
 * predates the field rather than guessing what it was.
 */
let setup = null
const describeSetup = (s) =>
  `${s.harness ? `harness, window ${s.window}` : 'no harness'}, reserve ${s.reserve ?? 'unrecorded'}`

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
  `${JSON.stringify({ ranAt, setup, ...(patched.length > 0 ? { rerun: { rows: patched, why: PATCHES.map((p) => p.why) } } : {}), report }, null, 2)}\n`,
)
if (patched.length > 0) console.log(`spliced ${patched.length} re-run row(s): ${patched.join(', ')}`)
console.log(
  `${out}: ${report.length} rows, ${report.map((r) => `${r.label}/${r.condition} ${r.conversationsClean}/${r.conversations}`).join('  ')}`,
)
