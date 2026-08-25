/**
 * Reading a CV, and — mostly — refusing to invent one.
 *
 * Almost every case here is about something the parser must NOT do. Extraction
 * from a personal document is the one place in this app where a plausible
 * fabrication lands in somebody's own records and is shown back to them as
 * though they wrote it, so the tests weigh heavily toward omission.
 */

import { describe, expect, it } from 'vitest'
import { BACKGROUND_KINDS } from '../core/model'
import {
  CV_BUDGET,
  cvMessages,
  readRelations,
  relationMessages,
  cvPasses,
  cvSections,
  mergeBackground,
  missedMessages,
  readCv,
} from './read-cv'
import type { BackgroundDraft } from './read-cv'

const reply = (payload: unknown) => JSON.stringify(payload)

describe('what it accepts', () => {
  it('reads a well-formed entry', () => {
    const out = readCv(
      reply({
        background: [
          {
            kind: 'education',
            title: 'PhD, Computer Science',
            where: 'University of Illinois',
            period: '2016–2021',
            year: 2016,
          },
        ],
      }),
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.background[0]).toEqual({
      kind: 'education',
      title: 'PhD, Computer Science',
      where: 'University of Illinois',
      period: '2016–2021',
      year: 2016,
    })
  })

  it('survives a fenced reply with prose around it', () => {
    // What a small local model actually sends, whatever the prompt said.
    const out = readCv(
      'Here is the JSON:\n```json\n{"background":[{"kind":"skill","title":"Rust"}]}\n```\nHope that helps.',
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.background).toHaveLength(1)
  })

  it('takes a year out of a range, keeping the start', () => {
    // Models return `"2021–2024"` for a field asked to be a single year. The
    // start is the right half: it is when the thing began, which is how CVs
    // order themselves.
    const out = readCv(reply({ background: [{ kind: 'employment', title: 'x', year: '2021–2024' }] }))
    expect(out.ok && out.background[0]?.year).toBe(2021)
  })
})

