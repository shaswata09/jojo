/**
 * The seed the session store starts from.
 *
 * Transcribed from the design mockup. Nothing here is mutated in place — the
 * arrays are the initial value handed to `StoreProvider`, and every edit the
 * user makes lives in that reducer instead.
 */

import { daysBetween, shortDate } from '@/data/timeline'
import { TODAY } from '@/lib/today'

export type Urgency = 'red' | 'amber' | 'gray'

export type Stage = 'draft' | 'submitted' | 'screen' | 'interview' | 'offer' | 'closed'

/** The same four the sources donut splits by, so the two can't drift apart. */
export const SOURCES = ['Job scout', 'Job board', 'Referral', 'Careers page'] as const
export type Source = (typeof SOURCES)[number]

/** How a closed application ended. Absent while it is still live. */
export type Outcome = 'rejected' | 'withdrawn' | 'accepted' | 'declined' | 'ghosted'

export type Offer = {
  /**
   * 'YYYY-MM-DD'. Was a display string sitting beside a hand-counted
   * `daysLeft`, which meant the countdown was stale the moment the mock's
   * today moved — `offerDaysLeft` derives it now.
   */
  respondBy: string
  comp?: string
  note: string
}

export type Application = {
  id: string
  /**
   * Employer and position, split. They were packed into one 'Stripe — ML
   * engineer' string, which reads fine and sorts, groups and searches badly:
   * every consumer that wanted just the employer had to split on an em dash.
   * `displayName` puts them back together for display.
   */
  org: string
  role: string
  note: string
  /** The job role this application is for — the axis the user filters on. */
  roleTag: RoleTag
  stage: Stage
  flagged?: boolean
  /*
   * There is deliberately no badge field here.
   *
   * Rows used to carry a hand-authored `chips` array — `offer`, `prep due`,
   * `24d left` — rendered with the same component as the user's keywords, so a
   * tag the app invented was indistinguishable from one the user chose. Baylor
   * ended up saying "Offer" twice in its own header (once as its stage, once as
   * a chip) and Rice said "Deadline Nov 1" in the note and "24d left" beside it,
   * in two different date vocabularies. Everything it carried is derived
   * elsewhere now: the stage from `stage`, the countdown from the timeline, "due
   * something" from the flag. Keywords are the user's system and stay.
   */
  /** What last happened, for the activity feed. */
  lastAction: string
  /** Days since lastAction. Drives ordering; a real store would use a date. */
  daysAgo: number
  source?: Source
  location?: string
  comp?: string
  url?: string
  /** All 'YYYY-MM-DD'. Optional because the mock rows predate them. */
  appliedOn?: string
  submittedOn?: string
  firstReplyOn?: string
  outcome?: Outcome
  /** Present only while stage === 'offer'. */
  offer?: Offer
}

/**
 * 'Stripe — ML engineer' — an em dash with spaces either side.
 *
 * Byte-identical to the packed string the split replaced, so every existing
 * render stays as it was.
 */
/**
 * 'Rice — Assistant professor', or just 'Rice'.
 *
 * Only the employer is required on an application, and a posting promoted from
 * a URL that names no job ('jobs.rice.edu/postings/29411') arrives with the
 * role blank. Interpolating it regardless left a dangling separator on the end
 * of the name — punctuation promising a second half that is not there.
 */
export function displayName(a: Pick<Application, 'org' | 'role'>) {
  return a.role.trim() ? `${a.org} — ${a.role}` : a.org
}

/** Negative once the date has passed, so an expired offer reads as expired. */
export function offerDaysLeft(offer: Offer, today: string = TODAY) {
  return daysBetween(today, offer.respondBy)
}

/** 'Nov 15'. */
export function respondByLabel(offer: Offer) {
  return shortDate(offer.respondBy)
}

/**
 * `source` is taken from what each row already said where it said anything —
 * "Added from Job scout", "Referral from D. Chen" — and filled in plausibly
 * where it said nothing, so the sources breakdown has something to count.
 */
