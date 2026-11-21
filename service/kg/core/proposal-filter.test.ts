/**
 * The suggestions queue's search, filters and active/closed split (Q343).
 * Both apps draw their queue from these functions, so the rules are pinned
 * here once rather than in either app's components.
 */
import { describe, expect, it } from 'vitest'
import {
  NO_PROPOSAL_FILTER,
  filterCount,
  isActiveProposal,
  isFiltering,
  proposalFacets,
  proposalFacts,
  proposalMatches,
  splitProposals,
  toggleFilter,
} from './proposal-filter'
import type { ProposalFilter } from './proposal-filter'
import type { Proposal } from './model-scout'

let n = 0
const card = (over: Partial<Proposal> & { org?: string; location?: string; summary?: string } = {}): Proposal => {
  const { org, location, summary, ...rest } = over
  n += 1
  return {
    id: `prop:${String(n)}`,
    pipelineId: 'pipe:1',
    kind: 'scout',
    tool: 'scout.posting.save',
    input: JSON.stringify({
      url: `https://jobs.example.edu/postings/${String(n)}`,
      title: 'Assistant Professor',
      ...(summary ? { summary } : {}),
      ...(org ? { org } : {}),
      ...(location ? { location } : {}),
    }),
    title: 'Assistant Professor of Computer Science',
    rationale: 'Matches your machine learning research.',
    status: 'pending',
    proposedAt: '2026-11-20T09:00:00Z',
    ...rest,
  } as Proposal
}
const reading = (fields: Record<string, string>, keywords: { id: string; name: string }[] = []) =>
  JSON.stringify({ ok: true, fields, keywords, missing: [], via: 'reader', readAt: '2026-11-20T09:01:00Z' })

const facts = (p: Proposal, pipeline = 'Faculty search') => proposalFacts(p, pipeline)
const filter = (over: Partial<ProposalFilter>): ProposalFilter => ({ ...NO_PROPOSAL_FILTER, ...over })

describe('which suggestions still need the person', () => {
  it('keeps a pending card active, and closes a discarded or failed one', () => {
    expect(isActiveProposal(card())).toBe(true)
    expect(isActiveProposal(card({ status: 'discarded' }))).toBe(false)
    expect(isActiveProposal(card({ status: 'failed', error: 'no' }))).toBe(false)
  })

  it('keeps an approved job active until it is in the applications, then closes it', () => {
    const approved = card({ status: 'approved' })
    expect(isActiveProposal(approved, { applicationId: undefined })).toBe(true)
    expect(isActiveProposal(approved, { applicationId: 'app:7' })).toBe(false)
    // Nothing findable to add, or nobody offering the second step.
    expect(isActiveProposal(approved, null)).toBe(false)
  })

  it('closes an approved change to a record: there is no second step after it', () => {
    expect(isActiveProposal(card({ status: 'approved', tool: 'reminder.add' }), {})).toBe(false)
  })

  it('splits the queue in order, asking about a job only for an approved card', () => {
    const asked: string[] = []
    const queue = [
      card({ status: 'discarded' }),
      card(),
      card({ status: 'approved' }),
      card({ status: 'approved' }),
    ]
    const { active, closed } = splitProposals(queue, (p) => {
      asked.push(p.id)
      return p === queue[2] ? {} : { applicationId: 'app:1' }
    })
    expect(active).toEqual([queue[1], queue[2]])
    expect(closed).toEqual([queue[0], queue[3]])
    expect(asked).toEqual([queue[2]!.id, queue[3]!.id])
  })
})

describe('searching the suggestions', () => {
  it('finds a card by any word on it, whatever the case or accents', () => {
    const p = card({
      org: 'Universidad de Bogotá',
      location: 'Bogotá, Colombia',
      summary: 'Tenure-track post in robotics.',
    })
    for (const q of ['ROBOTICS', 'bogota', 'universidad', 'faculty search', 'machine learning'])
      expect(proposalMatches(facts(p), filter({ query: q })), q).toBe(true)
    expect(proposalMatches(facts(p), filter({ query: 'chemistry' }))).toBe(false)
  })

  it('needs every word, but in any field: a role in one place and a city in another', () => {
    const p = card({ reading: reading({ role: 'Postdoctoral Fellow', location: 'Boston, MA' }) })
    expect(proposalMatches(facts(p), filter({ query: 'postdoctoral boston' }))).toBe(true)
    expect(proposalMatches(facts(p), filter({ query: 'postdoctoral chicago' }))).toBe(false)
  })

  it('searches the keywords the posting matched and what a record change would write', () => {
    const p = card({ reading: reading({}, [{ id: 'label:ml', name: 'Deep learning' }]) })
    expect(proposalMatches(facts(p), filter({ query: 'deep learning' }))).toBe(true)
    const note = card({ tool: 'note.add', input: JSON.stringify({ text: 'Ask about the visa' }) })
    expect(proposalMatches(facts(note), filter({ query: 'visa' }))).toBe(true)
  })

  it('treats an empty or blank search as no search', () => {
    expect(proposalMatches(facts(card()), filter({ query: '   ' }))).toBe(true)
    expect(isFiltering(filter({ query: '   ' }))).toBe(false)
  })
})

