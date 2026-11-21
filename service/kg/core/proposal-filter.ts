/**
 * Finding your way through the suggestions queue: which cards still need the
 * person, what a search box matches, and what the queue can be filtered by.
 *
 * Asked for by the owner on 2026-11-20 (Q343). The queue listed every card it
 * had ever offered in one column — the pending ones, then everything already
 * answered underneath — with no search and no filter, so after a few rounds of
 * a busy pipeline the cards still waiting for an answer were a minority of the
 * list. Both apps read this module, so a card is "active" or "closed" by one
 * rule on both, and a search finds the same cards on both.
 *
 * Pure: no React, no store. A card is judged from the `Proposal` itself and,
 * for an approved job, from what became of the job it saved.
 */

import { fold } from './text'
import { postingPreview, proposalDetail, scoutReading } from './proposal'
import type { Proposal } from './model-scout'

/** What a card proposes, as the Type filter names it. */
export type ProposalType = 'posting' | 'match' | 'change'

/** The Type filter's values, in the order the filter lists them. */
export const PROPOSAL_TYPES: readonly ProposalType[] = ['posting', 'match', 'change']

/** Which kind of card this is: a posting to save, a match to save, or a change to a record. */
export function proposalType(p: Proposal): ProposalType {
  if (p.tool === 'scout.posting.save') return 'posting'
  if (p.tool === 'scout.match.save') return 'match'
  return 'change'
}

/**
 * Does this card still need the person?
 *
 * A pending card does: it is a question nobody has answered. So does an
 * approved scout card whose job has not gone into the applications yet —
 * approving files the job under Matches or Postings and stops, and the card
 * keeps the second step ("Add to applications") because that is where people
 * looked for it. Everything else is closed: discarded, failed, and approved
 * work that is finished, including a job already in the applications.
 *
 * `job` is what an approved scout card saved, when the caller can say: `null`
 * for a card that saved nothing findable, or a caller with no second step to
 * offer (the phone files approved jobs straight into its lists). A job whose
 * `applicationId` is set has been added and needs nothing more.
 */
export function isActiveProposal(
  p: Proposal,
  job: { applicationId?: string | undefined } | null = null,
): boolean {
  if (p.status === 'pending') return true
  if (p.status !== 'approved' || proposalType(p) === 'change') return false
  return job !== null && !job.applicationId
}

/** The queue split in two: what still needs the person, and what is finished. */
export function splitProposals<P extends Proposal>(
  proposals: readonly P[],
  jobFor: (p: P) => { applicationId?: string | undefined } | null = () => null,
): { active: P[]; closed: P[] } {
  const active: P[] = []
  const closed: P[] = []
  for (const p of proposals) {
    if (isActiveProposal(p, p.status === 'approved' ? jobFor(p) : null)) active.push(p)
    else closed.push(p)
  }
  return { active, closed }
}

/**
 * What a card is ABOUT, read once: the fields the filters group by and the
 * text the search box looks through.
 *
 * Employer and role tag come from the posting's page when it has been read
 * (`ProposalProps.reading`), and the employer falls back to what the scout
 * itself wrote on the card. Keywords are the person's own, as the reading
 * matched them; a card nobody has read has none.
 */
export type ProposalFacts = {
  type: ProposalType
  /** `''` for a card whose pipeline has been deleted. */
  pipeline: string
  roleTag?: string
  employer?: string
  keywords: { id: string; name: string }[]
  /** Everything a search may match, folded (case and accents off) and joined. */
  text: string
}

