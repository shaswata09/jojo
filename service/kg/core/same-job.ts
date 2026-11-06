/**
 * L1 — is this the job we already have, reposted on another board?
 *
 * Reported 2026-11-06: the same Kansas State posting reaches the scout from
 * HigherEdJobs, CRA and AcademicCareers, each under its own address, and the
 * only duplicate rule the scout had was the address. So it was suggested three
 * times, and approving each one made three applications.
 *
 * This is the cheap half of the answer — arithmetic over what a listing says
 * before anything is read: the employer, the role, the place. The expensive
 * half runs once a page has been read (`findDuplicate` and the model judge, in
 * `use-duplicate-check`), and catches what this lets through.
 *
 * ## Which way it is allowed to be wrong
 *
 * A false "same job" costs a suggestion the person never sees, so every rule
 * here needs positive evidence, and a conflict anywhere is a "no":
 *
 *   - the SAME employer — equal, one name inside the other ("Kansas State
 *     University" in "Kansas State University, Manhattan"), or the initials of
 *     the other ("KSU"). Not "shares half its words": the University of Texas
 *     at Austin and at Dallas share three and are different employers;
 *   - places that do not disagree — when both say where, the city matches;
 *   - roles that do not disagree — the same rank where both name one
 *     ("assistant" is not "associate"), and subject words where one set holds
 *     the other. "Computer Science" against "Data Science" is two searches;
 *     a bare "Assistant Professor" against "Assistant Professor of Computer
 *     Science" is one posting written two ways, which is what boards do.
 *
 * A role on either side is required: an employer and a city alone are a
 * department, not a job.
 */

import { postingIdentity } from './capture'
import { postingIdKey } from './duplicates'
import { fold } from './text'

export type JobIdentity = {
  org?: string | undefined
  /** The role, or the listing's title — whatever names the job. */
  role?: string | undefined
  location?: string | undefined
  url?: string | undefined
  postingId?: string | undefined
}

/** Words that join a name and identify nothing. */
const FUNCTION_WORDS = new Set(['the', 'of', 'and', 'at', 'in', 'for', 'a', 'an', 'on', 'to', 'with', 'or'])

/** The kind of post. Two roles naming different ones are different jobs. */
const LEVELS = new Set([
  'assistant',
  'associate',
  'full',
  'distinguished',
  'lecturer',
  'instructor',
  'postdoctoral',
  'postdoc',
  'fellow',
  'scientist',
  'engineer',
  'director',
  'chair',
  'dean',
  'adjunct',
])

/** Words a role is written with that say nothing about WHICH job it is. */
const GENERIC = new Set([
  ...FUNCTION_WORDS,
  ...LEVELS,
  'professor',
  'professors',
  'professorship',
  'research',
  'teaching',
  'tenure',
  'tenured',
  'track',
  'non',
  'position',
  'positions',
  'faculty',
  'department',
  'dept',
  'school',
  'opening',
  'openings',
  'multiple',
  'open',
  'rank',
  'level',
  'senior',
  'junior',
  'visiting',
  'clinical',
  'job',
  'role',
  'new',
])

const wordsOf = (text: string | undefined): string[] =>
  text === undefined ? [] : fold(text).split(/[^a-z0-9]+/).filter((w) => w.length > 0)

const significant = (text: string | undefined): Set<string> =>
  new Set(wordsOf(text).filter((w) => !FUNCTION_WORDS.has(w)))

const initials = (text: string): string =>
  wordsOf(text)
    .filter((w) => !FUNCTION_WORDS.has(w))
    .map((w) => w[0] ?? '')
    .join('')

/** One employer under two spellings — strictly. See the header for why not loosely. */
export function sameEmployerStrict(a: string | undefined, b: string | undefined): boolean {
  if (!a?.trim() || !b?.trim()) return false
  const wa = significant(a)
  const wb = significant(b)
  if (wa.size === 0 || wb.size === 0) return false
  const [small, large] = wa.size <= wb.size ? [wa, wb] : [wb, wa]
  if ([...small].every((w) => large.has(w))) return true
  const squash = (x: string) => fold(x).replace(/[^a-z0-9]/g, '')
  const sa = squash(a)
  const sb = squash(b)
  return (sa.length >= 2 && sa.length <= 6 && sa === initials(b)) || (sb.length >= 2 && sb.length <= 6 && sb === initials(a))
}

/** The city: everything before the first comma, folded. */
const cityOf = (location: string | undefined): string | undefined => {
  const city = location === undefined ? '' : fold(location.split(',')[0] ?? '').replace(/[^a-z0-9 ]/g, '').trim()
  return city === '' ? undefined : city
}

/** Two places that could be one, or that one side does not state. */
function samePlaceOrUnsaid(a: string | undefined, b: string | undefined): boolean {
  const ca = cityOf(a)
  const cb = cityOf(b)
  if (ca === undefined || cb === undefined) return true
  if (/\bremote\b/.test(ca) || /\bremote\b/.test(cb)) return ca === cb
  return ca === cb || ca.includes(cb) || cb.includes(ca)
}

/**
 * The words that say WHICH job: the role's words, less its rank, the generic
 * vocabulary every posting uses, and the employer's and place's own names
 * (a board that puts "Kansas State University, Manhattan" in its title has not
 * named a subject).
 */
function subjectOf(job: JobIdentity): Set<string> {
  const drop = new Set([...wordsOf(job.org), ...wordsOf(job.location)])
  return new Set(
    wordsOf(job.role).filter((w) => !GENERIC.has(w) && !drop.has(w) && !/^\d+$/.test(w) && w.length > 1),
  )
}

const levelsOf = (job: JobIdentity): Set<string> => new Set(wordsOf(job.role).filter((w) => LEVELS.has(w)))

/** Is either set inside the other? An empty one is inside everything. */
const nested = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  return [...small].every((w) => large.has(w))
}

/**
 * Why two listings are one job, or null when nothing says they are.
 *
 * `'id'` and `'url'` are the same posting by its own numbering or address; a
 * `'listing'` is the same employer, role and place on two boards.
 */
export function sameJob(a: JobIdentity, b: JobIdentity): 'id' | 'url' | 'listing' | null {
  const ida = postingIdKey(a.postingId)
  if (ida !== undefined && ida === postingIdKey(b.postingId)) return 'id'
  const ua = a.url === undefined ? undefined : postingIdentity(a.url)
  if (ua !== undefined && b.url !== undefined && ua === postingIdentity(b.url)) return 'url'

  if (!a.role?.trim() || !b.role?.trim()) return null
  if (!sameEmployerStrict(a.org, b.org)) return null
  if (!samePlaceOrUnsaid(a.location, b.location)) return null

  const la = levelsOf(a)
  const lb = levelsOf(b)
  if (la.size > 0 && lb.size > 0 && ![...la].some((w) => lb.has(w))) return null
  if (!nested(subjectOf(a), subjectOf(b))) return null
  return 'listing'
}

/** The first of `known` that is this job, and why. */
export function findSameJob<T extends JobIdentity>(
  known: readonly T[],
  job: JobIdentity,
): { record: T; how: 'id' | 'url' | 'listing' } | undefined {
  for (const record of known) {
    const how = sameJob(job, record)
    if (how !== null) return { record, how }
  }
  return undefined
}
