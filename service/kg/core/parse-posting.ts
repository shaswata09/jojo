/**
 * L1 — draftFromText / draftFromUrl, moved down from @/components/applications/draft-from.
 *
 * It lived under `components/` and was imported by `store-context.ts`: a domain
 * write reaching UP into a component folder for URL parsing. The function was
 * always pure, so the fix is a move rather than a rewrite. Written down here
 * because otherwise someone tidies it back on the grounds that the dialog is its
 * only visible caller — it is not; `scout.posting.promote` parses a saved
 * posting's URL with no dialog anywhere in the call stack.
 *
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

import type { Application, Source } from './model'

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
  const separator = at?.[0]
  if (!at || separator === undefined) return { org: text }

  const org = text.slice(0, at.index).trim()
  const role = text.slice(at.index + separator.length).trim()

  // Leading separator — 'Assistant professor' with a stray dash in front. There
  // is no employer to take, so the string stays whole rather than being cut.
  if (!org) return { org: text }

  return role ? { org, role } : { org }
}

/**
 * The job out of a posting's own title line, once the employer is known.
 *
 * Promoting the seeded Rice posting produced an application displayed as just
 * 'Rice' with an empty Role. Its URL — 'jobs.rice.edu/postings/29411' — names
 * the employer and nothing else: every path segment is either routing or a
 * record number, so `draftFromUrl` correctly returned no role, and the title
 * line that did carry it ('Assistant Professor of Computer Science — Rice
 * University') was never read. The employer had already been found, so the one
 * branch that consulted the title was skipped.
 *
 * `draftFromText` cannot be reused for this. It assumes employer-first, and the
 * two title spellings in circulation disagree about that: the seed writes the
 * job first, and the Save-a-posting field writes 'employer — job' because that
 * is what `draftFromUrl` guessed. So the employer is IDENTIFIED and dropped
 * rather than positioned — whichever side it is on, what is left is the job.
 *
 * Returns '' when nothing is left, which is the honest answer for a title that
 * only names the employer, or that is the raw URL because the guess found no
 * name at all. A role of 'jobs.rice.edu/postings/29411' would be worse than a
 * blank one, because it looks deliberate.
 */
export function roleFromTitle(title: string, org: string): string {
  const text = title.trim().replace(/\s+/g, ' ')
  if (!text) return ''

  const employer = new Set(words(org).map((w) => w.toLowerCase()))
  const parts = text
    .split(SEPARATOR)
    .map((p) => p.trim())
    .filter((p) => p && !namesTheEmployer(p, employer))

  // Re-joined rather than truncated to the first survivor: 'UNT — Assistant
  // professor — remote' is one employer and one long role, the same reading
  // `draftFromText` takes of the same string. The em dash is what `displayName`
  // emits, so a role rebuilt here spells its own separator the app's way.
  return parts.join(' — ')
}

/**
 * Whether a title segment is the employer's name rather than the job's.
 *
 * Either side can be the fuller spelling. The URL yields a single hostname
 * label — 'rice' — where the title writes 'Rice University'; a title that says
 * only 'Stripe' is the whole name where the URL gave 'stripe'. So the test is
 * containment in whichever direction holds, not equality.
 */
function namesTheEmployer(part: string, employer: ReadonlySet<string>) {
  if (employer.size === 0) return false
  const own = new Set(words(part).map((w) => w.toLowerCase()))
  if (own.size === 0) return true
  const covered = (a: ReadonlySet<string>, b: ReadonlySet<string>) => [...a].every((w) => b.has(w))
  return covered(employer, own) || covered(own, employer)
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
  'academiccareers',
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
  'academiccareers',
  'chronicle',
  'interfolio',
])

/**
 * Boards whose name is a whole host rather than one label. 'jobs.ac.uk' is the
 * UK academic aggregator, and none of its labels is distinctive on its own —
 * 'jobs' alone would make every careers subdomain a board. 'cra.org' is the
 * CRA job board the scout reads (`cra.org/ads`, which now redirects to
 * `careercenter.cra.org`); 'cra' as a label is too short to trust on any host.
 */
const BOARD_HOSTS = ['jobs.ac.uk', 'cra.org']