export const applications: Application[] = [
  {
    id: 'baylor',
    org: 'Baylor',
    role: 'CS',
    note: 'Respond by Nov 15 · negotiating',
    roleTag: 'Assistant Professor',
    stage: 'offer',
    lastAction: 'Offer received',
    daysAgo: 1,
    source: 'Job scout',
    location: 'Waco, TX',
    submittedOn: '2026-08-24',
    firstReplyOn: '2026-09-14',
    offer: {
      respondBy: '2026-11-15',
      comp: '$112k + $15k startup',
      note: 'Negotiating startup package and teaching load',
    },
  },
  {
    id: 'stripe',
    org: 'Stripe',
    role: 'ML engineer',
    note: 'Onsite Oct 30 · 5 rounds',
    roleTag: 'ML Engineer',
    stage: 'interview',
    lastAction: 'Onsite scheduled',
    daysAgo: 2,
    source: 'Referral',
    location: 'South San Francisco, CA',
    url: 'https://stripe.com/jobs/listing/ml-engineer-inference',
    submittedOn: '2026-09-25',
    firstReplyOn: '2026-10-02',
  },
  {
    id: 'ut-austin',
    org: 'UT Austin',
    role: 'CS',
    note: 'Submitted Sep 20 · snapshot saved',
    roleTag: 'Assistant Professor',
    stage: 'submitted',
    flagged: true,
    lastAction: 'Flagged for follow-up',
    daysAgo: 3,
    source: 'Job board',
    location: 'Austin, TX',
    submittedOn: '2026-09-20',
  },
  {
    id: 'texas-tech',
    org: 'Texas Tech',
    role: 'ECE',
    note: 'Zoom with committee Oct 28',
    roleTag: 'Assistant Professor',
    stage: 'screen',
    lastAction: 'Committee call scheduled',
    daysAgo: 4,
    source: 'Job scout',
    location: 'Lubbock, TX',
    submittedOn: '2026-09-08',
    firstReplyOn: '2026-10-05',
  },
  {
    id: 'uh',
    org: 'UH',
    role: 'Assistant professor, CS',
    note: 'Campus visit Nov 6 · job talk',
    roleTag: 'Assistant Professor',
    stage: 'interview',
    lastAction: 'Campus visit confirmed',
    daysAgo: 5,
    source: 'Job board',
    location: 'Houston, TX',
    submittedOn: '2026-08-30',
    firstReplyOn: '2026-09-21',
  },
  {
    id: 'rice',
    org: 'Rice',
    role: 'Statistics',
    note: 'Deadline Nov 1 · statements missing',
    roleTag: 'Assistant Professor',
    stage: 'draft',
    lastAction: 'Draft created',
    daysAgo: 6,
    source: 'Careers page',
    location: 'Houston, TX',
    url: 'https://jobs.rice.edu/postings/statistics-tt',
  },
  {
    id: 'databricks',
    org: 'Databricks',
    role: 'ML engineer',
    note: 'Recruiter reply overdue',
    roleTag: 'ML Engineer',
    stage: 'submitted',
    lastAction: 'Recruiter replied',
    daysAgo: 7,
    source: 'Job board',
    location: 'Remote',
    submittedOn: '2026-09-12',
    firstReplyOn: '2026-10-03',
  },
  {
    id: 'tamu',
    org: 'Texas A&M',
    role: 'ECE',
    note: 'No response in 21 days',
    roleTag: 'Assistant Professor',
    stage: 'submitted',
    flagged: true,
    lastAction: 'Application submitted',
    daysAgo: 9,
    source: 'Job scout',
    location: 'College Station, TX',
    submittedOn: '2026-10-02',
  },
  {
    id: 'meta',
    org: 'Meta',
    role: 'Research scientist',
    note: 'Rolling · referral pending',
    roleTag: 'Researcher',
    stage: 'draft',
    lastAction: 'Referral requested',
    daysAgo: 11,
    source: 'Careers page',
    location: 'Menlo Park, CA',
  },
  {
    id: 'unt',
    org: 'UNT',
    role: 'Assistant professor, CS',
    note: 'Deadline Nov 20',
    roleTag: 'Assistant Professor',
    stage: 'draft',
    lastAction: 'Added from Job scout',
    daysAgo: 12,
    source: 'Job scout',
    location: 'Denton, TX',
  },
  {
    id: 'google',
    org: 'Google',
    role: 'Research eng.',
    note: 'Rejected Oct 2',
    roleTag: 'Researcher',
    stage: 'closed',
    lastAction: 'Rejected',
    daysAgo: 14,
    source: 'Careers page',
    location: 'Mountain View, CA',
    submittedOn: '2026-08-18',
    firstReplyOn: '2026-10-02',
    outcome: 'rejected',
  },
  {
    id: 'smu',
    org: 'SMU',
    role: 'Lecturer',
    note: 'Withdrawn',
    roleTag: 'Lecturer',
    stage: 'closed',
    lastAction: 'Withdrawn',
    daysAgo: 20,
    source: 'Referral',
    location: 'Dallas, TX',
    submittedOn: '2026-07-30',
    outcome: 'withdrawn',
  },
]

