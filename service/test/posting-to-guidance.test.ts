/**
 * A saved posting, all the way to advice, with nothing stubbed but the model.
 *
 * The mirror of `cv-to-graph.test.ts`, pointed at the employer's side, and it
 * exists for the same reason: every layer in this chain has its own tests and
 * the chain is where a feature like this fails. The previous version of the
 * assessment worked perfectly and had no caller — `assess()` was tested end to
 * end and no screen rendered a fit, a gap or a tailoring list.
 *
 * So the model's reply is a fixture and everything after it is real: the
 * parser, the store, the join that finds which document a posting is, the
 * scorer, and the layer that turns a score into what to do about it.
 *
 * The claim asserted is the one no unit test makes — that a person who has read
 * their CV in gets different, checkable advice about a posting than a person who
 * has not, and that every line of that advice names a record or a requirement.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../kg/core/snapshot'
import { createRepository } from '../kg/repo/repository'
import { createToolRuntime } from '../kg/tools/runtime'
import type { GraphSnapshot } from '../kg/core/snapshot'
import { readCv } from '../kg/agent/read-cv'
import { readRequirements } from '../kg/agent/read-requirements'
import { assess } from '../kg/core/assess'
import type { Evidence } from '../kg/core/assess'
import { postingSourceFor } from '../kg/core/posting-source'
import { guidanceFrom } from '../kg/core/tailor'

const NOW = '2026-09-14T09:00:00.000Z'

const nullDriver = () => ({
  open: async () => ({ ok: true as const, value: { version: 1, from: 0, migrated: [], crossTab: false } }),
  readAll: async () => ({ ok: true as const, value: { nodes: [], edges: [], meta: [], ops: [] } }),
  commit: async () => ({ ok: true as const, value: undefined }),
  replace: async () => ({ ok: true as const, value: undefined }),
  seedIfPristine: async () => ({ ok: true as const, value: true }),
  destroy: async () => ({ ok: true as const, value: undefined }),
  onRemoteCommit: () => () => {},
  onBlocking: () => () => {},
  close: () => {},
})

function store() {
  let tick = 0
  const now = () => new Date(Date.parse(NOW) + tick++ * 1000).toISOString()
  const repo = createRepository({
    driver: nullDriver() as Parameters<typeof createRepository>[0]['driver'],
    snapshot: new MutableSnapshot(),
    meta: { schemaVersion: 1, createdAt: NOW, lastOpenedAt: NOW, dataSet: 'user', seededAt: null, handoverAt: null },
    now,
  })
  return { repo, runtime: createToolRuntime({ repo, now }) }
}

const LISTING = 'https://boards.example.com/jobs/4012?gh_jid=4012'

/**
 * What a model returns when asked what a posting requires.
 *
 * Fenced, with prose around it, one entry listed twice under two headings and
 * one line of pure boilerplate — because those are the three things the parser
 * exists to survive, and real postings produce all of them.
 */
const REQUIREMENTS_REPLY = `Reading the posting now.
\`\`\`json
{"requirements": [
  {"text":"PhD in computer science or a related field","essential":true},
  {"text":"research in distributed systems and storage","essential":true},
  {"text":"experience teaching graduate courses","essential":true},
  {"text":"distributed systems","essential":true},
  {"text":"Distributed Systems","essential":false},
  {"text":"FPGA and hardware design","essential":false},
  {"text":"excellent communication skills","essential":false}
]}
\`\`\``

/** The same CV fixture `cv-to-graph.test.ts` uses, minus its unusable row. */
const CV_REPLY = `{"background": [
  {"kind":"education","title":"PhD, Computer Science","where":"University of Illinois","period":"2016–2021","year":2016},
  {"kind":"employment","title":"Postdoctoral Researcher","where":"Carnegie Mellon University","period":"2021–2024","year":2021},
  {"kind":"publication","title":"Consistent snapshots without coordination","where":"OSDI","year":2023,"detail":"distributed systems research and storage"},
  {"kind":"teaching","title":"Distributed Systems","detail":"graduate courses, three years"},
  {"kind":"skill","title":"Rust"}
]}`

const evidenceFrom = (m: GraphSnapshot): Evidence[] =>
  m.ofType('background').map((n) => ({
    id: n.id,
    kind: n.props.kind,
    title: n.props.title,
    where: n.props.where,
    detail: n.props.detail,
    year: n.props.year,
  }))

/** An application and the captured page it was created from. Nothing links them. */
function applicationWithPosting(runtime: ReturnType<typeof store>['runtime']) {
  const file = runtime.run('vault.file.add', {
    files: [
      {
        name: 'Example — Research Scientist.html',
        kind: 'page',
        bucket: 'Job postings',
        size: '38 KB',
        sourceUrl: LISTING,
      },
    ],
  })
  const application = runtime.run('application.create', {
    org: 'Example Lab',
    role: 'Research Scientist',
    roleTag: 'Industry',
    stage: 'draft',
    url: LISTING,
  })
  return { file, application }
}