const onBoardHost = (hostname: string) => {
  const host = hostname.toLowerCase()
  return BOARD_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

/** Subdomains that are the site's own filing rather than a tenant's name. */
const GENERIC_HOSTS = new Set(['www', 'jobs', 'job', 'careers', 'career', 'boards', 'apply', 'my'])

/**
 * Top-level labels that are never the employer's name. A final two-letter
 * label counts too — a country code — or 'careers.google.co.uk' files the
 * application under an employer called 'UK'.
 */
const SUFFIXES = new Set(['com', 'org', 'net', 'edu', 'gov', 'ac', 'co', 'io', 'jobs'])

/**
 * The second level a country code is registered under: the 'ac' in '.ac.uk',
 * the 'com' in '.com.au', the 'go' in '.go.jp'. Only these, and only right
 * before a country code — any other two-letter label is somebody's name ('ox',
 * 'ge', 'hp'), and treating every one as a suffix turned 'jobs.ox.ac.uk' into
 * an employer called 'Jobs'.
 *
 * So the list has to name the second levels that public employers actually
 * sit under, which is where a research or government job is posted: Japan
 * (go, or, ne, lg, ed, gr, ad), Korea (go, re, or, ne), Canada's federal gc.ca,
 * Austria's gv.at, Thailand (go, or, mi, in), and the longer spellings Spanish,
 * French, New Zealand and Indian hosts use. A name that is also in this list
 * is still read as a name when it sits anywhere but right before the country
 * code — 'www.ed.ac.uk' is Edinburgh.
 */
const COUNTRY_SECOND_LEVEL = new Set([
  'ac',
  'co',
  'com',
  'gov',
  'edu',
  'org',
  'net',
  'go',
  'gc',
  're',
  'gv',
  'ne',
  'or',
  'lg',
  'ed',
  'gr',
  'ad',
  'mi',
  'in',
  'gob',
  'gouv',
  'govt',
  'res',
  'nic',
  'mil',
])

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
  // The scout's boards file every job under their own prefix:
  // academicjobsonline.org/ajo/jobs/…, higheredjobs.com/faculty/details.cfm,
  // cra.org/ads/…. Left in, each came back as a role ('Ajo', 'Ads').
  'ajo',
  'ads',
  'faculty',
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
const withoutReqNumber = (segment: string) =>
  // `[-_]?` between the prefix and the digits: Workday writes both
  // 'Data-Scientist_R-12345' and 'Research-Scientist_R_00012345', and the
  // second used to leave '_R' behind as a role of 'Research scientist r'.
  segment.replace(/[_-](?:r|req|jr|job)?[-_]?\d{4,}$/i, '')

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
  const [head, ...rest] = parts
  if (head === undefined) return ''
  const first = ACRONYMS[head.toLowerCase()] === head ? head : capitalise(head)
  return [first, ...rest].join(' ')
}

/** Empty in, empty out — `word[0]` on '' is undefined, not ''. */
function capitalise(word: string): string {
  const head = word[0]
  return head === undefined ? word : head.toUpperCase() + word.slice(1)
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
    .map((w) => (w.length <= 3 ? w.toUpperCase() : capitalise(w.toLowerCase())))
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
  const lower = (i: number) => (labels[i] ?? '').toLowerCase()
  let at = labels.length - 1
  // Never past the first label, so a two-letter employer keeps its own name.
  const country = lower(at).length === 2
  if (at > 0 && (SUFFIXES.has(lower(at)) || country)) at -= 1
  if (at > 0 && country && COUNTRY_SECOND_LEVEL.has(lower(at))) at -= 1
  // 'careers.co.uk' has no employer in it; the filing label is not one.
  return GENERIC_HOSTS.has(lower(at)) ? '' : (labels[at] ?? '')
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
  if (labels.some((l) => AGGREGATORS.has(l)) || onBoardHost(url.hostname)) return ''

  /*
   * Hostname first on the boards that keep the tenant there. A Workday path's
   * first segment is the career SITE's name ('External', 'UTstaff',
   * 'NVIDIAExternalCareerSite'), not the employer, and checking the path first
   * filed applications under an employer called "External". iCIMS tenants are
   * often 'careers-acme', and the affix is not part of the name.
   */
  if (labels.slice(1).some((l) => TENANT_IN_HOST.has(l))) {
    const tenant = (labels[0] ?? '').replace(/^careers?-|-careers?$/, '')
    if (tenant !== '' && !GENERIC_HOSTS.has(tenant) && !JOB_BOARDS.has(tenant)) return tenant
  }

  const first = segments[0]
  if (first && named.includes(first)) return first

  const leading = labels[0] ?? ''
  return GENERIC_HOSTS.has(leading) || JOB_BOARDS.has(leading) ? '' : leading
}

/** The boards whose hostname's first label is the employer's tenant. */
const TENANT_IN_HOST = new Set(['myworkdayjobs', 'icims'])