/**
 * One colour per phase.
 *
 * Draft and Closed both used --text-3, and Submitted and Screening call both
 * --info, so six stages rendered as four colours and the funnel read as though
 * it doubled back. The stage tokens are validated in index.css for contrast
 * against the bar track and for separation under colour-blind simulation.
 *
 * `label` is prose and free to change; `id` is the wire format — it is written
 * into '?stage=' links, read back by `useApplicationsParams`, and keys the
 * `--stage-*` tokens. "Screen" became "Screening call" because on its own the
 * word is a verb as often as a noun; the id stayed 'screen' so no saved link
 * broke. Nothing may lay out on a label's length: this one went from 6 to 14
 * characters.
 */
export const STAGES: { id: Stage; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'screen', label: 'Screening call' },
  { id: 'interview', label: 'Interview' },
  { id: 'offer', label: 'Offer' },
  { id: 'closed', label: 'Closed' },
]

/** Every stage's label, keyed by its wire id — the lookup ten surfaces want. */
export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label])) as Record<
  Stage,
  string
>

/**
 * The web version carried a Tailwind class here (`dot: 'bg-stage-draft'`).
 * There are no class names on this platform, so the colour is looked up from
 * the live palette instead — one function, so a stage dot on a board card and a
 * bar in the pipeline chart can never resolve to different hexes.
 */
export function stageColor(stage: Stage, palette: { stage: Record<Stage, string> }) {
  return palette.stage[stage]
}

/** An application known to carry offer details, so consumers need no `!`. */
export type OfferApplication = Application & { offer: NonNullable<Application['offer']> }

/**
 * Job roles the user tracks. "Academia vs industry" was too blunt — a
 * postdoc and a lecturer are both academia but nothing like each other, and
 * the split told you nothing you could act on.
 */
export const ROLES = [
  'Assistant Professor',
  'Postdoc',
  'Researcher',
  'ML Engineer',
  'Lecturer',
] as const
export type RoleTag = (typeof ROLES)[number]

export type RoleBucket = { label: string; counts: Record<RoleTag, number> }

/** Compact constructor — counts follow ROLES order. */
const bucket = (label: string, v: readonly number[]): RoleBucket => ({
  label,
  counts: Object.fromEntries(ROLES.map((r, i) => [r, v[i] ?? 0])) as Record<RoleTag, number>,
})

export type Period = 'week' | 'month' | 'quarter'

/**
 * Each period is its own window, so totals differ between them — a quarter view
 * covers earlier searches, a week view only this season. That is how a real
 * range selector behaves.
 */
export const frequencyByPeriod: Record<Period, RoleBucket[]> = {
  //                        AsstProf Postdoc Researcher MLEng Lecturer
  week: [
    bucket('Jul 21', [1, 0, 0, 0, 0]),
    bucket('Jul 28', [1, 1, 0, 1, 0]),
    bucket('Aug 4', [1, 0, 1, 0, 0]),
    bucket('Aug 11', [2, 1, 0, 0, 0]),
    bucket('Aug 18', [1, 1, 0, 1, 0]),
    bucket('Aug 25', [2, 1, 1, 1, 0]),
    bucket('Sep 1', [1, 1, 0, 1, 1]),
    bucket('Sep 8', [2, 0, 1, 1, 0]),
    bucket('Sep 15', [1, 0, 1, 1, 0]),
    bucket('Sep 22', [2, 1, 0, 0, 0]),
    bucket('Sep 29', [1, 1, 0, 1, 0]),
    bucket('Oct 6', [1, 0, 1, 1, 0]),
  ],
  month: [
    bucket('Jun', [1, 1, 0, 1, 0]),
    bucket('Jul', [2, 1, 1, 2, 0]),
    bucket('Aug', [4, 2, 1, 1, 1]),
    bucket('Sep', [3, 2, 2, 2, 1]),
    bucket('Oct', [2, 1, 1, 2, 1]),
    bucket('Nov', [1, 0, 1, 0, 0]),
  ],
  quarter: [
    bucket('Q1', [1, 1, 1, 2, 0]),
    bucket('Q2', [3, 2, 1, 2, 1]),
    bucket('Q3', [7, 4, 3, 3, 1]),
    bucket('Q4', [6, 4, 4, 5, 1]),
  ],
}

export const PERIODS: { value: Period; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
]
