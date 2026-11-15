/**
 * Owner request Q218: a write tool's announcement names the record it changes.
 *
 * `describe()` is the approval card, the toast and the journal row at once. A
 * card reading "Moved" or "Note saved" over a run of six steps is not a
 * decision anybody can make, and an audit log of anonymous rows cannot answer
 * "which record changed by itself". The review that raised this counted about
 * six write tools whose `describe` named nothing.
 *
 * EVERY WRITE TOOL. Measured 2026-11-15 against the whole catalog: the 40
 * that change one existing record are in `CASES`, every other write — the
 * creates, the profile, the conversations' and pipelines' own bookkeeping — is
 * in `OTHERS`, and the four that change no single record (a batch counted, or
 * the whole store) are in `NO_SINGLE_RECORD` with the reason. The last test
 * fails if a tool is added to `TOOLS` without being placed in one of the
 * three, so a new write cannot ship announcing nothing in particular.
 *
 * Seven of the 40 were the gap the review found and named nothing until this
 * pass: `timeline.item.remind.set` ("Added to Reminders"),
 * `vault.link.recategorise`, `vault.file.move` and `vault.snippet.retag`
 * ("Moved to …"), `vault.file.note.set` ("Note saved"), `assistant.thread.file`
 * ("Filed under the application") and `assistant.thread.auto.set` (the mode
 * sentence alone, on a card that raises the agent's own permission).
 *
 * Asserted through `runtime.run`, so the string checked is the one the person
 * actually sees: the announcement the runtime builds from `describe` against
 * the staged overlay. Each record carries a name distinctive enough that a
 * generic title ("Saved", "Removed") cannot pass by accident.
 */

import { describe, expect, it } from 'vitest'
import { itemsOf } from '../core/checklist'
import type { NodeId } from '../core/model'
import { MutableSnapshot } from '../core/snapshot'
import { createRepository } from '../repo/repository'
import { TOOLS } from './index'
import { createToolRuntime } from './runtime'

type Options = Parameters<typeof createRepository>[0]

const nullDriver = (): Options['driver'] => ({
  open: async () => ({ ok: true, value: { version: 1, from: 0, migrated: [], crossTab: false } }),
  readAll: async () => ({ ok: true, value: { nodes: [], edges: [], meta: [], ops: [] } }),
  commit: async () => ({ ok: true, value: undefined }),
  replace: async () => ({ ok: true, value: undefined }),
  seedIfPristine: async () => ({ ok: true, value: true }),
  destroy: async () => ({ ok: true, value: undefined }),
  onRemoteCommit: () => () => {},
  onBlocking: () => () => {},
  close: () => {},
})

const START = Date.parse('2026-10-12T15:00:00.000Z')

function harness() {
  let tick = 0
  const now = () => new Date(START + tick++ * 1000).toISOString()
  const repo = createRepository({
    driver: nullDriver(),
    snapshot: new MutableSnapshot(),
    meta: {
      schemaVersion: 1,
      createdAt: new Date(START).toISOString(),
      lastOpenedAt: new Date(START).toISOString(),
      dataSet: 'empty',
      seededAt: null,
      handoverAt: null,
    },
    now,
  })
  return { repo, runtime: createToolRuntime({ repo, now }) }
}

type H = ReturnType<typeof harness>

const okOr = <T>(
  result: { ok: true; output: T } | { ok: false; errors: readonly { message: string }[] },
): T => {
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '))
  return result.output
}

const run = (h: H, tool: string, input: unknown) => okOr(h.runtime.run(tool as never, input as never))

/** What a person reads about one write: the card's title and its line beneath. */
function announced(h: H, tool: string, input: unknown): string {
  const result = h.runtime.run(tool as never, input as never)
  if (!result.ok) throw new Error(`${tool}: ${result.errors.map((e) => e.message).join('; ')}`)
  return `${result.announcement.title} ${result.announcement.description ?? ''}`
}

/** Each case builds its own record, so one tool's write cannot name another's. */
type Case = readonly [tool: string, setup: (h: H) => unknown, name: string]

const anApplication = (h: H) =>
  run(h, 'application.create', {
    org: 'Wellesley',
    role: 'Quantitative ecology',
    roleTag: 'Assistant Professor',
    stage: 'draft',
  })
const aKeyword = (h: H) => run(h, 'keyword.create', { name: 'Referral-lead' })
const anItem = (h: H) =>
  run(h, 'timeline.item.create', { title: 'Wellesley campus visit', date: '2026-11-15', kind: 'deadline' })
