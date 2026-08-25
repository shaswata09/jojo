/**
 * The profile extraction, run against real model servers.
 *
 * INERT unless `JOJO_EXTRACT` is set — the same rule `live-eval.test.ts`
 * follows and for the same reason: it makes real HTTP calls to somebody's GPU,
 * takes minutes, and fails when a machine is off. A gate that depended on that
 * is a gate people learn to ignore.
 *
 *   JOJO_EXTRACT=1 npx vitest run test/live-extract --root service
 *   JOJO_EXTRACT=1 JOJO_EXTRACT_MODEL=qwen3_14b npx vitest run test/live-extract --root service
 *
 * ## What is being measured, and why recall is the headline
 *
 * The failure this pipeline was rebuilt to fix is OMISSION: a CV went in and a
 * third of it came out. So the primary number is recall against a ground truth
 * written down before any model was run — `extract-fixtures.ts` lists what a
 * careful human reader would file from each document.
 *
 * Precision is measured too, and separately, because it fails differently. It
 * is not "how many entries were spurious" — that would punish a model for
 * filing "Python" from a skills line, which is correct and merely
 * uninteresting. It is whether the specific wrong answers each document INVITES
 * came back: an intention read as an achievement in a statement, and the
 * employer's own qualifications in a cover letter. Those are the errors that
 * put a false claim in somebody's own records.
 *
 * ## The numbers move between runs, and that is a finding rather than noise
 *
 * These servers batch continuously, so temperature 0 does not make them
 * bit-deterministic: the same document can yield a different reading twice. A
 * single sample reported as "recall 50%" would be a claim the evidence does not
 * support. Run it more than once before concluding anything about a model, and
 * read a single low score as "look at this case", not as a measurement.
 *
 * ## Every model runs the real pipeline
 *
 * Not a single prompt. `cvPasses` sections the document, each section is asked
 * for everything in it, and `missedMessages` asks once more what was left out —
 * because that pipeline is what ships, and measuring one call would measure
 * something nobody runs.
 */

import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  cvMessages,
  cvPasses,
  mergeBackground,
  missedMessages,
  readCv,
} from '../kg/agent/read-cv'
import type { BackgroundDraft } from '../kg/agent/read-cv'
import type { ChatMessage } from '../kg/core/model-server'
import { documentKindOf } from '../kg/core/document-kind'
import { FIXTURES } from '../kg/agent/extract-fixtures'
import type { Expected, Fixture } from '../kg/agent/extract-fixtures'

const MODELS = [
  { id: 'gemma_4_31b', endpoint: 'http://10.116.34.124:8103/v1', label: 'Gemma 3 31B' },
  { id: 'qwen3_14b', endpoint: 'http://10.116.34.124:8109/v1', label: 'Qwen3 14B' },
  { id: 'gpt_oss_120b', endpoint: 'http://10.116.34.124:8116/v1', label: 'GPT-OSS 120B' },
]

type Model = (typeof MODELS)[number]

/** Everything one entry says, folded, for matching against the ground truth. */
const said = (b: BackgroundDraft): string =>
  [b.title, b.where ?? '', b.detail ?? '', ...(b.highlights ?? [])].join(' ').toLowerCase()

/**
 * Whether a reading found this expected entry.
 *
 * The kind has to match and the words have to appear SOMEWHERE in the entry —
 * not in the title alone. A model that files the OSDI paper with the venue in
 * `where` and one that puts it in `detail` have both found it, and a matcher
 * that insisted on the title would score the first as a miss.
 */
const found = (entries: readonly BackgroundDraft[], want: Expected): boolean =>
  entries.some((b) => b.kind === want.kind && said(b).includes(want.says))

/** Whether a reading filed something the document invited it to get wrong. */
const filed = (entries: readonly BackgroundDraft[], says: string): boolean =>
  entries.some((b) => said(b).includes(says))

async function ask(model: Model, messages: readonly ChatMessage[]) {
  const response = await fetch(`${model.endpoint}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model.id,
      messages,
      stream: false,
      /*
       * Generous, and it has to be: a correct reading of the CV fixture is
       * twenty-three JSON objects, and two of these three models reason before
       * answering. A budget that truncates the answer scores a thorough model
       * as a careless one — which is precisely the axis being measured.
       */
      max_tokens: 8192,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(600_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}: ${text.slice(0, 200)}`)
  const payload = JSON.parse(text) as { choices?: { message?: { content?: string } }[] }
  return payload.choices?.[0]?.message?.content ?? ''
}

/**
 * The shipped pipeline, with this model as the transport.
 *
 * `budget` exists so the CV can be run a second time cut small. The fixtures
 * are one or two pages and `CV_BUDGET` is 24k characters, so every document
 * here fits in a single pass — which means a run that used only the real budget
 * would report a number that says nothing about sectioning, packing or merging
 * across passes. Those are the parts this rebuild added, and a measurement that
 * skipped them would be measuring the old pipeline with a new prompt.
 */
