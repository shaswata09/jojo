/**
 * Demo content transcribed from the design mockup.
 * This is a stand-in for the real store — swap it for the browser-storage
 * layer once persistence is decided, keeping these shapes.
 */

export type Urgency = 'red' | 'amber' | 'gray'

export type Deadline = {
  id: string
  role: string
  detail: string
  due: string
  urgency: Urgency
}

export type FollowUp = {
  id: string
  org: string
  role: string
  reason: string
  /** Relative label for the timeline rail, e.g. "9 days ago". */
  when: string
  urgency: Urgency
}

export type Stat = {
  label: string
  value: string
  alert?: boolean
}

export type Stage = 'draft' | 'submitted' | 'screen' | 'interview' | 'offer' | 'closed'

export type Application = {
  id: string
  role: string
  note: string
  /** The job role this application is for — the axis the user filters on. */
  roleTag: RoleTag
  stage: Stage
  flagged?: boolean
  chips?: { label: string; tone: 'teal' | 'amber' | 'red' | 'green' | 'gray' }[]
  /** What last happened, for the activity feed. */
  lastAction: string
  /** Days since lastAction. Drives ordering; a real store would use a date. */
  daysAgo: number
  /** Present only while stage === 'offer'. */
  offer?: {
    respondBy: string
    daysLeft: number
    comp?: string
    note: string
  }
}

export type EventKind = 'deadline' | 'interview' | 'visit' | 'call' | 'prep'

export type AgendaEvent = {
  id: string
  /** Days from today; 0 is today. A real store would hold a date. */
  inDays: number
  title: string
  detail: string
  kind: EventKind
  urgency: Urgency
}

/** Headline counts. The dashboard subtitle and stat tiles both read from
 *  here so the two can't drift apart. */
export const summary = { total: 37, active: 21, interviews: 4 }

export const deadlines: Deadline[] = [
  {
    id: 'ut-austin',
    role: 'UT Austin — Assistant professor, CS',
    detail: 'Research + teaching + diversity statements',
    due: 'in 3 days',
    urgency: 'red',
  },
  {
    id: 'stripe',
    role: 'Stripe — ML engineer',
    detail: 'Referral from D. Chen',
    due: 'in 6 days',
    urgency: 'amber',
  },
  {
    id: 'texas-tech',
    role: 'Texas Tech — Assistant professor, ECE',
    detail: '3 reference letters required',
    due: 'in 15 days',
    urgency: 'gray',
  },
  {
    id: 'rice',
    role: 'Rice — Assistant professor, Statistics',
    detail: 'Draft not started',
    due: 'in 24 days',
    urgency: 'gray',
  },
]

export const followUps: FollowUp[] = [
  {
    id: 'ut-austin',
    org: 'UT Austin',
    role: 'Assistant professor, CS',
    reason: 'Confirm the application was received',
    when: 'Submitted 24 days ago',
    urgency: 'red',
  },
  {
    id: 'tamu',
    org: 'Texas A&M',
    role: 'Assistant professor, ECE',
    reason: 'No response since submission',
    when: '21 days of silence',
    urgency: 'red',
  },
  {
    id: 'databricks',
    org: 'Databricks',
    role: 'ML engineer',
    reason: 'Recruiter said "next week"',
    when: 'Promised 9 days ago',
    urgency: 'amber',
  },
]

// Declared after followUps so the count is derived, never hand-maintained.
export const stats: Stat[] = [
  { label: 'Applications', value: String(summary.total) },
  { label: 'Active', value: String(summary.active) },
  { label: 'Interviews', value: String(summary.interviews) },
  { label: 'Follow-ups due', value: String(followUps.length), alert: true },
]