const aLink = (h: H) =>
  run(h, 'vault.link.save', { title: 'Wellesley posting page', url: 'https://jobs.example/1', category: 'Posting' })
const aFile = (h: H) =>
  (run(h, 'vault.file.add', {
    files: [{ name: 'Teaching-portfolio.pdf', kind: 'pdf', bucket: 'Applications', size: '212 KB' }],
  }) as string[])[0]
const aSnippet = (h: H) =>
  run(h, 'vault.snippet.create', { title: 'Why this department', tag: 'Cover letter', body: 'Because…' })
const aPerson = (h: H) => run(h, 'vault.person.create', { name: 'Imogen Okafor' })
const aSticky = (h: H) => run(h, 'sticky.note.create', { text: 'Ask Imogen about the visa letter' })
const aThread = (h: H) => run(h, 'assistant.thread.create', { title: 'Tidy the Wellesley file' })
const aPipeline = (h: H) =>
  run(h, 'scout.pipeline.create', {
    name: 'Academic ecology',
    source: 'HigherEdJobs',
    schedule: 'Daily',
    filter: 'assistant professor',
  })
const aMatch = (h: H) => run(h, 'scout.match.save', { role: 'Lecturer in ecology', detail: 'Rice', fit: 70 })
const aPosting = (h: H) =>
  run(h, 'scout.posting.save', { title: 'Field ecologist', url: 'https://jobs.example/2' })

const APP = 'Wellesley'

const CASES: readonly Case[] = [
  ['application.note.set', (h) => ({ id: anApplication(h), note: 'Ask about lab space' }), APP],
  ['application.flag.set', (h) => ({ id: anApplication(h), flagged: true }), APP],
  ['application.stage.set', (h) => ({ id: anApplication(h), stage: 'submitted' }), APP],
  ['application.duplicate', (h) => ({ id: anApplication(h) }), APP],
  ['application.delete', (h) => ({ id: anApplication(h) }), APP],
  ['keyword.tone.set', (h) => ({ id: aKeyword(h), tone: 'amber' }), 'Referral-lead'],
  ['keyword.delete', (h) => ({ id: aKeyword(h) }), 'Referral-lead'],
  ['timeline.item.update', (h) => ({ id: anItem(h), date: '2026-11-20' }), 'Wellesley campus visit'],
  ['timeline.item.complete', (h) => ({ id: anItem(h) }), 'Wellesley campus visit'],
  ['timeline.item.snooze', (h) => ({ id: anItem(h), days: 3 }), 'Wellesley campus visit'],
  ['timeline.item.reschedule', (h) => ({ id: anItem(h), date: '2026-12-01' }), 'Wellesley campus visit'],
  ['timeline.item.duplicate', (h) => ({ id: anItem(h) }), 'Wellesley campus visit'],
  ['timeline.item.delete', (h) => ({ id: anItem(h) }), 'Wellesley campus visit'],
  ['vault.link.update', (h) => ({ id: aLink(h), url: 'https://jobs.example/9' }), 'Wellesley posting page'],
  ['vault.link.delete', (h) => ({ id: aLink(h) }), 'Wellesley posting page'],
  ['vault.link.duplicate', (h) => ({ id: aLink(h) }), 'Wellesley posting page'],
  ['vault.file.update', (h) => ({ id: aFile(h), size: '300 KB' }), 'Teaching-portfolio.pdf'],
  ['vault.file.delete', (h) => ({ id: aFile(h) }), 'Teaching-portfolio.pdf'],
  ['vault.snippet.update', (h) => ({ id: aSnippet(h), body: 'Rewritten.' }), 'Why this department'],
  ['vault.snippet.delete', (h) => ({ id: aSnippet(h) }), 'Why this department'],
  ['vault.snippet.duplicate', (h) => ({ id: aSnippet(h) }), 'Why this department'],
  ['vault.person.update', (h) => ({ id: aPerson(h), note: 'Chair' }), 'Imogen Okafor'],
  ['vault.person.delete', (h) => ({ id: aPerson(h) }), 'Imogen Okafor'],
  ['sticky.note.update', (h) => ({ id: aSticky(h), text: 'Ask Imogen about the visa letter today' }), 'Ask Imogen'],
  ['sticky.note.delete', (h) => ({ id: aSticky(h) }), 'Ask Imogen'],
  ['assistant.thread.delete', (h) => ({ id: aThread(h) }), 'Tidy the Wellesley file'],
  ['scout.pipeline.update', (h) => ({ id: aPipeline(h), filter: 'lecturer' }), 'Academic ecology'],
  ['scout.pipeline.enable.set', (h) => ({ id: aPipeline(h), enabled: false }), 'Academic ecology'],
  ['scout.pipeline.delete', (h) => ({ id: aPipeline(h) }), 'Academic ecology'],
  ['scout.match.update', (h) => ({ id: aMatch(h), fit: 80 }), 'Lecturer in ecology'],
  ['scout.match.dismiss', (h) => ({ id: aMatch(h) }), 'Lecturer in ecology'],
  ['scout.posting.update', (h) => ({ id: aPosting(h), note: 'Looks good' }), 'Field ecologist'],
  ['scout.posting.delete', (h) => ({ id: aPosting(h) }), 'Field ecologist'],
  // The seven that named nothing before Q218 was closed.
  ['timeline.item.remind.set', (h) => ({ id: anItem(h), remind: true }), 'Wellesley campus visit'],
  ['vault.link.recategorise', (h) => ({ id: aLink(h), category: 'Institution' }), 'Wellesley posting page'],
  ['vault.file.move', (h) => ({ id: aFile(h), bucket: 'To read' }), 'Teaching-portfolio.pdf'],
  ['vault.file.note.set', (h) => ({ id: aFile(h), note: 'v4 tightens the teaching section' }), 'Teaching-portfolio.pdf'],
  ['vault.snippet.retag', (h) => ({ id: aSnippet(h), tag: 'Email' }), 'Why this department'],
  ['assistant.thread.file', (h) => ({ id: aThread(h), applicationId: anApplication(h) }), 'Tidy the Wellesley file'],
  ['assistant.thread.auto.set', (h) => ({ id: aThread(h), mode: 'auto' }), 'Tidy the Wellesley file'],
]