/** Whether this address is a job board's rather than an employer's own site. */
const isBoard = (url: URL) =>
  url.hostname.toLowerCase().split('.').some((l) => JOB_BOARDS.has(l)) || onBoardHost(url.hostname)

/**
 * The path's segments, and the ones among them that name something: not the
 * site's routing ('jobs', 'view') and not a bare ID.
 */
function pathOf(url: URL): { segments: string[]; named: string[] } {
  const segments = url.pathname
    .split('/')
    .map(decodeSegment)
    .map((s) => withoutReqNumber(s.replace(/\.(html?|php|aspx?|jsp|cfm)$/i, '')))
    .filter(Boolean)
  const named = segments.filter((s) => !ROUTING_SEGMENTS.has(s.toLowerCase()) && !looksLikeId(s))
  return { segments, named }
}

/**
 * The one employer's site a posting address is on, or undefined when the
 * address says nothing about which employer it belongs to.
 *
 * On a careers page that is the host. On a job board the host is shared by
 * every employer the board lists, so it is the host plus the tenant the board
 * files the job under ('boards.greenhouse.io/anthropic'), and nothing at all
 * on an aggregator that keeps the employer only in the page's text. Two
 * postings with the same requisition number on 'boards.greenhouse.io' are at
 * Anthropic and at Stripe, not one job — `idDecides` in `same-job.ts` read the
 * host alone and said they were.
 */
export function employerSite(u: string | undefined): string | undefined {
  if (u === undefined) return undefined
  let url: URL
  try {
    url = new URL(u)
  } catch {
    return undefined
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (host === '') return undefined
  if (!isBoard(url)) return host
  const { segments, named } = pathOf(url)
  const tenant = orgFromBoard(url, segments, named).toLowerCase()
  return tenant === '' ? undefined : `${host}/${tenant}`
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
  const board = isBoard(url)
  const source: Source = board ? 'Job board' : 'Careers page'
  const { segments, named } = pathOf(url)

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

/**
 * The first http(s) address in a block of text, if there is one.
 *
 * Deliberately loose about what follows it. A shared string frequently ends in
 * punctuation the sender never meant as part of the link — a full stop, a
 * closing bracket, a quotation mark — so those are trimmed off the tail rather
 * than being handed to `new URL`, which would keep them and produce a 404 the
 * user cannot see the cause of.
 */
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i

function firstUrl(text: string): string | undefined {
  const hit = URL_IN_TEXT.exec(text)?.[0]
  return hit?.replace(/[.,;:!?)\]}>'"]+$/, '')
}

/**
 * A draft from whatever another app handed over.
 *
 * WHAT A SHARE ACTUALLY LOOKS LIKE, and why `draftFromUrl` alone was not
 * enough. Android's share sheet almost never sends a bare link: Chrome sends
 * the page title and the URL together, and so does nearly every job board's own
 * share button. Handed the whole string, `draftFromUrl` finds no URL, falls
 * through to `draftFromText`, and files the record under an employer called
 * "Assistant Professor of Computer Science https://jobs.rice.edu/postings/29411"
 * — which is what the first version of the Android share target did.
 *
 * So the link is pulled out and parsed as a link, which is the half that knows
 * the employer and the board. The words around it are kept as the ROLE when the
 * URL could not supply one, because a human-written title is a better role than
 * a slug — and dropped when it could, because the two would disagree and the
 * shorter one is usually right.
 */
export function draftFromShare(shared: string): Partial<Application> {
  const text = shared.trim().replace(/\s+/g, ' ')
  if (!text) return {}

  const url = firstUrl(text)
  if (!url) return draftFromText(text)

  const draft = draftFromUrl(url)
  const words = text
    .replace(url, '')
    .trim()
    .replace(/^[-—–|·:]+|[-—–|·:]+$/g, '')
    .trim()
  if (!words) return draft
  // A role read off a board's address as one word is a routing word the
  // board added after this list was written, or a department ('CS'), far more
  // often than a title. The words the person shared are the title.
  const weakRole = draft.source === 'Job board' && draft.role !== undefined && !/\s/.test(draft.role)
  if (draft.role && !weakRole) return draft

  // No role came out of the address, so the title is the best one available —
  // and if it carries an 'employer — role' separator, that split wins over the
  // host-derived employer for the same reason `draftFromText` trusts it.
  const fromWords = draftFromText(words)
  return { ...draft, ...(fromWords.role ? fromWords : { role: words }) }
}

/** A percent-escape can be malformed; a bad segment is skipped, not thrown. */
function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