export const applications: Application[] = [
  {
    id: 'baylor',
    role: 'Baylor — CS',
    note: 'Respond by Nov 15 · negotiating',
    roleTag: 'Assistant Professor',
    stage: 'offer',
    chips: [{ label: 'offer', tone: 'green' }],
    lastAction: 'Offer received',
    daysAgo: 1,
    offer: {
      respondBy: 'Nov 15',
      daysLeft: 34,
      comp: '$112k + $15k startup',
      note: 'Negotiating startup package and teaching load',
    },
  },
  {
    id: 'stripe',
    role: 'Stripe — ML engineer',
    note: 'Onsite Oct 30 · 5 rounds',
    roleTag: 'ML Engineer',
    stage: 'interview',
    chips: [{ label: 'prep due', tone: 'amber' }],
    lastAction: 'Onsite scheduled',
    daysAgo: 2,
  },
  {
    id: 'ut-austin',
    role: 'UT Austin — CS',
    note: 'Submitted Sep 20 · snapshot saved',
    roleTag: 'Assistant Professor',
    stage: 'submitted',
    flagged: true,
    chips: [{ label: 'follow up', tone: 'red' }],
    lastAction: 'Flagged for follow-up',
    daysAgo: 3,
  },
  {
    id: 'texas-tech',
    role: 'Texas Tech — ECE',
    note: 'Zoom with committee Oct 28',
    roleTag: 'Assistant Professor',
    stage: 'screen',
    chips: [{ label: 'prep due', tone: 'amber' }],
    lastAction: 'Committee call scheduled',
    daysAgo: 4,
  },
  {
    id: 'uh',
    role: 'UH — Assistant professor, CS',
    note: 'Campus visit Nov 6 · job talk',
    roleTag: 'Assistant Professor',
    stage: 'interview',
    chips: [{ label: 'slides draft', tone: 'amber' }],
    lastAction: 'Campus visit confirmed',
    daysAgo: 5,
  },
  {
    id: 'rice',
    role: 'Rice — Statistics',
    note: 'Deadline Nov 1 · statements missing',
    roleTag: 'Assistant Professor',
    stage: 'draft',
    chips: [{ label: '24d left', tone: 'gray' }],
    lastAction: 'Draft created',
    daysAgo: 6,
  },
  {
    id: 'databricks',
    role: 'Databricks — ML engineer',
    note: 'Recruiter reply overdue',
    roleTag: 'ML Engineer',
    stage: 'submitted',
    chips: [{ label: 'nudge', tone: 'amber' }],
    lastAction: 'Recruiter replied',
    daysAgo: 7,
  },
  {
    id: 'tamu',
    role: 'Texas A&M — ECE',
    note: 'No response in 21 days',
    roleTag: 'Assistant Professor',
    stage: 'submitted',
    flagged: true,
    chips: [{ label: 'follow up', tone: 'red' }],
    lastAction: 'Application submitted',
    daysAgo: 9,
  },
  {
    id: 'meta',
    role: 'Meta — Research scientist',
    note: 'Rolling · referral pending',
    roleTag: 'Researcher',
    stage: 'draft',
    lastAction: 'Referral requested',
    daysAgo: 11,
  },
  {
    id: 'unt',
    role: 'UNT — Assistant professor, CS',
    note: 'Deadline Nov 20',
    roleTag: 'Assistant Professor',
    stage: 'draft',
    chips: [{ label: '43d left', tone: 'gray' }],
    lastAction: 'Added from Job scout',
    daysAgo: 12,
  },
  {
    id: 'google',
    role: 'Google — Research eng.',
    note: 'Rejected Oct 2',
    roleTag: 'Researcher',
    stage: 'closed',
    lastAction: 'Rejected',
    daysAgo: 14,
  },
  {
    id: 'smu',
    role: 'SMU — Lecturer',
    note: 'Withdrawn',
    roleTag: 'Lecturer',
    stage: 'closed',
    lastAction: 'Withdrawn',
    daysAgo: 20,
  },
]

/**
 * One colour per phase.
 *
 * Draft and Closed both used --text-3, and Submitted and Screen both --info, so
 * six stages rendered as four colours and the funnel read as though it doubled
 * back. The stage tokens are validated in index.css for contrast against the
 * bar track and for separation under colour-blind simulation.
 */
export const STAGES: { id: Stage; label: string; dot: string }[] = [
  { id: 'draft', label: 'Draft', dot: 'bg-stage-draft' },
  { id: 'submitted', label: 'Submitted', dot: 'bg-stage-submitted' },
  { id: 'screen', label: 'Screen', dot: 'bg-stage-screen' },
  { id: 'interview', label: 'Interview', dot: 'bg-stage-interview' },
  { id: 'offer', label: 'Offer', dot: 'bg-stage-offer' },
  { id: 'closed', label: 'Closed', dot: 'bg-stage-closed' },
]

/** Most recently touched applications, newest first. Derived so the feed can
 *  never disagree with the application list itself. */
export const recentApplications = [...applications].sort((a, b) => a.daysAgo - b.daysAgo)

