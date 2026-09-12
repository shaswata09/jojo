/**
 * Documents to a verdict, against real model servers.
 *
 * INERT unless `JOJO_FIT` is set, for the reasons `live-extract.test.ts`
 * gives: it spends minutes on somebody's GPU and fails when a machine is off.
 *
 *   JOJO_FIT=1 npx vitest run test/live-fit --root service
 *   JOJO_FIT=1 JOJO_FIT_MODEL=gemma_4_31b JOJO_FIT_REPORT=fit-gemma.json npx vitest run test/live-fit --root service
 *
 * ## What this measures that `live-extract` does not
 *
 * That file asks whether a model reads a document completely. This one asks
 * whether the whole chain says something TRUE: two people in different fields,
 * three postings, and the claim that the AI researcher is at least worth
 * tailoring for the AI post while the systems researcher is not strong for it.
 * A chain can have perfect recall at every step and still produce a verdict
 * nobody should act on — the join is where that shows.
 *
 * ## Every step is the shipped one
 *
 * The extraction mirrors `react/use-read-cv.ts` pass for pass, including when
 * the second look runs; the requirements read mirrors `react/use-read-fit.ts`;
 * the transport is `chatRequest` → `sendTurn` → `readTurnFor`, the chain the
 * app sends through, with thinking off and temperature 0 as the benchmark
 * runs it. Measuring a hand-built prompt would measure something nobody runs.
 *
 * ## What is asserted, and what is only reported
 *
 * The fit expectations in `fit-fixtures.ts` are asserted — they are the point.
 * Recall and precision per document and per posting are reported in the JSON
 * and printed, not asserted, because they move between runs on these servers
 * and a single low number means "look at this case", not "this is broken".
 */

import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THINKING,
  chatRequest,
  guardTruncation,
  readTurnFor,
  sendTurn,
  unreachable,
  type ChatMessage,
  type ModelRequest,
  type ModelResponse,
  type Turn,
} from '../kg/core/model-server'
import type { ModelSettings } from '../kg/core/provider'
import { cvMessages, cvPasses, mergeBackground, missedMessages, readCv } from '../kg/agent/read-cv'
import type { BackgroundDraft } from '../kg/agent/read-cv'
import { readRequirements, requirementMessages } from '../kg/agent/read-requirements'
import { documentKindOf } from '../kg/core/document-kind'
import { assess } from '../kg/core/assess'
import type { Evidence, Requirement } from '../kg/core/assess'
import { guidanceFrom } from '../kg/core/tailor'
import { FIXTURES as AMARA } from '../kg/agent/extract-fixtures'
import type { Expected, Fixture } from '../kg/agent/extract-fixtures'
import { EXPECTED_FIT, POSTINGS, PRIYA } from '../kg/agent/fit-fixtures'
import type { PostingFixture } from '../kg/agent/fit-fixtures'

const MODELS = [
  { id: 'gemma_4_31b', endpoint: 'http://10.116.34.124:8103/v1', label: 'Gemma 4 31B' },
  { id: 'qwen3_14b', endpoint: 'http://10.116.34.124:8109/v1', label: 'Qwen3 14B' },
  { id: 'gpt_oss_120b', endpoint: 'http://10.116.34.124:8116/v1', label: 'GPT-OSS 120B' },
]
type Model = (typeof MODELS)[number]

const PEOPLE: readonly { id: 'priya' | 'amara'; label: string; docs: readonly Fixture[] }[] = [
  { id: 'priya', label: 'Priya (AI/ML)', docs: PRIYA },
  { id: 'amara', label: 'Amara (systems)', docs: AMARA },
]

/* ------------------------------ transport --------------------------------- */

/**
 * The app's request, without streaming, retried the way the benchmark retries.
 *
 * 5xx twice, network failure twice; anything else is the answer. Timeout is
 * generous because a correct reading of a CV is thirty JSON objects and the
 * larger model reasons before answering.
 */
