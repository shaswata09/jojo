/**
 * Guesses an application out of a string.
 *
 * Every entry point that starts a record from something the user pasted — the
 * URL bar on the dashboard, a captured posting, a scout match, a duplicate —
 * goes through here, so all of them produce the same shape. When one surface
 * guessed the employer from a hostname and another kept the whole hostname, the
 * same job filed twice under two different names and neither the sources
 * breakdown nor a search for the employer could put them back together.
 *
 * These are guesses and they are wrong often enough to matter, so nothing here
 * is allowed to save anything. The output is a prefill for a form the user
 * still has to look at — ApplicationDialog says so in its description.
 */

import type { Application, Source } from '@/data/seed'

/**
 * 'Stripe — ML engineer'. The em dash with spaces is what `displayName` emits,
 * but people paste en dashes and spaced hyphens too and mean exactly the same
 * thing. Requires the spaces so a hyphenated employer stays whole.
 */
const SEPARATOR = /\s+[—–-]\s+/

/**
 * Splits a packed 'employer — role' string.
 *
 * Only the first separator counts: 'UNT — Assistant professor — remote' is one
 * employer and one long role, not three fields. With no separator the whole
 * string is the employer, which is the half worth keeping — a record filed
 * under the right employer with a blank role is findable, the reverse is not.
 */
export function draftFromText(s: string): Partial<Application> {
  const text = s.trim().replace(/\s+/g, ' ')
  if (!text) return {}

  const at = SEPARATOR.exec(text)
  if (!at) return { org: text }

  const org = text.slice(0, at.index).trim()
  const role = text.slice(at.index + at[0].length).trim()

  // Leading separator — 'Assistant professor' with a stray dash in front. There
  // is no employer to take, so the string stays whole rather than being cut.
  if (!org) return { org: text }

  return role ? { org, role } : { org }
}

/**
 * Hostnames that host other people's jobs.
 *
 * Matched against any label of the hostname, because the same board appears as
 * 'boards.greenhouse.io', 'jobs.lever.co' and 'acme.wd1.myworkdayjobs.com'.
 */
const JOB_BOARDS = new Set([
  'linkedin',
  'indeed',
  'greenhouse',
  'lever',
  'workday',
  'myworkdayjobs',
  'ashbyhq',
  'smartrecruiters',
  'workable',
  'jobvite',
  'icims',
  'taleo',
  'glassdoor',
  'ziprecruiter',
  'wellfound',
  'dice',
  'monster',
  'higheredjobs',
  'academicjobsonline',
  'chronicle',
  'interfolio',
])

/**
 * The boards that list everybody's jobs together.
 *
 * The employer is nowhere in the URL on these — it is text on the page — so
 * nothing is guessed and the required field opens empty for the user to fill.
 * The alternative is every LinkedIn posting filed under an employer called
 * 'LinkedIn', which is a wrong answer wearing a right answer's clothes.
 */
const AGGREGATORS = new Set([
  'linkedin',
  'indeed',
  'glassdoor',
  'ziprecruiter',
  'wellfound',
  'dice',
  'monster',
  'higheredjobs',
  'academicjobsonline',
  'chronicle',
  'interfolio',
])

/** Subdomains that are the site's own filing rather than a tenant's name. */
const GENERIC_HOSTS = new Set(['www', 'jobs', 'job', 'careers', 'career', 'boards', 'apply', 'my'])

/**
 * Suffix labels that are never the employer's name. Every two-letter label
 * counts too — those are country codes, and without that rule
 * 'careers.google.co.uk' files the application under an employer called 'UK'.
 */
const SUFFIXES = new Set(['com', 'org', 'net', 'edu', 'gov', 'ac', 'co', 'io', 'jobs'])

const isSuffix = (label: string) => SUFFIXES.has(label) || label.length === 2

/**
 * Path segments that describe the site's own filing, not the job. Dropping them
 * is the difference between a role of 'ML engineer' and a role of 'View'.
 */
const ROUTING_SEGMENTS = new Set([
  'jobs',
  'job',
  'careers',
  'career',
  'posting',
  'postings',
  'position',
  'positions',
  'opening',
  'openings',
  'vacancy',
  'vacancies',
  'listing',
  'listings',
  'role',
  'roles',
  'apply',
  'application',
  'view',
  'viewjob',
  'details',
  'detail',
  'search',
  'results',
  'embed',
  'requisition',
  'req',
  'en',
  'en-us',
  'us',
  'uk',
  'index',
])

/** Spellings the sentence-cased de-slugifier would otherwise flatten. */
const ACRONYMS: Record<string, string> = {
  ml: 'ML',
  ai: 'AI',
  nlp: 'NLP',
  cs: 'CS',
  ece: 'ECE',
  ee: 'EE',
  hci: 'HCI',
  ui: 'UI',
  ux: 'UX',
  qa: 'QA',
  sre: 'SRE',
  it: 'IT',
  hr: 'HR',
  phd: 'PhD',
}

/**
 * Tokens that carry no name — record numbers, hashes, the UUID in a Lever URL.
 * A role of '3812345678' is worse than no role, because it looks deliberate.
 */
function looksLikeId(segment: string) {
  if (!/[a-z]/i.test(segment)) return true
  // A long run of hex and dashes is a uuid or a token, whatever it spells.
  if (/^[0-9a-f-]{16,}$/i.test(segment)) return true
  return /\d{5,}/.test(segment)
}

/**
 * Drops the requisition number Workday and friends staple to the job title —
 * 'Data-Scientist_R-12345'. Left on, `looksLikeId` throws the whole segment
 * away and the one part of the URL that names the job is lost with it.
 */