describe('a posting, read and then acted on', () => {
  it('finds the page behind an application nothing linked to it', () => {
    /*
     * The join the whole feature stands on, and the reason it is a lookup: the
     * importer writes `sourceUrl` on the capture and the same address onto the
     * application, and links neither to the other. Without this, an application
     * created from a link has no posting text and the honest output would be
     * "nothing to assess against" for a page sitting in the Vault.
     */
    const { repo, runtime } = store()
    const { application } = applicationWithPosting(runtime)
    expect(application.ok).toBe(true)
    if (!application.ok) return

    const m = repo.getSnapshot() as GraphSnapshot
    const source = postingSourceFor(m, String(application.output))
    expect(source?.name).toBe('Example — Research Scientist.html')
    expect(source?.how).toBe('same-url')
  })

  it('turns the page into requirements a person could check against it', () => {
    const read = readRequirements(REQUIREMENTS_REPLY)
    expect(read.ok).toBe(true)
    if (!read.ok) return

    /*
     * The posting names "distributed systems" under Required and again under
     * Preferred, which real ones do. Kept, `assess` would count it twice — once
     * at double weight — and a posting that mentioned a skill in two places
     * would score as though it were a third of the job.
     *
     * The FIRST spelling survives, which is why the prompt asks for the most
     * specific first: the requirement stays essential rather than being
     * downgraded by its own repetition under a softer heading.
     */
    const named = read.requirements.filter((r) => r.text.toLowerCase() === 'distributed systems')
    expect(named).toHaveLength(1)
    expect(named[0]?.essential).toBe(true)
    expect(read.skipped.join(' ')).toMatch(/already listed/)

    // "excellent communication skills" is boilerplate the prompt asks the model
    // to leave out — and the parser does not second-guess it if the model
    // returns it anyway. Judging prose is the model's job, not this layer's.
    expect(read.requirements).toHaveLength(6)
    expect(read.requirements.filter((r) => r.essential)).toHaveLength(4)
  })

  it('says nothing about fit until a background exists, rather than saying zero', () => {
    /*
     * The distinction `assess` protects by returning null instead of 0, carried
     * all the way to the sentence somebody reads. A person who has not uploaded
     * a CV has not scored badly against this posting — and "a stretch" would be
     * telling them something false about themselves on the basis of no data.
     */
    const { repo } = store()
    const read = readRequirements(REQUIREMENTS_REPLY)
    if (!read.ok) return

    const guidance = guidanceFrom(
      assess(read.requirements, evidenceFrom(repo.getSnapshot() as GraphSnapshot)),
    )
    expect(guidance.verdict).toBe('not-measured')
    expect(guidance.tailor).toEqual([])
    expect(guidance.prepare).toEqual([])
    // And it says what to do about it, which is the actionable half.
    expect(guidance.summary).toMatch(/Vault/)
  })

  it('produces advice whose every line points at a record or a requirement', () => {
    /*
     * THE assertion, and the reason none of this is a model's prose. "Emphasise
     * your systems background" is a sentence a model writes for any candidate
     * and the reader cannot check it. Every line below can be traced to a row
     * in their own records and disagreed with.
     */
    const { repo, runtime } = store()
    const cv = readCv(CV_REPLY)
    expect(cv.ok).toBe(true)
    if (!cv.ok) return
    runtime.run('profile.background.add', { background: [...cv.background] })

    const read = readRequirements(REQUIREMENTS_REPLY)
    if (!read.ok) return

    const m = repo.getSnapshot() as GraphSnapshot
    const ids = new Set(m.ofType('background').map((n) => n.id))
    const wanted = new Set(read.requirements.map((r) => r.text))

    const guidance = guidanceFrom(assess(read.requirements, evidenceFrom(m)))

    expect(guidance.verdict).not.toBe('not-measured')
    expect(guidance.tailor.length).toBeGreaterThan(0)

    for (const note of guidance.tailor) {
      expect(ids.has(note.evidence.id)).toBe(true)
      expect(wanted.has(note.answers)).toBe(true)
    }
    for (const note of guidance.prepare) {
      expect(wanted.has(note.requirement)).toBe(true)
      // The advice quotes the requirement, so a line cannot be generic even by
      // accident.
      expect(note.advice).toContain(note.requirement)
    }
  })

  it('reports the thing they do not have as a gap, and leaves room for “it is not written down”', () => {
    const { repo, runtime } = store()
    const cv = readCv(CV_REPLY)
    if (!cv.ok) return
    runtime.run('profile.background.add', { background: [...cv.background] })

    const read = readRequirements(REQUIREMENTS_REPLY)
    if (!read.ok) return

    const guidance = guidanceFrom(
      assess(read.requirements, evidenceFrom(repo.getSnapshot() as GraphSnapshot)),
    )

    // Nothing in this CV is about hardware, and the posting lists it as
    // preferred — so it is a gap, and a gap that must not read as a rejection.
    const fpga = guidance.prepare.find((p) => p.requirement.includes('FPGA'))
    expect(fpga).toBeDefined()
    expect(fpga?.essential).toBe(false)
    expect(fpga?.advice).toMatch(/not worth inventing/)
  })

  it('caps the verdict when something the posting requires is missing', () => {
    /*
     * The one rule that overrides the arithmetic, checked on the whole chain
     * rather than on a hand-built assessment: a record can answer every
     * preference and still miss the single thing stated as required, and
     * reporting that as "worth tailoring" is defensible arithmetic and terrible
     * advice.
     */
    const { repo, runtime } = store()
    runtime.run('profile.background.add', {
      background: [
        { kind: 'skill', title: 'Rust' },
        { kind: 'skill', title: 'FPGA and hardware design' },
      ],
    })

    const read = readRequirements(REQUIREMENTS_REPLY)
    if (!read.ok) return

    const guidance = guidanceFrom(
      assess(read.requirements, evidenceFrom(repo.getSnapshot() as GraphSnapshot)),
    )
    expect(guidance.prepare.filter((p) => p.essential).length).toBeGreaterThan(0)
    expect(guidance.verdict).toBe('a-stretch')
  })
})