async function extract(model: Model, fixture: Fixture, budget?: number) {
  const kind = documentKindOf(fixture.name, fixture.text)
  const passes = budget === undefined ? cvPasses(fixture.text) : cvPasses(fixture.text, budget)
  const rounds: BackgroundDraft[][] = []
  const notes: string[] = []

  for (const pass of passes) {
    try {
      const read = readCv(await ask(model, cvMessages(fixture.name, pass, kind)))
      if (read.ok) rounds.push([...read.background])
      else notes.push(`${pass.label}: ${read.reason}`)
    } catch (error) {
      notes.push(`${pass.label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const first = mergeBackground(rounds)
  const afterPasses = first.length

  if (first.length > 0) {
    try {
      const read = readCv(await ask(model, missedMessages(fixture.name, fixture.text, first, kind)))
      if (read.ok) rounds.push([...read.background])
    } catch {
      // The second look is an improvement, not a requirement. A failure here
      // leaves the first pass's answer, which is what the app does too.
    }
  }

  const entries = mergeBackground(rounds)
  return { kind, passes: passes.length, entries, afterPasses, notes }
}

const enabled = process.env['JOJO_EXTRACT'] === '1'
const wanted = process.env['JOJO_EXTRACT_MODEL']
const models = wanted ? MODELS.filter((m) => m.id === wanted) : MODELS

type Row = {
  model: string
  document: string
  kind: string
  passes: number
  expected: number
  recalled: number
  recall: number
  /** Entries after the section passes, before the second look. */
  afterPasses: number
  total: number
  missed: string[]
  wrongly: string[]
  notes: string[]
}

describe.runIf(enabled)('extracting a profile with real models', () => {
  const rows: Row[] = []

  /*
   * Each document once whole, and the CV a second time cut into small sections.
   * `SPLIT` is chosen to break the CV into several passes rather than for any
   * property of its own — what is being measured is whether the same entries
   * survive being asked for a section at a time and merged.
   */
  const SPLIT = 900
  const RUNS = [
    ...FIXTURES.map((fixture) => ({ fixture, budget: undefined, id: fixture.id })),
    ...FIXTURES.filter((f) => f.id === 'cv').map((fixture) => ({
      fixture,
      budget: SPLIT,
      id: 'cv (split into sections)',
    })),
  ]

  for (const model of models) {
    for (const { fixture, budget, id } of RUNS) {
      it(
        `${model.label} reads ${id}`,
        async () => {
          const out = await extract(model, fixture, budget)

          const missed = fixture.expect.filter((w) => !found(out.entries, w))
          const wrongly = fixture.forbidden.filter((f) => filed(out.entries, f.says))

          rows.push({
            model: model.label,
            document: id,
            kind: out.kind,
            passes: out.passes,
            expected: fixture.expect.length,
            recalled: fixture.expect.length - missed.length,
            recall: Math.round(
              ((fixture.expect.length - missed.length) / fixture.expect.length) * 100,
            ),
            afterPasses: out.afterPasses,
            total: out.entries.length,
            missed: missed.map((m) => m.label),
            wrongly: wrongly.map((w) => `${w.says} — ${w.why}`),
            notes: out.notes,
          })

          // The document has to be classified correctly or the rest of the
          // measurement is of the wrong prompt. This is jojo's own code and it
          // is deterministic, so it is an assertion rather than a score.
          expect(out.kind).toBe(fixture.id)

          // A model that returns nothing at all is broken rather than poor, and
          // the report should not have to be read to find that out.
          expect(out.entries.length).toBeGreaterThan(0)
        },
        900_000,
      )
    }
  }

  it('writes the report', () => {
    rows.sort((a, b) => a.model.localeCompare(b.model) || a.document.localeCompare(b.document))
    const path = 'extract-eval.json'
    writeFileSync(path, JSON.stringify({ rows }, null, 2))

    const line = (r: Row) =>
      `${r.model.padEnd(14)} ${r.document.padEnd(20)} recall ${String(r.recall).padStart(3)}%  ` +
      `(${String(r.recalled)}/${String(r.expected)})  passes ${String(r.passes)}  ` +
      `entries ${String(r.afterPasses)}→${String(r.total)}  ` +
      `wrong ${String(r.wrongly.length)}`
    // eslint-disable-next-line no-console
    console.log(['', ...rows.map(line), ''].join('\n'))
    for (const r of rows) {
      if (r.missed.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`${r.model} · ${r.document} missed: ${r.missed.join(', ')}`)
      }
      for (const w of r.wrongly) {
        // eslint-disable-next-line no-console
        console.log(`${r.model} · ${r.document} WRONGLY FILED ${w}`)
      }
      for (const n of r.notes) {
        // eslint-disable-next-line no-console
        console.log(`${r.model} · ${r.document} note: ${n}`)
      }
    }
    expect(rows.length).toBeGreaterThan(0)
  })
})