const aTwinPipeline = (h: H) =>
  run(h, 'scout.pipeline.create', {
    name: 'Tidy the graph',
    source: '—',
    schedule: 'daily',
    filter: '—',
    kind: 'twin',
  })
const aProposal = (h: H) =>
  run(h, 'pipeline.proposal.raise', {
    pipelineId: aTwinPipeline(h),
    kind: 'twin',
    tool: 'application.note.set',
    input: JSON.stringify({ id: anApplication(h), note: 'Deadline is a Friday.' }),
    title: 'Note the Wellesley deadline falls on a Friday',
    rationale: 'Nothing records that it is a weekend.',
  })
const aPostingProposal = (h: H) =>
  run(h, 'pipeline.proposal.raise', {
    pipelineId: run(h, 'scout.pipeline.create', {
      name: 'Academic ecology',
      source: 'HigherEdJobs',
      schedule: 'daily',
      filter: '—',
      kind: 'scout',
    }),
    kind: 'scout',
    tool: 'scout.posting.save',
    input: JSON.stringify({ url: 'https://jobs.example/3' }),
    title: 'Save the Wellesley ecology posting',
    rationale: '',
  })
const aBackground = (h: H, title = 'Bayesian hierarchical models') =>
  (run(h, 'profile.background.add', { background: [{ kind: 'skill', title }] }) as { ids: NodeId[] }).ids[0]
const anOffer = (h: H) => {
  const id = anApplication(h)
  run(h, 'application.stage.advance', { id, stage: 'offer', offer: { respondBy: '2026-12-01', note: 'x' } })
  return id
}
const aStep = (h: H) => {
  const id = anApplication(h) as NodeId
  run(h, 'application.checklist.item.add', { id, text: 'Order the Wellesley transcript' })
  const itemId = itemsOf(h.repo.getSnapshot().node(id, 'application')?.props.checklist)[0]?.id
  return { id, itemId }
}

/**
 * Every other write: the creates, which name what they made, and the
 * bookkeeping writes, which name the record they keep.
 */