/** Count per stage, in pipeline order. */
export const stageCounts = STAGES.map((stage) => ({
  ...stage,
  count: applications.filter((a) => a.stage === stage.id).length,
}))

/** An application known to carry offer details, so consumers need no `!`. */
export type OfferApplication = Application & { offer: NonNullable<Application['offer']> }

/** Live offers, derived so the countdown can't disagree with the pipeline. */
export const offers: OfferApplication[] = applications.filter(
  (a): a is OfferApplication => a.stage === 'offer' && a.offer !== undefined,
)

/**
 * The mock's "today" is a fixed Monday so the demo never shifts under you.
 * Real dates arrive with persistence.
 */
export const weekDays = [
  { label: 'Mon', date: '12' },
  { label: 'Tue', date: '13' },
  { label: 'Wed', date: '14' },
  { label: 'Thu', date: '15' },
  { label: 'Fri', date: '16' },
  { label: 'Sat', date: '17' },
  { label: 'Sun', date: '18' },
]

/** Everything with a date attached — this week and beyond. */
export const agenda: AgendaEvent[] = [
  {
    id: 'ut-austin-prep',
    inDays: 0,
    title: 'Finalize UT Austin statements',
    detail: 'Research + teaching + diversity · deadline Thursday',
    kind: 'prep',
    urgency: 'red',
  },
  {
    id: 'advisor-sync',
    inDays: 1,
    title: 'Advisor sync — reference letters',
    detail: 'Chase the third letter for Texas Tech',
    kind: 'call',
    urgency: 'amber',
  },
  {
    id: 'ut-austin',
    inDays: 3,
    title: 'UT Austin — Assistant professor, CS',
    detail: 'Application deadline',
    kind: 'deadline',
    urgency: 'red',
  },
  {
    id: 'stripe-cv',
    inDays: 4,
    title: 'Tailor CV for Stripe',
    detail: 'Assistant can draft from the posting',
    kind: 'prep',
    urgency: 'gray',
  },
  {
    id: 'stripe',
    inDays: 6,
    title: 'Stripe — ML engineer',
    detail: 'Application deadline · referral from D. Chen',
    kind: 'deadline',
    urgency: 'amber',
  },
  // Beyond the week — kept here so nothing is lost when the card focuses on 7 days.
  {
    id: 'texas-tech-zoom',
    inDays: 16,
    title: 'Texas Tech — committee Zoom',
    detail: 'Oct 28 · 45 min',
    kind: 'interview',
    urgency: 'gray',
  },
  {
    id: 'stripe-onsite',
    inDays: 18,
    title: 'Stripe — onsite',
    detail: 'Oct 30 · 5 rounds',
    kind: 'interview',
    urgency: 'gray',
  },
  {
    id: 'uh-visit',
    inDays: 25,
    title: 'UH — campus visit',
    detail: 'Nov 6 · job talk',
    kind: 'visit',
    urgency: 'gray',
  },
]

export const thisWeek = agenda.filter((e) => e.inDays <= 6)
export const laterEvents = agenda.filter((e) => e.inDays > 6)

export type WeekBucket = { week: string; academia: number; industry: number }

/** Submissions per week for the last 12 weeks. Totals 37, matching `summary`. */
export const applicationFrequency: WeekBucket[] = [
  { week: 'Jul 21', academia: 1, industry: 0 },
  { week: 'Jul 28', academia: 2, industry: 1 },
  { week: 'Aug 4', academia: 1, industry: 1 },
  { week: 'Aug 11', academia: 3, industry: 0 },
  { week: 'Aug 18', academia: 2, industry: 1 },
  { week: 'Aug 25', academia: 4, industry: 1 },
  { week: 'Sep 1', academia: 2, industry: 2 },
  { week: 'Sep 8', academia: 3, industry: 1 },
  { week: 'Sep 15', academia: 1, industry: 2 },
  { week: 'Sep 22', academia: 3, industry: 0 },
  { week: 'Sep 29', academia: 2, industry: 1 },
  { week: 'Oct 6', academia: 2, industry: 1 },
]

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

export type SourceStat = { source: string; count: number }

/** Where applications originated. Also totals 37. */
export const applicationSources: SourceStat[] = [
  { source: 'Job scout', count: 14 },
  { source: 'Job board', count: 11 },
  { source: 'Referral', count: 7 },
  { source: 'Careers page', count: 5 },
]
