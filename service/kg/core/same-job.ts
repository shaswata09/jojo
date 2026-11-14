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

/** The name's own words, in order. Order is part of the name: see below. */
const significant = (text: string | undefined): string[] =>
  wordsOf(text).filter((w) => !FUNCTION_WORDS.has(w))

/** Words that name a kind of employer and never which one. */
const INSTITUTION_WORDS = new Set(['university', 'college', 'institute', 'school', 'company', 'inc', 'corporation', 'llc', 'ltd'])

const initials = (text: string): string =>
  wordsOf(text)
    .filter((w) => !FUNCTION_WORDS.has(w))
    .map((w) => w[0] ?? '')
    .join('')

/**
 * One employer under two spellings — strictly. See the header for why not loosely.
 *
 * The same words IN THE SAME ORDER, or one name leading the other ("Kansas
 * State University" before ", Manhattan"). Not the same words in any order:
 * that made Texas A&M University the University of Texas, Miami University
 * the University of Miami, and Washington University in St. Louis the
 * University of Washington — three pairs of different employers whose names
 * are each other's words reshuffled. A bare "University" leads everything, so
 * a shorter name made only of such words never matches a longer one.
 */
export function sameEmployerStrict(a: string | undefined, b: string | undefined): boolean {
  if (!a?.trim() || !b?.trim()) return false
  const wa = significant(a)
  const wb = significant(b)
  if (wa.length === 0 || wb.length === 0) return false
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  const leads = short.every((w, i) => long[i] === w)
  if (leads && (short.length === long.length || short.some((w) => !INSTITUTION_WORDS.has(w)))) return true
  const squash = (x: string) => fold(x).replace(/[^a-z0-9]/g, '')
  const sa = squash(a)
  const sb = squash(b)
  return (sa.length >= 2 && sa.length <= 6 && sa === initials(b)) || (sb.length >= 2 && sb.length <= 6 && sb === initials(a))
}

/**
 * A posting ID, as two records would compare it.
 *
 * Folded and stripped of the label a page puts in front of it — "Job ID:
 * 12345", "JobCode 179545452", "Req # R-2024-0312", "Job Posting ID: 123" — so
 * the number typed by hand and the number the model copied with its label are
 * one reference. Anything without a digit is not a reference at all.
 */
export function postingIdKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const folded = fold(value)
    // Repeated, because labels stack: "Job Posting ID" is three of them.
    .replace(
      /^(?:(?:job|posting|requisition|req|reference|ref|vacancy|position|id|code|number|no)[\s.:#-]*)+/,
      '',
    )
    .replace(/[\s.:#]+/g, '')
  return /\d/.test(folded) ? folded : undefined
}

/** The host a URL is on, without a `www.`; undefined when it is not a URL. */
function hostOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return host === '' ? undefined : host
  } catch {
    return undefined
  }
}

/**
 * Two records with the same posting ID are one job — when the employer or the
 * site agrees as well.
 *
 * The ID alone used to be certain. But a requisition number is the employer's
 * own numbering, and short ones repeat across employers: 'JR100234' at Rice
 * and at Duke are two jobs. So it decides only alongside the same employer
 * (`sameEmployerStrict`) or the same host; otherwise the other rules get their
 * turn.
 */
export function idDecides(a: JobIdentity, b: JobIdentity): boolean {
  const id = postingIdKey(a.postingId)
  if (id === undefined || id !== postingIdKey(b.postingId)) return false
  if (sameEmployerStrict(a.org, b.org)) return true
  const host = hostOf(a.url)
  return host !== undefined && host === hostOf(b.url)
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
  if (idDecides(a, b)) return 'id'
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