const OTHERS: readonly Case[] = [
  ['application.create', () => ({ org: 'Wellesley', role: 'Ecology', roleTag: 'Lecturer', stage: 'draft' }), APP],
  ['application.update', (h) => ({ id: anApplication(h), note: 'Lab space' }), APP],
  ['application.stage.advance', (h) => ({ id: anApplication(h), stage: 'submitted' }), APP],
  ['application.offer.decide', (h) => ({ id: anOffer(h), outcome: 'accepted' }), APP],
  ['application.offer.clear', (h) => ({ id: anOffer(h) }), APP],
  ['org.ensure', () => ({ name: 'Smith College' }), 'Smith College'],
  ['timeline.item.create', () => ({ title: 'Wellesley campus visit', date: '2026-11-15', kind: 'deadline' }), 'Wellesley campus visit'],
  ['timeline.item.reopen', (h) => {
    const id = anItem(h)
    run(h, 'timeline.item.complete', { id })
    return { id }
  }, 'Wellesley campus visit'],
  ['vault.link.save', () => ({ title: 'Wellesley posting page', url: 'https://jobs.example/1', category: 'Posting' }), 'Wellesley posting page'],
  ['vault.file.add', () => ({ files: [{ name: 'Teaching-portfolio.pdf', kind: 'pdf', bucket: 'Applications', size: '212 KB' }] }), 'Teaching-portfolio.pdf'],
  ['vault.person.create', () => ({ name: 'Imogen Okafor' }), 'Imogen Okafor'],
  ['vault.person.file', (h) => ({ id: aPerson(h), applicationId: anApplication(h) }), 'Imogen Okafor'],
  ['vault.person.unfile', (h) => {
    const id = aPerson(h)
    const applicationId = anApplication(h)
    run(h, 'vault.person.file', { id, applicationId })
    return { id, applicationId }
  }, 'Imogen Okafor'],
  ['vault.snippet.create', () => ({ title: 'Why this department', tag: 'Cover letter', body: 'Because…' }), 'Why this department'],
  ['sticky.note.create', () => ({ text: 'Ask Imogen about the visa letter' }), 'Ask Imogen'],
  ['keyword.create', () => ({ name: 'Referral-lead' }), 'Referral-lead'],
  ['keyword.rename', (h) => ({ id: aKeyword(h), name: 'Offer-pending' }), 'Offer-pending'],
  ['keyword.attach', (h) => ({ record: anApplication(h), keyword: aKeyword(h) }), APP],
  ['keyword.detach', (h) => {
    const record = anApplication(h)
    const keyword = aKeyword(h)
    run(h, 'keyword.attach', { record, keyword })
    return { record, keyword }
  }, APP],
  ['keyword.record.set', (h) => ({ record: anApplication(h), keywords: [aKeyword(h)] }), APP],
  ['scout.posting.save', () => ({ title: 'Field ecologist', url: 'https://jobs.example/2' }), 'Field ecologist'],
  ['scout.posting.promote', (h) => ({ id: aPosting(h) }), 'Field ecologist'],
  ['scout.match.save', () => ({ role: 'Lecturer in ecology', detail: 'Rice', fit: 70 }), 'Lecturer in ecology'],
  ['scout.match.promote', (h) => ({ id: aMatch(h) }), 'Lecturer in ecology'],
  ['scout.pipeline.create', () => ({ name: 'Academic ecology', source: 'HigherEdJobs', schedule: 'Daily', filter: 'x' }), 'Academic ecology'],
  // The profile is one record, and "Profile" is its name.
  ['profile.set', () => ({ matchTerms: ['population dynamics'] }), 'Profile'],
  ['profile.text.set', () => ({ field: 'fullName', value: 'A. Mitra' }), 'Profile'],
  ['profile.matchTerm.add', () => ({ term: 'population dynamics' }), 'population dynamics'],
  ['profile.matchTerm.remove', (h) => {
    run(h, 'profile.matchTerm.add', { term: 'population dynamics' })
    return { term: 'population dynamics' }
  }, 'population dynamics'],
  ['profile.preference.set', () => ({ key: 'includeIndustry', value: false }), 'Industry postings'],
  ['profile.document.add', () => ({ files: [{ name: 'Research-statement.pdf', kind: 'pdf', size: '90 KB' }] }), 'Research-statement.pdf'],
  ['profile.background.add', () => ({ background: [{ kind: 'skill', title: 'Bayesian hierarchical models' }] }), 'Bayesian hierarchical models'],
  ['profile.background.import', () => ({ background: [{ kind: 'skill', title: 'Bayesian hierarchical models' }] }), 'Bayesian hierarchical models'],
  ['profile.background.update', (h) => ({ id: aBackground(h), title: 'Bayesian hierarchical models (Stan)' }), 'Bayesian hierarchical models'],
  ['profile.background.delete', (h) => ({ id: aBackground(h) }), 'Bayesian hierarchical models'],
  ['claim.add', (h) => ({ subject: aBackground(h), predicate: 'is evidence of', object: aBackground(h, 'Ecology') }), 'Bayesian hierarchical models'],
  ['fit.reading.set', (h) => ({ fileId: aFile(h), requirements: [{ text: 'PhD', essential: true }], model: 'm' }), 'Teaching-portfolio.pdf'],
  ['fit.reading.clear', (h) => {
    const fileId = aFile(h)
    run(h, 'fit.reading.set', { fileId, requirements: [{ text: 'PhD', essential: true }], model: 'm' })
    return { fileId }
  }, 'Teaching-portfolio.pdf'],
  // The snippet is named after the application it was tailored for, and the
  // line says which one; that is how the tailoring card finds it again.
  ['tailor.snippet.create', (h) => ({
    applicationId: anApplication(h),
    source: 'file:0192-cv',
    kind: 'cv',
    model: 'm',
    title: 'CV — Wellesley',
    tag: 'CV',
    body: 'Ecologist.',
  }), APP],
  ['application.checklist.draft.add', (h) => ({ id: anApplication(h), items: [{ text: 'Order a transcript' }], model: 'm' }), APP],
  ['application.checklist.item.add', (h) => ({ id: anApplication(h), text: 'Order the Wellesley transcript' }), APP],
  ['application.checklist.item.set', (h) => ({ ...aStep(h), done: true }), 'Order the Wellesley transcript'],
  ['application.checklist.item.remove', (h) => aStep(h), 'Order the Wellesley transcript'],
  ['assistant.thread.create', () => ({ title: 'Tidy the Wellesley file' }), 'Tidy the Wellesley file'],
  ['assistant.thread.set', (h) => ({ id: aThread(h), entries: [] }), 'Tidy the Wellesley file'],
  ['assistant.thread.rename', (h) => ({ id: aThread(h), title: 'Tidy the Smith file' }), 'Tidy the Smith file'],
  ['assistant.thread.context.set', (h) => ({ id: aThread(h), context: 'Earlier: the visa letter.', through: 0 }), 'Tidy the Wellesley file'],
  ['pipeline.proposal.raise', (h) => ({
    pipelineId: aTwinPipeline(h),
    kind: 'twin',
    tool: 'application.note.set',
    input: JSON.stringify({ id: anApplication(h), note: 'Deadline is a Friday.' }),
    title: 'Note the Wellesley deadline falls on a Friday',
    rationale: 'Nothing records that it is a weekend.',
  }), 'Note the Wellesley deadline'],
  ['pipeline.proposal.approve', (h) => ({ id: aProposal(h) }), 'Note the Wellesley deadline'],
  ['pipeline.proposal.discard', (h) => ({ id: aProposal(h) }), 'Note the Wellesley deadline'],
  ['pipeline.proposal.fail', (h) => ({ id: aProposal(h), error: 'That record is no longer here.' }), 'Note the Wellesley deadline'],
  ['pipeline.proposal.reading.set', (h) => ({
    id: aPostingProposal(h),
    reading: JSON.stringify({ ok: true, fields: { org: 'Wellesley College' } }),
  }), 'Save the Wellesley ecology posting'],
  ['pipeline.run.record', (h) => ({ id: aTwinPipeline(h), raised: 0 }), 'Tidy the graph'],
]