async function send(url: string, request: ModelRequest): Promise<ModelResponse | { failed: Turn }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: AbortSignal.timeout(600_000),
      })
      const text = await res.text()
      if (res.status >= 500 && attempt < 2) continue
      return { ok: res.ok, status: res.status, text, retryAfter: res.headers.get('retry-after') }
    } catch (e) {
      if (attempt < 2) continue
      return {
        failed: unreachable(url, String(e), e instanceof Error && e.name === 'TimeoutError'),
      }
    }
  }
}

function turnFor(model: Model): (messages: readonly ChatMessage[]) => Promise<Turn> {
  const settings: ModelSettings = {
    provider: 'openai-compatible',
    endpoint: model.endpoint,
    model: model.id,
  }
  return (messages) =>
    sendTurn(
      async ({ thinking }) => {
        const request = chatRequest(settings, messages, [], false, { thinking })
        const body = JSON.stringify({
          ...(JSON.parse(request.body ?? '{}') as Record<string, unknown>),
          temperature: 0,
        })
        const response = await send(model.endpoint, { ...request, body })
        if ('failed' in response) return response.failed
        return guardTruncation(body, readTurnFor(settings, response))
      },
      {
        delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        thinking: DEFAULT_THINKING,
        provider: settings.provider,
      },
    )
}

/* ------------------------------ extraction -------------------------------- */

const said = (b: BackgroundDraft): string =>
  [b.title, b.where ?? '', b.detail ?? '', ...(b.highlights ?? [])].join(' ').toLowerCase()
const found = (entries: readonly BackgroundDraft[], want: Expected): boolean =>
  entries.some((b) => b.kind === want.kind && said(b).includes(want.says))
const filed = (entries: readonly BackgroundDraft[], says: string): boolean =>
  entries.some((b) => said(b).includes(says))

type DocRow = {
  model: string
  person: string
  document: string
  kind: string
  passes: number
  expected: number
  recalled: number
  recall: number
  total: number
  missed: string[]
  wrongly: string[]
  notes: string[]
}

/** `use-read-cv.ts`, step for step, with this model as the transport. */
async function readDocument(turn: ReturnType<typeof turnFor>, doc: Fixture) {
  const kind = documentKindOf(doc.name, doc.text)
  const passes = cvPasses(doc.text).slice(0, 8)
  const found: BackgroundDraft[][] = []
  const notes: string[] = []

  for (const pass of passes) {
    const reply = await turn(cvMessages(doc.name, pass, kind))
    if (!reply.ok) {
      notes.push(`${pass.label}: ${reply.reason}`)
      continue
    }
    if (reply.text === null || reply.text.trim() === '') {
      notes.push(`${pass.label}: nothing at all`)
      continue
    }
    const read = readCv(reply.text)
    if (!read.ok) {
      notes.push(`${pass.label}: ${read.reason}`)
      continue
    }
    found.push([...read.background])
    notes.push(...read.skipped.map((s) => `${pass.label}: ${s}`))
  }

  const merged = mergeBackground(found)
  // The app's rule: a second look only when there was more than one pass or
  // something was skipped. See `use-read-cv.ts`.
  if (merged.length > 0 && (passes.length > 1 || notes.length > 0)) {
    const reply = await turn(missedMessages(doc.name, doc.text, merged, kind))
    if (reply.ok && reply.text !== null && reply.text.trim() !== '') {
      const read = readCv(reply.text)
      if (read.ok) found.push([...read.background])
    }
  }
  return { kind, passes: passes.length, entries: mergeBackground(found), notes }
}

/* ------------------------------ requirements ------------------------------ */

type PostingRow = {
  model: string
  posting: string
  requirements: number
  expected: number
  recalled: number
  essentialRight: number
  essentialWrong: string[]
  missed: string[]
  skipped: number
  list: { text: string; essential: boolean }[]
  error?: string
}

/** `use-read-fit.ts`'s asking half. */
async function readPosting(turn: ReturnType<typeof turnFor>, posting: PostingFixture) {
  const reply = await turn(requirementMessages(posting.title, posting.text))
  if (!reply.ok) return { error: reply.reason }
  if (reply.text === null || reply.text.trim() === '') return { error: 'nothing at all' }
  const read = readRequirements(reply.text)
  if (!read.ok) return { error: read.reason }
  return { requirements: read.requirements, skipped: read.skipped.length }
}

