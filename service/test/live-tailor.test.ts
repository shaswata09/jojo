/**
 * Tailoring, measured against real models.
 *
 * INERT unless `JOJO_TAILOR` is set, for the reasons `live-fit.test.ts` gives:
 * it needs three vLLM boxes on the lab network and takes minutes.
 *
 *   JOJO_TAILOR=1 npx vitest run test/live-tailor --root service
 *   JOJO_TAILOR=1 JOJO_TAILOR_MODEL=gemma_4_31b JOJO_TAILOR_REPORT=tailor-gemma.json npx vitest run test/live-tailor --root service
 *
 * What is asserted is the CONTRACT `agent/tailor-material.ts` states, on
 * Priya's four documents against the three postings:
 *
 *   - the reply reads as a document (`readTailored` keeps it);
 *   - something in it is MARKED — a tailored version with nothing marked is
 *     the document handed back, which is the failure a person cannot see;
 *   - it does not invent: the employer named in the posting may appear, but
 *     none of a short list of qualifications Priya does not have may;
 *   - a whole-document reply keeps most of the original, and a sections reply
 *     comes back under the document's own headings.
 *
 * The raw replies are dumped to the report, because the interesting failures
 * are the ones no assertion here names: a letter that reads well and quietly
 * drops a paragraph, a CV whose bullets were reordered into nonsense. Those
 * are read by a person.
 */

import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  chatRequest,
  DEFAULT_THINKING,
  guardTruncation,
  readTurnFor,
  sendTurn,
  unreachable,
} from '../kg/core/model-server'
import type { ChatMessage, Turn } from '../kg/core/model-server'
import type { ModelSettings } from '../kg/core/provider'
import { documentKindOf } from '../kg/core/document-kind'
import { hasMarks, parseMarks, stripMarks } from '../kg/core/marks'
import { assess } from '../kg/core/assess'
import type { Evidence } from '../kg/core/assess'
import { guidanceFrom } from '../kg/core/tailor'
import { readRequirements, requirementMessages } from '../kg/agent/read-requirements'
import { modeFor, readTailored, tailorMessages, WHOLE_LIMIT } from '../kg/agent/tailor-material'
import type { TailorBrief } from '../kg/agent/tailor-material'
import { POSTINGS, PRIYA } from '../kg/agent/fit-fixtures'
import type { PostingFixture } from '../kg/agent/fit-fixtures'
import type { Fixture } from '../kg/agent/extract-fixtures'

const MODELS = [
  { id: 'gemma_4_31b', endpoint: 'http://10.116.34.124:8103/v1', label: 'Gemma 4 31B' },
  { id: 'qwen3_14b', endpoint: 'http://10.116.34.124:8109/v1', label: 'Qwen3 14B' },
  { id: 'gpt_oss_120b', endpoint: 'http://10.116.34.124:8116/v1', label: 'GPT-OSS 120B' },
] as const

type Model = (typeof MODELS)[number]

/**
 * Things Priya does not have. A tailored document that gains one of these has
 * invented it, whatever else it got right. Chosen to be the qualifications a
 * model is most tempted to add when a posting asks for them.
 */
const NOT_PRIYAS = [
  /\bMBA\b/,
  /\bJD\b/,
  /\bMD\b/,
  /\bNobel\b/,
  /\bTuring Award\b/,
  /\bMacArthur\b/,
  /\btenured\b/i,
  /\bDepartment Chair\b/i,
  /\bpatent(s)? granted\b/i,
]

/* -------------------------------- transport ------------------------------- */

async function send(
  endpoint: string,
  request: ReturnType<typeof chatRequest>,
): Promise<
  { ok: boolean; status: number; text: string; retryAfter: string | null } | { failed: Turn }