/**
 * The writes that change no ONE record, so there is no name to give: each says
 * how many instead, or what happened to the whole store.
 */
const NO_SINGLE_RECORD: Readonly<Record<string, string>> = {
  'pipeline.proposal.clear': 'empties the whole queue, announced as a count',
  'pipeline.proposal.sweep': "takes one pipeline's answered cards off, announced as a count",
  'memory.reset': 'replaces the whole store with the demo data',
  'memory.clear': 'empties the whole store',
}

describe('what a write tool announces', () => {
  for (const [tool, setup, name] of [...CASES, ...OTHERS]) {
    it(`names the record it changed: ${tool}`, () => {
      const h = harness()
      const input = setup(h)
      expect(announced(h, tool, input)).toContain(name)
    })
  }

  it('covers the 40 that change one existing record', () => {
    expect(CASES).toHaveLength(40)
  })

  it('leaves no write tool in the catalog unnamed or unaccounted for', () => {
    const placed = [...CASES, ...OTHERS].map(([tool]) => tool).concat(Object.keys(NO_SINGLE_RECORD))
    // Each once: a tool listed twice is a copy-paste that hid a missing one.
    expect(new Set(placed).size).toBe(placed.length)
    expect([...placed].sort()).toEqual(Object.keys(TOOLS).sort())
  })
})