/* ---------------------------------- fit ----------------------------------- */

type FitRow = {
  model: string
  person: string
  posting: string
  facts: number
  requirements: number
  score: number | null
  verdict: string
  summary: string
  lead: string[]
  gaps: string[]
  expectation: string
  ok: boolean
}

const enabled = process.env['JOJO_FIT'] === '1'
const wanted = process.env['JOJO_FIT_MODEL']
const models = wanted ? MODELS.filter((m) => m.id === wanted) : MODELS
const REPORT = process.env['JOJO_FIT_REPORT'] ?? 'fit-eval.json'

describe.runIf(enabled)('from documents to a verdict, with real models', () => {
  const docRows: DocRow[] = []
  const postingRows: PostingRow[] = []
  const fitRows: FitRow[] = []
  /** `model:person` -> the evidence; `model:posting` -> the requirements. For the report. */
  const rawFacts = new Map<string, readonly Evidence[]>()
  const rawRequirements = new Map<string, readonly Requirement[]>()

  for (const model of models) {
    const turn = turnFor(model)
    /** Every person's facts, as the app would hold them: per document, no cross-document merge. */
    const facts = new Map<string, Evidence[]>()
    const requirementsFor = new Map<string, readonly Requirement[]>()

    for (const person of PEOPLE) {
      it(`${model.label} reads ${person.label}`, async () => {
        const evidence: Evidence[] = []
        for (const doc of person.docs) {
          const out = await readDocument(turn, doc)
          const missed = doc.expect.filter((w) => !found(out.entries, w))
          const wrongly = doc.forbidden.filter((f) => filed(out.entries, f.says))
          docRows.push({
            model: model.id,
            person: person.id,
            document: doc.id,
            kind: out.kind,
            passes: out.passes,
            expected: doc.expect.length,
            recalled: doc.expect.length - missed.length,
            recall:
              doc.expect.length === 0
                ? 100
                : Math.round(((doc.expect.length - missed.length) / doc.expect.length) * 100),
            total: out.entries.length,
            missed: missed.map((m) => m.label),
            wrongly: wrongly.map((w) => `${w.says} (${w.why})`),
            notes: out.notes,
          })
          // The app files each document's entries separately, so the same
          // paper in a CV and a research statement is two facts. Mirrored.
          for (const [i, draft] of out.entries.entries()) {
            evidence.push({ id: `${person.id}:${doc.id}:${String(i)}`, ...draft })
          }
        }
        facts.set(person.id, evidence)
        rawFacts.set(`${model.id}:${person.id}`, evidence)
        expect(evidence.length).toBeGreaterThan(0)
      }, 1_800_000)
    }

    for (const posting of POSTINGS) {
      it(`${model.label} reads what ${posting.id} asks for`, async () => {
        const out = await readPosting(turn, posting)
        if ('error' in out) {
          postingRows.push({
            model: model.id,
            posting: posting.id,
            requirements: 0,
            expected: posting.expect.length,
            recalled: 0,
            essentialRight: 0,
            essentialWrong: [],
            missed: posting.expect.map((e) => e.label),
            skipped: 0,
            list: [],
            error: out.error,
          })
          throw new Error(out.error)
        }
        const list = out.requirements
        // Punctuation dropped on both sides: the posting spells it "Ph. D." and
        // the ground truth says "phd", and a matcher that cared would score the
        // doctorate as missed on every model.
        const flat = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '')
        const folded = list.map((r) => ({ text: flat(r.text), essential: r.essential }))
        const hit = (want: (typeof posting.expect)[number]) =>
          folded.find((r) => r.text.includes(flat(want.says)))
        const missed = posting.expect.filter((w) => hit(w) === undefined)
        const essentialWrong = posting.expect
          .filter((w) => hit(w) !== undefined && hit(w)?.essential !== w.essential)
          .map((w) => `${w.label}: read as ${hit(w)?.essential ? 'required' : 'preferred'}`)
        postingRows.push({
          model: model.id,
          posting: posting.id,
          requirements: list.length,
          expected: posting.expect.length,
          recalled: posting.expect.length - missed.length,
          essentialRight: posting.expect.length - missed.length - essentialWrong.length,
          essentialWrong,
          missed: missed.map((m) => m.label),
          skipped: out.skipped,
          list: list.map((r) => ({ text: r.text, essential: r.essential })),
        })
        requirementsFor.set(posting.id, list)
        rawRequirements.set(`${model.id}:${posting.id}`, list)
        expect(list.length).toBeGreaterThan(0)
      }, 900_000)
    }

    it(`${model.label}: the verdicts say something true`, () => {
      const failures: string[] = []
      for (const person of PEOPLE) {
        for (const posting of POSTINGS) {
          const evidence = facts.get(person.id) ?? []
          const requirements = requirementsFor.get(posting.id) ?? []
          const assessment = assess(requirements, evidence)
          const guidance = guidanceFrom(assessment)
          const want = EXPECTED_FIT.find((e) => e.person === person.id && e.posting === posting.id)
          const expectation = want
            ? [
                want.atLeastTailoring ? 'at least worth tailoring' : '',
                want.notStrong ? 'not strong' : '',
              ]
                .filter(Boolean)
                .join(' and ')
            : '(no expectation)'
          let ok = true
          if (
            want?.atLeastTailoring &&
            !(guidance.verdict === 'strong' || guidance.verdict === 'worth-tailoring')
          )
            ok = false
          if (want?.notStrong && guidance.verdict === 'strong') ok = false
          if (!ok)
            failures.push(
              `${person.label} × ${posting.id}: ${guidance.verdict} (${String(assessment.score)}), wanted ${expectation}`,
            )
          fitRows.push({
            model: model.id,
            person: person.id,
            posting: posting.id,
            facts: evidence.length,
            requirements: requirements.length,
            score: assessment.score,
            verdict: guidance.verdict,
            summary: guidance.summary,
            lead: guidance.tailor.map((t) => `${t.evidence.title} ← ${t.answers}`),
            gaps: guidance.prepare.map(
              (p) => `${p.essential ? '[required] ' : ''}${p.requirement}`,
            ),
            expectation,
            ok,
          })
        }
      }
      expect(failures, failures.join('\n')).toEqual([])
    })
  }

  it('writes the report', () => {
    /*
     * The raw material goes in too — every fact as filed and every requirement
     * as read — so `assess` can be changed and re-scored against a real run
     * offline, without paying for the models again. The verdict is arithmetic
     * over exactly these two lists.
     */
    const raw = {
      facts: Object.fromEntries([...rawFacts.entries()]),
      requirements: Object.fromEntries([...rawRequirements.entries()]),
    }
    writeFileSync(REPORT, JSON.stringify({ docRows, postingRows, fitRows, raw }, null, 2))
    const lines: string[] = []
    for (const r of docRows) {
      lines.push(
        `${r.model.padEnd(13)} ${r.person.padEnd(6)} ${r.document.padEnd(26)} recall ${String(r.recall).padStart(3)}% (${String(r.recalled)}/${String(r.expected)}) total ${String(r.total).padStart(2)}` +
          (r.wrongly.length ? `  WRONGLY: ${r.wrongly.join('; ')}` : '') +
          (r.missed.length ? `  missed: ${r.missed.join(', ')}` : ''),
      )
    }
    for (const r of postingRows) {
      lines.push(
        `${r.model.padEnd(13)} posting ${r.posting.padEnd(12)} ${String(r.requirements)} read, recall ${String(r.recalled)}/${String(r.expected)}, essential right ${String(r.essentialRight)}` +
          (r.essentialWrong.length ? `  ESSENTIAL WRONG: ${r.essentialWrong.join('; ')}` : '') +
          (r.missed.length ? `  missed: ${r.missed.join(', ')}` : '') +
          (r.error ? `  ERROR: ${r.error}` : ''),
      )
    }
    for (const r of fitRows) {
      lines.push(
        `${r.model.padEnd(13)} ${r.person.padEnd(6)} × ${r.posting.padEnd(12)} ${String(r.score).padStart(4)}  ${r.verdict.padEnd(16)} ${r.ok ? 'ok ' : 'NOT'} (${r.expectation})`,
      )
    }
    console.log(`\n${lines.join('\n')}\n`)
  })
})