const withoutReqNumber = (segment: string) => segment.replace(/[_-](?:r|req|jr|job)?-?\d{4,}$/i, '')

const words = (s: string) =>
  s
    .replace(/[-_+.%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

/**
 * 'ml-engineer-inference' → 'ML engineer inference'.
 *
 * Sentence case, not title case: the seed writes roles as 'ML engineer' and
 * 'Research scientist', and a de-slugified 'ML Engineer Inference' would stand
 * out in the list as the one row a machine wrote.
 */
function deslugify(s: string) {
  const parts = words(s).map((w) => ACRONYMS[w.toLowerCase()] ?? w.toLowerCase())
  if (parts.length === 0) return ''
  const [head, ...rest] = parts
  const first = ACRONYMS[head.toLowerCase()] === head ? head : head[0].toUpperCase() + head.slice(1)
  return [first, ...rest].join(' ')
}

/**
 * 'ut-austin' → 'UT Austin'.
 *
 * Short words are uppercased whole. The people this tracks apply to UNT, UH and
 * SMU far more often than to any three-letter company, and 'Unt' is a typo
 * where 'UNT' is a name.
 */
function orgCase(s: string) {
  return words(s)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
}

/**
 * The employer's own label in a hostname.
 *
 * 'jobs.rice.edu' → 'rice', 'careers.google.co.uk' → 'google'. Walks in from
 * the end past the public suffix rather than taking a fixed position, because
 * the interesting label sits second-to-last on a .com and third-to-last on a
 * .co.uk.
 */
function orgFromHost(hostname: string) {
  const labels = hostname
    .replace(/^www\./, '')
    .split('.')
    .filter(Boolean)
  let at = labels.length - 1
  // Never past the first label, so a two-letter employer keeps its own name.
  while (at > 0 && isSuffix(labels[at].toLowerCase())) at -= 1
  return labels[at] ?? ''
}

/**
 * Accepts what people actually paste.
 *
 * A bare 'boards.greenhouse.io/acme/jobs/4' has no scheme and `new URL` refuses
 * it, so it gets one and is tried again — but only if the result has a dotted
 * hostname, or the single word 'Stripe' would come back as the perfectly valid
 * URL 'https://stripe/' and be saved as this application's posting link.
 */
function parseUrl(text: string): { url: URL; href: string } | undefined {
  try {
    const url = new URL(text)
    // A `javascript:` or `data:` string parses happily and must never reach an
    // anchor. Only the two schemes a posting can live at get through.
    if (url.protocol === 'http:' || url.protocol === 'https:') return { url, href: text }
  } catch {
    // Falls through to the scheme-less retry below.
  }

  try {
    const url = new URL(`https://${text}`)
    if (url.hostname.includes('.')) return { url, href: url.href }
  } catch {
    // Not a URL at all.
  }

  return undefined
}

/**
 * Where a job board keeps the employer's name.
 *
 * Three shapes, and taking the wrong one is how a tracker ends up with
 * applications to a company called Austin. Greenhouse and Lever put the tenant
 * first in the path ('/acme/jobs/4567'); Workday and iCIMS put it first in the
 * hostname ('acme.wd1.myworkdayjobs.com'); the aggregators do not carry it at
 * all. Returns '' rather than a fallback, because on a board every fallback is
 * the board's own name.
 */
function orgFromBoard(url: URL, segments: string[], named: string[]) {
  const labels = url.hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.')
  if (labels.some((l) => AGGREGATORS.has(l))) return ''

  const first = segments[0]
  if (first && named.includes(first)) return first

  const leading = labels[0] ?? ''
  return GENERIC_HOSTS.has(leading) || JOB_BOARDS.has(leading) ? '' : leading
}

/**
 * Guesses an application out of a posting link.
 *
 * On a careers page the hostname is the employer and the path is the job. On a
 * job board the hostname is the board, so the employer is looked for where that
 * board keeps it and left blank when it is not in the URL at all — blank is a
 * question the user answers, where 'LinkedIn' is a wrong answer that looks like
 * a right one and never gets corrected.
 *
 * Anything unparseable falls back to `draftFromText`, so pasting
 * 'Stripe — ML engineer' into a URL field still does the useful thing.
 */
export function draftFromUrl(u: string): Partial<Application> {
  const text = u.trim()
  if (!text) return {}

  const parsed = parseUrl(text)
  if (!parsed) return draftFromText(text)

  const { url, href } = parsed
  const labels = url.hostname.toLowerCase().split('.')
  const board = labels.some((l) => JOB_BOARDS.has(l))
  const source: Source = board ? 'Job board' : 'Careers page'

  const segments = url.pathname
    .split('/')
    .map(decodeSegment)
    .map((s) => withoutReqNumber(s.replace(/\.(html?|php|aspx?|jsp)$/i, '')))
    .filter(Boolean)

  const named = segments.filter((s) => !ROUTING_SEGMENTS.has(s.toLowerCase()) && !looksLikeId(s))

  const orgSegment = board ? orgFromBoard(url, segments, named) : ''
  const org = orgCase(board ? orgSegment : orgFromHost(url.hostname))

  // The employer's own segment can never also be the role, or a Greenhouse link
  // comes back as 'Acme — Acme'.
  const roleSegment = named.filter((s) => s !== orgSegment).at(-1)
  const role = roleSegment ? deslugify(roleSegment) : ''

  const draft: Partial<Application> = { source, url: href }
  if (org) draft.org = org
  if (role) draft.role = role
  return draft
}

/** A percent-escape can be malformed; a bad segment is skipped, not thrown. */
function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