describe('filtering the suggestions', () => {
  const postdoc = card({
    pipelineId: 'pipe:1',
    reading: reading({ roleTag: 'Postdoc', org: 'MIT' }, [{ id: 'label:ml', name: 'ML' }]),
  })
  const faculty = card({
    pipelineId: 'pipe:2',
    org: 'mit',
    reading: reading({ roleTag: 'Faculty' }, [{ id: 'label:hci', name: 'HCI' }]),
  })
  const match = card({ pipelineId: 'pipe:2', tool: 'scout.match.save' })
  const all = [postdoc, faculty, match].map((p) => facts(p))
  const shown = (f: ProposalFilter) => all.filter((x) => proposalMatches(x, f)).length

  it('filters by role tag, keyword, employer, pipeline and type', () => {
    expect(shown(filter({ roleTags: ['postdoc'] }))).toBe(1)
    expect(shown(filter({ keywords: ['label:hci'] }))).toBe(1)
    // The page's employer, or the scout's own when the page was not read; folded.
    expect(shown(filter({ employers: ['MIT'] }))).toBe(2)
    expect(shown(filter({ pipelines: ['pipe:2'] }))).toBe(2)
    expect(shown(filter({ types: ['match'] }))).toBe(1)
  })

  it('widens within a category and narrows across them', () => {
    expect(shown(filter({ roleTags: ['Postdoc', 'Faculty'] }))).toBe(2)
    expect(shown(filter({ roleTags: ['Postdoc', 'Faculty'], pipelines: ['pipe:2'] }))).toBe(1)
  })

  it('counts what is picked, and turns a value off where it was turned on', () => {
    let f = toggleFilter(NO_PROPOSAL_FILTER, 'roleTags', 'Postdoc')
    f = toggleFilter(f, 'types', 'match')
    expect(filterCount(f)).toBe(2)
    expect(isFiltering(f)).toBe(true)
    f = toggleFilter(f, 'roleTags', 'Postdoc')
    expect(f.roleTags).toEqual([])
    expect(filterCount(f)).toBe(1)
  })

  it('offers only the values some card carries, most common first, types in a fixed order', () => {
    const facets = proposalFacets(all, NO_PROPOSAL_FILTER, (id) => `name of ${id}`, (t) => t)
    expect(facets.pipelines.map((v) => [v.value, v.label, v.count])).toEqual([
      ['pipe:2', 'name of pipe:2', 2],
      ['pipe:1', 'name of pipe:1', 1],
    ])
    expect(facets.types.map((v) => v.value)).toEqual(['posting', 'match'])
    expect(facets.roleTags.map((v) => v.label)).toEqual(['Faculty', 'Postdoc'])
    expect(facets.employers.map((v) => [v.label, v.count])).toEqual([['MIT', 2]])
    expect(facets.keywords.map((v) => [v.value, v.label])).toEqual([
      ['label:hci', 'HCI'],
      ['label:ml', 'ML'],
    ])
  })

  it('keeps a picked value listed after its last card has gone, so it can be turned off', () => {
    const facets = proposalFacets([], filter({ roleTags: ['Lecturer'], keywords: ['label:gone'] }), (id) => id, (t) => t)
    expect(facets.roleTags).toEqual([{ value: 'Lecturer', label: 'Lecturer', count: 0 }])
    expect(facets.keywords).toEqual([{ value: 'label:gone', label: 'label:gone', count: 0 }])
  })

  it('reads a card nobody has read, or whose reading failed, as carrying no tag or keyword', () => {
    const failed = card({ reading: JSON.stringify({ ok: false, reason: 'blocked', readAt: 'x' }) })
    const f = facts(failed)
    expect(f.roleTag).toBeUndefined()
    expect(f.keywords).toEqual([])
    expect(proposalMatches(f, filter({ roleTags: ['Postdoc'] }))).toBe(false)
  })
})