> {
  const controller = new AbortController()
  // Ten minutes: a long document on the slowest box. Nothing here is a UI.
  const timer = setTimeout(() => controller.abort(), 600_000)
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: controller.signal,
    })
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text().catch(() => ''),
      retryAfter: response.headers.get('retry-after'),
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      failed: unreachable(
        endpoint,
        error instanceof Error ? error.message : String(error),
        aborted,
      ),
    }
  } finally {
    clearTimeout(timer)
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

/* ------------------------------- the brief -------------------------------- */

/**
 * Priya's record, roughly as the profile pipeline would have stored it. The
 * fixture's `label` is "what a person would call this", which is what a title
 * is, and `says` is the phrase the reader is expected to find.
 *
 * ROUGHLY: the real background carries the full titles a CV reader produces
 * ("PhD in Computer Science, University of Washington"), and these carry
 * "the PhD" — so `assess` lists the doctorate as a gap and the brief tells the
 * model not to claim it. The prompt's rule against claiming a gap therefore
 * gets a harder test here than in the app, which is the useful direction: a
 * model that obeys a wrong gap list is still obeying. It is not what a person
 * would see, and the report should be read with that in mind.
 */
const EVIDENCE: readonly Evidence[] = PRIYA.flatMap((doc, d) =>
  doc.expect.map((e, i) => ({
    id: `b${String(d)}-${String(i)}`,
    kind: e.kind,
    title: e.label,
    // `says` is the phrase the fixture expects the reader to find; as `detail`
    // it gives `assess` the same words the real background carries, so the
    // gap list handed to the model is not "PhD" for a person who has one.
    detail: e.says,
  })),
)

/**
 * A long CV, for the sections road. Every fixture document is under
 * `WHOLE_LIMIT`, so without this the branch a real six-page CV takes would
 * never meet a model. The fixture CV plus the sections an academic CV grows.
 */
const LONG_CV: Fixture = (() => {
  const cv = PRIYA.find((d) => /CV/.test(d.name))
  if (cv === undefined) throw new Error('no CV fixture')
  const section = (h: string, n: number) =>
    `\n\n## ${h}\n` +
    Array.from(
      { length: n },
      (_, i) =>
        `- ${h} ${String(i + 1)}: on distributed systems, at venue ${String(i + 1)}, ${String(2018 + (i % 8))}.`,
    ).join('\n')
  return {
    ...cv,
    id: `${cv.id}-long`,
    name: 'Raghunathan-CV-2026-long.pdf',
    text:
      cv.text +
      section('Invited Talks', 22) +
      section('Reviewing', 18) +
      section('Selected Media', 10) +
      section('Professional Memberships', 8) +
      section('Additional Teaching', 14),
  }
})()

const DOCUMENTS: readonly Fixture[] = [...PRIYA, LONG_CV]

// Said here rather than trusted: the first version of this fixture came in
// under the limit and every one of forty-five cases quietly took the whole
// road, which is what this fixture exists to leave.
if (modeFor(LONG_CV.text.length) !== 'sections') {
  throw new Error(
    `LONG_CV is ${String(LONG_CV.text.length)} chars, under WHOLE_LIMIT ${String(WHOLE_LIMIT)}`,
  )
}

async function briefFor(
  turn: (messages: readonly ChatMessage[]) => Promise<Turn>,
  posting: PostingFixture,
  doc: Fixture,
): Promise<TailorBrief> {
  // The requirements as the fit panel would have stored them.
  const reply = await turn(requirementMessages(posting.title, posting.text))
  const read = reply.ok && reply.text !== null ? readRequirements(reply.text) : null
  const requirements = read?.ok ? read.requirements : []
  const guidance = requirements.length > 0 ? guidanceFrom(assess(requirements, EVIDENCE)) : null
  const [org = 'the university', role = posting.title] = posting.title.split(' — ').reverse()
  return {
    kind: documentKindOf(doc.name, doc.text),
    org,
    role,
    postingName: `${posting.id}.html`,
    posting: posting.text,
    requirements,
    guidance,
    baseName: doc.name,
    base: doc.text,
  }
}

/* --------------------------------- the run -------------------------------- */

type Row = {
  model: string
  posting: string
  document: string
  kind: string
  mode: string
  /** How many requirements the brief carried. Zero means the posting read failed. */
  requirements: number
  finish: string | null
  ok: boolean
  marked: boolean
  chars: number
  ratio: number
  invented: string[]
  headings: number
  notes: string[]
  reason?: string
  seconds: number
  reply: string
}

const enabled = process.env['JOJO_TAILOR'] === '1'
const only = process.env['JOJO_TAILOR_MODEL']
const REPORT = process.env['JOJO_TAILOR_REPORT'] ?? 'tailor-eval.json'
const rows: Row[] = []

describe.runIf(enabled)('tailoring, live', () => {
  const models = MODELS.filter((m) => only === undefined || m.id === only)

  for (const model of models) {
    describe(model.label, () => {
      const turn = turnFor(model)

      for (const posting of POSTINGS) {
        for (const doc of DOCUMENTS) {
          it(`${posting.id} × ${doc.name}`, async () => {
            const brief = await briefFor(turn, posting, doc)
            const t0 = Date.now()
            const reply = await turn(tailorMessages(brief))
            const seconds = Math.round((Date.now() - t0) / 1000)
            const text = reply.ok ? (reply.text ?? '') : ''
            const read = readTailored(text, brief)
            const body = read.ok ? read.body : ''
            const plain = stripMarks(body)
            const invented = NOT_PRIYAS.filter((re) => re.test(plain) && !re.test(doc.text)).map(
              (re) => re.source,
            )
            const row: Row = {
              model: model.id,
              posting: posting.id,
              document: doc.name,
              kind: brief.kind,
              mode: modeFor(brief.base.length),
              requirements: brief.requirements.length,
              finish: reply.ok ? reply.finishReason : null,
              ok: read.ok,
              marked: read.ok && hasMarks(body),
              chars: body.length,
              ratio: doc.text.length === 0 ? 0 : plain.length / doc.text.length,
              invented,
              headings: parseMarks(body).filter((b) => b.kind === 'heading').length,
              notes: read.ok ? [...read.notes] : [],
              ...(read.ok ? {} : { reason: read.reason }),
              seconds,
              reply: text,
            }
            rows.push(row)

            expect(reply.ok, reply.ok ? '' : reply.reason).toBe(true)
            // What the app refuses to save (`CUT_OFF`) must not count as a pass here.
            expect(row.finish, 'the server cut the reply off').not.toBe('length')
            expect(read.ok, read.ok ? '' : read.reason).toBe(true)
            expect(row.marked, 'nothing marked as changed').toBe(true)
            expect(invented, 'invented a qualification').toEqual([])
            if (row.mode === 'whole') {
              expect(row.ratio, 'lost most of the document').toBeGreaterThan(0.4)
            } else {
              expect(row.headings, 'no section headings in a sections reply').toBeGreaterThan(0)
            }
            /*
             * The CHANGES should be about the posting. The unchanged document
             * already mentions the field, so the test is on the marked runs
             * alone: what the model added or moved has to name the employer or
             * one of the requirement terms, or it tailored to nothing.
             */
            const changed = parseMarks(body)
              .flatMap((b) => (b.kind === 'blank' ? [] : b.runs))
              .filter((r) => r.bold || r.italic || r.underline)
              .map((r) => r.text)
              .join(' ')
              .toLowerCase()
            const terms = [
              ...brief.org
                .toLowerCase()
                .split(/\s+/)
                .filter((w) => w.length > 3),
              ...brief.requirements.flatMap((r) =>
                r.text
                  .toLowerCase()
                  .split(/\s+/)
                  .filter((w) => w.length > 4),
              ),
            ]
            expect(
              terms.some((w) => changed.includes(w)),
              `the marked changes never mention the posting: ${changed.slice(0, 160)}`,
            ).toBe(true)
          }, 900_000)
        }
      }
    })
  }

  it('writes the report', () => {
    const summary = {
      ranAt: new Date().toISOString(),
      wholeLimit: WHOLE_LIMIT,
      rows: rows.map(({ reply: _reply, ...r }) => r),
      replies: rows.map((r) => ({
        model: r.model,
        posting: r.posting,
        document: r.document,
        reply: r.reply,
      })),
    }
    writeFileSync(REPORT, JSON.stringify(summary, null, 2))
    expect(rows.length).toBeGreaterThan(0)
  })
})