/** Reads a card's facts. `pipelineName` names its pipeline, for the search. */
export function proposalFacts(p: Proposal, pipelineName: string): ProposalFacts {
  const posting = postingPreview(p.tool, p.input)
  const reading = scoutReading(p.reading)
  const read = reading?.ok ? reading : null
  const fields = read?.fields ?? {}
  const scoutOrg = scoutField(p, 'org')
  const employer = clean(fields.org) ?? scoutOrg
  const roleTag = clean(fields.roleTag)
  const keywords = read?.keywords ?? []
  const text = [
    p.title,
    p.rationale,
    posting?.title,
    posting?.summary,
    posting?.label,
    posting ? null : proposalDetail(p.input),
    fields.org,
    fields.role,
    fields.roleTag,
    fields.location,
    scoutOrg,
    scoutField(p, 'location'),
    ...keywords.map((k) => k.name),
    pipelineName,
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .map(fold)
    .join('\n')
  return {
    type: proposalType(p),
    pipeline: p.pipelineId ?? '',
    ...(roleTag ? { roleTag } : {}),
    ...(employer ? { employer } : {}),
    keywords,
    text,
  }
}

/**
 * What the queue is being narrowed to. Empty everywhere is "everything".
 *
 * Within one category the values widen (a Postdoc OR a Faculty card); across
 * categories they narrow (a Postdoc card FROM this pipeline). That is how every
 * other filter in jojo reads, and it is the only reading where picking a second
 * value in the same list does not empty the page.
 */
export type ProposalFilter = {
  query: string
  pipelines: readonly string[]
  types: readonly ProposalType[]
  roleTags: readonly string[]
  keywords: readonly string[]
  employers: readonly string[]
}

export const NO_PROPOSAL_FILTER: ProposalFilter = Object.freeze({
  query: '',
  pipelines: [],
  types: [],
  roleTags: [],
  keywords: [],
  employers: [],
})

/** How many values are picked across the categories — the number on the Filter button. */
export function filterCount(filter: ProposalFilter): number {
  return (
    filter.pipelines.length +
    filter.types.length +
    filter.roleTags.length +
    filter.keywords.length +
    filter.employers.length
  )
}

/** Is anything narrowing the queue, the search included? */
export function isFiltering(filter: ProposalFilter): boolean {
  return filter.query.trim() !== '' || filterCount(filter) > 0
}

/**
 * Does a card pass the filter?
 *
 * The search is word by word: every word typed has to appear somewhere on the
 * card, in any field, so "postdoc boston" finds a card whose role says one and
 * whose location says the other. Case and accents are ignored, as in every
 * other search in jojo (`fold`). Role tags and employers compare folded too,
 * because the same employer arrives spelt "MIT" by one board and "mit" by
 * another's page.
 */
export function proposalMatches(facts: ProposalFacts, filter: ProposalFilter): boolean {
  const words = fold(filter.query).split(/\s+/).filter(Boolean)
  if (!words.every((w) => facts.text.includes(w))) return false
  if (filter.pipelines.length > 0 && !filter.pipelines.includes(facts.pipeline)) return false
  if (filter.types.length > 0 && !filter.types.includes(facts.type)) return false
  if (filter.roleTags.length > 0 && !someFolded(filter.roleTags, facts.roleTag)) return false
  if (filter.employers.length > 0 && !someFolded(filter.employers, facts.employer)) return false
  if (filter.keywords.length > 0 && !facts.keywords.some((k) => filter.keywords.includes(k.id)))
    return false
  return true
}

/** One value a category can be filtered to, and how many cards carry it. */
export type FacetValue = { value: string; label: string; count: number }

/** Every category's values among `facts`, most common first. */
export type ProposalFacets = {
  pipelines: FacetValue[]
  types: FacetValue[]
  roleTags: FacetValue[]
  keywords: FacetValue[]
  employers: FacetValue[]
}

/**
 * The values each filter can offer, counted over the cards given.
 *
 * Only values some card actually carries are offered: a filter listing every
 * role tag the person has ever used would mostly lead to an empty queue. A
 * value the person has picked stays listed even when no card carries it any
 * longer (the card that had it was answered and swept), at a count of zero,
 * so it can still be turned off where it was turned on.
 *
 * `pipelineName` and `typeName` label the two categories whose values are ids.
 * Role tags and employers are grouped folded and shown as first seen;
 * keywords by id, under the name the reading recorded.
 */
export function proposalFacets(
  facts: readonly ProposalFacts[],
  filter: ProposalFilter,
  pipelineName: (id: string) => string,
  typeName: (type: ProposalType) => string,
): ProposalFacets {
  const tally = () => new Map<string, FacetValue>()
  const pipelines = tally()
  const types = tally()
  const roleTags = tally()
  const keywords = tally()
  const employers = tally()
  const add = (map: Map<string, FacetValue>, key: string, value: string, label: string) => {
    const seen = map.get(key)
    if (seen) seen.count += 1
    else map.set(key, { value, label, count: 1 })
  }
  for (const f of facts) {
    add(pipelines, f.pipeline, f.pipeline, pipelineName(f.pipeline))
    add(types, f.type, f.type, typeName(f.type))
    if (f.roleTag) add(roleTags, fold(f.roleTag), f.roleTag, f.roleTag)
    if (f.employer) add(employers, fold(f.employer), f.employer, f.employer)
    for (const k of f.keywords) add(keywords, k.id, k.id, k.name)
  }
  const keep = (map: Map<string, FacetValue>, picked: readonly string[], folded: boolean) => {
    for (const value of picked) {
      const key = folded ? fold(value) : value
      if (!map.has(key)) map.set(key, { value, label: value, count: 0 })
    }
  }
  keep(pipelines, filter.pipelines, false)
  keep(types, filter.types, false)
  keep(roleTags, filter.roleTags, true)
  keep(keywords, filter.keywords, false)
  keep(employers, filter.employers, true)
  // Types in their fixed order, so the list does not reshuffle as cards come
  // and go; the rest by how many cards carry them, then alphabetically.
  const byCount = (map: Map<string, FacetValue>) =>
    [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return {
    pipelines: byCount(pipelines),
    types: PROPOSAL_TYPES.flatMap((t) => types.get(t) ?? []),
    roleTags: byCount(roleTags),
    keywords: byCount(keywords),
    employers: byCount(employers),
  }
}

/** Turns one value of one category on or off. */
export function toggleFilter<K extends Exclude<keyof ProposalFilter, 'query'>>(
  filter: ProposalFilter,
  category: K,
  value: ProposalFilter[K][number],
): ProposalFilter {
  const list = filter[category] as readonly string[]
  const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  return { ...filter, [category]: next }
}

const clean = (value: string | undefined | null): string | undefined => {
  const text = value?.trim().replace(/\s+/g, ' ')
  return text ? text : undefined
}

/** A string field of the card's own input, when the scout wrote one. */
function scoutField(p: Proposal, key: string): string | undefined {
  try {
    const input: unknown = JSON.parse(p.input)
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined
    const value = (input as Record<string, unknown>)[key]
    return typeof value === 'string' ? clean(value) : undefined
  } catch {
    return undefined
  }
}

const someFolded = (picked: readonly string[], value: string | undefined) =>
  value !== undefined && picked.some((v) => fold(v) === fold(value))