describe('what it refuses, which is the point', () => {
  it('drops the placeholders the prompt forbade', () => {
    /*
     * "Where: N/A" in somebody's own record is worse than a missing field: it
     * reads as a fact that was checked and found absent.
     */
    const out = readCv(
      reply({
        background: [{ kind: 'skill', title: 'Rust', where: 'N/A', detail: 'unknown', period: '--' }],
      }),
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.background[0]).toEqual({ kind: 'skill', title: 'Rust' })
  })

  it('skips an entry whose kind jojo does not have, and says so', () => {
    const out = readCv(
      reply({
        background: [
          { kind: 'hobby', title: 'Cycling' },
          { kind: 'skill', title: 'Go' },
        ],
      }),
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // One row lost, not the extraction. Re-reading a CV is a round trip to
    // somebody's GPU; discarding twenty-nine good rows over one bad one pays
    // for the whole thing twice.
    expect(out.background).toHaveLength(1)
    expect(out.skipped[0]).toContain('hobby')
  })

  it('skips an entry with no title rather than filing a blank', () => {
    const out = readCv(reply({ background: [{ kind: 'award', where: 'ACM' }] }))
    expect(out.ok).toBe(false)
  })

  it('rejects a document that is not about this person', () => {
    /*
     * Generalised from "is not a CV" when statements and cover letters became
     * readable. The refusal is not about the document's genre — a research
     * statement is not a CV and is exactly what this should read — it is about
     * whose facts are in it. A job posting and somebody else's CV are the two
     * that must never be filed as the user's background.
     */
    const out = readCv(JSON.stringify({ notAboutThePerson: true }))
    expect(out.ok).toBe(false)
    expect(!out.ok && out.reason).toMatch(/about you/i)
  })

  it('refuses a reply that is not JSON at all', () => {
    const out = readCv('I could not find a CV in that document.')
    expect(out.ok).toBe(false)
  })

  it('refuses when nothing usable came back, rather than reporting success on nothing', () => {
    const out = readCv(reply({ background: [] }))
    expect(out.ok).toBe(false)
  })

  it('rejects a year outside a plausible range', () => {
    const out = readCv(reply({ background: [{ kind: 'award', title: 'x', year: 12 }] }))
    expect(out.ok && out.background[0]?.year).toBeUndefined()
  })
})

describe('the prompt', () => {
  it('tells the model when it is reading a fragment', () => {
    /*
     * The one sentence that is not a rule about extraction, and it is here for
     * a reason worth keeping: a model handed a truncated document without being
     * told concludes the person has not published, which is the single worst
     * extraction error available here.
     */
    const long = 'x'.repeat(CV_BUDGET + 500)
    const messages = cvMessages('CV.pdf', { label: 'Publications', text: long, partial: false })
    expect(messages[1]?.content).toContain('part of a longer section')
  })

  it('says so when a pass is a slice of one long section', () => {
    // Same sentence, reached the other way. A publication list cut into three
    // passes must not have each third read as a complete list.
    const messages = cvMessages('CV.pdf', { label: 'Publications (part 2)', text: 'x', partial: true })
    expect(messages[1]?.content).toContain('part of a longer section')
  })

  it('says nothing about a fragment when the pass is whole', () => {
    const messages = cvMessages('CV.pdf', { label: 'Languages', text: 'German — C1', partial: false })
    expect(messages[1]?.content).not.toContain('part of a longer section')
  })

  it('names which part of the document this is', () => {
    // So the model reads the section it was given rather than reasoning about
    // the CV it imagines around it.
    const messages = cvMessages('CV.pdf', { label: 'Education', text: 'PhD', partial: false })
    expect(messages[1]?.content).toContain('Education')
    expect(messages[1]?.content).toContain('Nothing from any other part')
  })

  it('names every kind it will accept, so the model is not guessing', () => {
    const system = String(
      cvMessages('CV.pdf', { label: 'x', text: 'x', partial: false })[0]?.content,
    )
    for (const kind of BACKGROUND_KINDS) expect(system).toContain(kind)
  })

  it('asks to be complete AND to invent nothing, because it used to ask only the second', () => {
    /*
     * The half that was missing. Every instruction in the first version was a
     * permission to omit and none asked for completeness, so a model told six
     * times to leave things out returned a representative sample of a CV rather
     * than a reading of it. Both halves are asserted here because dropping
     * either one is a different failure and both are silent.
     */
    const system = String(
      cvMessages('CV.pdf', { label: 'x', text: 'x', partial: false })[0]?.content,
    ).toLowerCase()
    expect(system).toContain('be complete')
    expect(system).toContain('every item the text states')
    expect(system).toContain('never guess')
    expect(system).toContain('omit any key you cannot find')
    expect(system).toContain('do not infer')
  })
})

describe('the kinds it can hold', () => {
  it('keeps every category a real CV states', () => {
    /*
     * The bug that started this. The vocabulary was seven kinds and `readCv`
     * drops any row outside it — so a model correctly reading a certification,
     * a language, a side project, a patent, a grant, volunteering or a society
     * membership had every one of them silently discarded on the way in.
     *
     * Measured on this exact reply before the fix: one of eight rows survived.
     */
    const out = readCv(
      JSON.stringify({
        background: [
          { kind: 'education', title: 'PhD, Computer Science' },
          { kind: 'certification', title: 'AWS Certified Solutions Architect' },
          { kind: 'language', title: 'German', detail: 'C1' },
          { kind: 'project', title: 'openbench' },
          { kind: 'volunteering', title: 'Mentor' },
          { kind: 'patent', title: 'US11234567B2' },
          { kind: 'grant', title: 'NSF CAREER', year: 2024 },
          { kind: 'membership', title: 'ACM Senior Member' },
        ],
      }),
    )
    expect(out.ok && out.background).toHaveLength(8)
    expect(out.ok && out.skipped).toEqual([])
  })

  it('still refuses a kind that is not one of them', () => {
    // Widening the list is not the same as accepting anything: a row typed
    // `hobby` is a row that would show up on screen as a qualification.
    const out = readCv(JSON.stringify({ background: [{ kind: 'hobby', title: 'Cycling' }] }))
    expect(out.ok).toBe(false)
  })
})

describe('the bullets under an entry', () => {
  it('keeps them, because they are what answers a posting', () => {
    /*
     * A requirement reads "five years running distributed systems in
     * production" and the thing that answers it is not the job title or the
     * employer — it is the line underneath. Dropped, most of the evidence never
     * reaches `assess`.
     */
    const out = readCv(
      JSON.stringify({
        background: [
          {
            kind: 'employment',
            title: 'Staff Engineer',
            where: 'Cloudflare',
            highlights: ['Ran a multi-region key-value store', 'Cut p99 latency by half'],
          },
        ],
      }),
    )
    expect(out.ok && out.background[0]?.highlights).toEqual([
      'Ran a multi-region key-value store',
      'Cut p99 latency by half',
    ])
  })

  it('accepts a single string, which models return for a one-bullet entry', () => {
    const out = readCv(
      JSON.stringify({ background: [{ kind: 'project', title: 'x', highlights: 'One thing' }] }),
    )
    expect(out.ok && out.background[0]?.highlights).toEqual(['One thing'])
  })

  it('drops the blanks and keeps the rest', () => {
    // Same per-row principle the entry loop follows: one bad element costs that
    // element, not the entry it was attached to.
    const out = readCv(
      JSON.stringify({
        background: [{ kind: 'project', title: 'x', highlights: ['Real', '', 'N/A', 42, 'Also real'] }],
      }),
    )
    expect(out.ok && out.background[0]?.highlights).toEqual(['Real', 'Also real'])
  })

  it('omits the key rather than storing an empty list', () => {
    // An entry with no bullets and an entry with an empty list of them are the
    // same fact, and only one of the two shapes should reach a reader.
    const out = readCv(JSON.stringify({ background: [{ kind: 'skill', title: 'Rust', highlights: [] }] }))
    expect(out.ok && out.background[0]?.highlights).toBeUndefined()
  })

  it('stops transcribing at some point', () => {
    // A model that has started copying the document has stopped extracting it.
    const many = Array.from({ length: 40 }, (_, i) => `bullet ${String(i)}`)
    const out = readCv(
      JSON.stringify({ background: [{ kind: 'employment', title: 'x', highlights: many }] }),
    )
    expect(out.ok && out.background[0]?.highlights?.length).toBeLessThanOrEqual(12)
  })
})

describe('splitting the document on its own headings', () => {
  const CV = [
    'Jane Doe',
    'jane@example.com',
    '',
    '## Education',
    'PhD, Computer Science, MIT, 2016–2021',
    '',
    '**Employment**',
    'Staff Engineer, Cloudflare, 2024–',
    '',
    'PUBLICATIONS',
    'A paper. OSDI 2023.',
  ].join('\n')

  it('reads all three heading styles a converted CV arrives in', () => {
    /*
     * The reader hands back whatever the original used and the three are not
     * interchangeable: styled Word headings become `## Education`, bold runs
     * become `**Employment**`, and LaTeX or plain-text exports arrive as a line
     * in capitals. Handling one of the three splits a CV into one section.
     */
    expect(cvSections(CV).map((x) => x.heading)).toEqual([
      'Top of the document',
      'Education',
      'Employment',
      'PUBLICATIONS',
    ])
  })

  it('keeps what comes before the first heading', () => {
    // The name, the contact details and often a summary paragraph. Dropping it
    // loses the one section that says who the document is about.
    expect(cvSections(CV)[0]?.text).toContain('jane@example.com')
  })

  it('does not mistake a journal name for a heading', () => {
    /*
     * The capitals rule has to be narrow. A publication list is full of lines
     * like this one, and treating each as a section would cut a nine-page list
     * into forty sections of one line each — which is both useless and forty
     * round trips.
     */
    const list = ['## Publications', 'IEEE TRANSACTIONS ON SOFTWARE ENGINEERING, 2024. A paper.'].join(
      '\n',
    )
    expect(cvSections(list).map((x) => x.heading)).toEqual(['Publications'])
  })

  it('returns the whole document when it has no headings at all', () => {
    // A one-page CV exported to plain text often has none, and the caller then
    // behaves exactly as the single-pass version did.
    const flat = cvSections('Jane Doe. PhD MIT. Staff Engineer Cloudflare.')
    expect(flat).toHaveLength(1)
    expect(flat[0]?.text).toContain('Cloudflare')
  })

  it('drops a heading with nothing under it', () => {
    const out = cvSections(['## Education', '', '## Employment', 'A job.'].join('\n'))
    expect(out.map((x) => x.heading)).toEqual(['Employment'])
  })
})

describe('packing the sections into passes', () => {
  it('puts small sections together rather than one call each', () => {
    // A CV has a two-line Languages section and a nine-page publication list.
    // One round trip per heading spends six of them on sections that fit in one.
    const cv = ['## A', 'short', '## B', 'short', '## C', 'short'].join('\n')
    expect(cvPasses(cv, 1000)).toHaveLength(1)
  })

  it('splits a section that is longer than the budget, and says so', () => {
    /*
     * A model handed the middle of a publication list without being told it is
     * the middle notes that the list "appears to begin mid-way" — which is true
     * and not what was asked.
     */
    const long = Array.from({ length: 40 }, (_, i) => `Paper number ${String(i)}.`).join('\n\n')
    const out = cvPasses(`## Publications\n${long}`, 200)
    expect(out.length).toBeGreaterThan(1)
    expect(out.every((p) => p.partial)).toBe(true)
    expect(out[0]?.label).toContain('part 1')
  })

  it('cuts a long section at a blank line, not mid-entry', () => {
    // A publication whose title lands in one pass and whose venue lands in the
    // next is worse than either half alone.
    const long = ['## Publications', 'First paper.', '', 'Second paper.', '', 'Third paper.'].join('\n')
    for (const pass of cvPasses(long, 30)) {
      expect(pass.text).not.toMatch(/\bpape$/)
    }
  })

  it('opens a new pass rather than overflowing the budget', () => {
    /*
     * The packing rule itself. Without it every section lands in one pass, the
     * request is however long the CV is, and the whole point of sectioning —
     * asking a model for everything in something it can hold — is lost at the
     * last step.
     */
    const cv = ['## A', 'x'.repeat(80), '## B', 'y'.repeat(80), '## C', 'z'.repeat(80)].join('\n')
    expect(cvPasses(cv, 100).length).toBeGreaterThan(1)
  })

  it('returns nothing for a document with nothing in it', () => {
    // Not reachable from the reader, which rejects anything this short — but
    // an empty list is the honest answer and a section of empty text is not.
    expect(cvPasses('   \n  \n ', 100)).toEqual([])
  })

  it('covers the whole document across the passes', () => {
    // The property that matters most and the one a packing bug breaks silently:
    // a section quietly dropped is a section never read.
    const cv = ['## Education', 'PhD MIT', '## Employment', 'Cloudflare', '## Skills', 'Rust'].join(
      '\n',
    )
    const joined = cvPasses(cv, 40)
      .map((p) => p.text)
      .join('\n')
    for (const fragment of ['PhD MIT', 'Cloudflare', 'Rust']) expect(joined).toContain(fragment)
  })
})

describe('merging what the passes found', () => {
  const entry = (over: Partial<BackgroundDraft>): BackgroundDraft => ({
    kind: 'employment',
    title: 'Staff Engineer',
    where: 'Cloudflare',
    ...over,
  })

  it('files one entry once, however many passes saw it', () => {
    /*
     * The same job appears under "Positions" with its dates and again in a
     * summary without them. Keyed on the period, that is two records of one
     * job — and every entry a well-organised CV mentions twice would double.
     */
    const merged = mergeBackground([[entry({ period: '2024–' })], [entry({})]])
    expect(merged).toHaveLength(1)
  })

  it('keeps the first sighting, which is the fuller one', () => {
    // Passes run in document order, so the first sighting is the one in the
    // section that is about it — where the dates and the bullets are.
    const merged = mergeBackground([
      [entry({ period: '2024–', highlights: ['Ran a store'] })],
      [entry({})],
    ])
    expect(merged[0]?.highlights).toEqual(['Ran a store'])
  })

  it('does not merge two different kinds that share a title', () => {
    // "Distributed Systems" is a course taught and a skill held, and they are
    // different claims about a person.
    const merged = mergeBackground([
      [{ kind: 'teaching', title: 'Distributed Systems' }, { kind: 'skill', title: 'Distributed Systems' }],
    ])
    expect(merged).toHaveLength(2)
  })

  it('ignores case and spacing when deciding what is the same', () => {
    const merged = mergeBackground([
      [entry({ title: 'Staff Engineer', where: 'Cloudflare' })],
      [entry({ title: 'staff  engineer', where: 'CLOUDFLARE' })],
    ])
    expect(merged).toHaveLength(1)
  })
})

describe('the second look', () => {
  it('shows what was found so the model returns only what was not', () => {
    const messages = missedMessages('CV.pdf', 'A CV.', [
      { kind: 'education', title: 'PhD, Computer Science', where: 'MIT' },
    ])
    expect(messages[1]?.content).toContain('PhD, Computer Science')
    expect(messages[1]?.content).toContain('MIT')
  })

  it('tells the model that finding nothing is a correct answer', () => {
    /*
     * Without this the pass invents. A model asked "what did the extraction
     * miss" and given no way to say "nothing" will find something, and what it
     * finds is a claim about a real person that the document never made.
     */
    const system = String(missedMessages('CV.pdf', 'A CV.', [])[0]?.content)
    expect(system).toMatch(/common and\s+correct answer/)
    expect(system).toMatch(/do not manufacture/i)
  })

  it('copes with an extraction that found nothing at all', () => {
    const messages = missedMessages('CV.pdf', 'A CV.', [])
    expect(messages[1]?.content).toContain('(nothing was found)')
  })
})

describe('the guidance the models actually needed', () => {
  const guidanceFor = (kind: Parameters<typeof cvMessages>[2]) =>
    String(cvMessages('doc.pdf', { label: 'x', text: 'x', partial: false }, kind)[0]?.content)

  it('tells a cover letter reader what to TAKE, not only what to leave', () => {
    /*
     * Measured, not guessed. The first version was three paragraphs of warning
     * and one line of permission, and against real models all three
     * under-extracted — one returned nothing at all from a letter containing
     * three plain statements about the person. A guard that strong stops being
     * a guard and becomes a refusal.
     *
     * Both halves are asserted because losing either is a different failure and
     * both are silent: without the warning it files the employer's work, and
     * without the permission it files nothing.
     */
    const say = guidanceFor('cover-letter')
    expect(say).toMatch(/WHAT TO TAKE/)
    expect(say).toMatch(/WHAT TO LEAVE/)
    expect(say).toMatch(/Returning nothing is as wrong/)
    expect(say).toMatch(/subject is the reader/)
  })

  it('says a sum of money makes it a grant whatever it is called', () => {
    /*
     * "EPSRC New Investigator Award, £412,000" was missed by two of three
     * models, both filing it as an award — which the name plainly invites. The
     * distinction matters: for a researcher the money is the thing a search
     * committee counts, and an award and a grant are different claims.
     */
    expect(guidanceFor('cv')).toMatch(/sum of money in it is a grant/)
  })
})

describe('how the facts relate', () => {
  const entries: BackgroundDraft[] = [
    { kind: 'employment', title: 'Postdoctoral Researcher', where: 'ETH Zürich' },
    { kind: 'project', title: 'Aurelia' },
    { kind: 'skill', title: 'Distributed systems' },
  ]

  it('numbers the facts, because a model cannot copy a uuid', () => {
    /*
     * The reason `RelationDraft` holds positions rather than ids. The records
     * do not have ids yet — nothing is written until the person approves — and
     * asking a model to copy a uuidv7 twice per relation is asking for the one
     * thing models reliably get wrong.
     */
    const say = String(relationMessages('CV.pdf', 'A CV.', entries)[1]?.content)
    expect(say).toContain('1. employment: Postdoctoral Researcher')
    expect(say).toContain('2. project: Aurelia')
  })

  it('asks for plain words rather than a schema name', () => {
    // The taxonomy maps them afterwards. A model guessing at codes returns
    // `EVIDENCE_OF` and `hasEvidence` and neither is in the table, so both
    // become open predicates for a relation the taxonomy plainly covers.
    const system = String(relationMessages('CV.pdf', 'x', entries)[0]?.content)
    expect(system).toMatch(/plain words/)
    expect(system).toMatch(/do not try to guess a\s+code or a schema name/i)
  })

  it('tells the model that no relations is a correct answer', () => {
    // Without it the pass invents. A plain list of dates genuinely states none.
    const system = String(relationMessages('CV.pdf', 'x', entries)[0]?.content)
    expect(system).toMatch(/common and\s+correct answer/)
  })

  it('reads a relation into positions', () => {
    const out = readRelations(
      JSON.stringify({ relations: [{ subject: 2, predicate: 'is evidence of', object: 3 }] }),
      3,
    )
    expect(out).toEqual([{ subject: 1, predicate: 'is evidence of', object: 2 }])
  })

  it('drops a relation naming a fact that is not on the list', () => {
    /*
     * Dropped rather than clamped to the nearest entry. A model returning
     * `object: 40` for a list of three has lost track of the list, and pointing
     * that relation at entry three would invent a fact rather than lose one.
     */
    expect(readRelations(JSON.stringify({ relations: [{ subject: 1, predicate: 'x', object: 40 }] }), 3)).toEqual([])
    expect(readRelations(JSON.stringify({ relations: [{ subject: 0, predicate: 'x', object: 2 }] }), 3)).toEqual([])
  })

  it('drops a fact related to itself', () => {
    expect(readRelations(JSON.stringify({ relations: [{ subject: 1, predicate: 'x', object: 1 }] }), 3)).toEqual([])
  })

  it('proposes one pair once, however many ways the model said it', () => {
    // A model listing "A built B" and "B was built by A" in one answer is
    // describing one relation twice, and the store's own gate should not have
    // to be the first thing that notices.
    const out = readRelations(
      JSON.stringify({
        relations: [
          { subject: 1, predicate: 'built', object: 2 },
          { subject: 2, predicate: 'was built by', object: 1 },
        ],
      }),
      3,
    )
    expect(out).toHaveLength(1)
  })

  it('returns nothing rather than throwing on a reply that is not JSON', () => {
    // The relations pass is an improvement on top of a reading that already
    // succeeded. Its failure must cost the relations and never the entries.
    expect(readRelations('I could not work that out.', 3)).toEqual([])
    expect(readRelations(JSON.stringify({ relations: 'none' }), 3)).toEqual([])
  })
})
