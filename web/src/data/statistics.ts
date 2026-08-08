/** Analytics for the Statistics page. Every total reconciles to 37. */

export type Kpi = {
  label: string
  value: string
  note: string
  delta?: string
  trend?: 'up' | 'down'
  /** True when a rising number is bad — reply time, for instance. */
  inverse?: boolean
}

export const kpis: Kpi[] = [
  { label: 'Response rate', value: '38%', note: '14 of 37 replied', delta: '+6 pts', trend: 'up' },
  {
    label: 'Interview rate',
    value: '11%',
    note: '4 of 37 reached interview',
    delta: '+2 pts',
    trend: 'up',
  },
  { label: 'Offer rate', value: '2.7%', note: '1 of 37 converted', delta: '+2.7 pts', trend: 'up' },
  {
    label: 'Median reply time',
    value: '18d',
    note: 'from submission to first reply',
    delta: '+3d',
    trend: 'up',
    inverse: true,
  },
]

export type FunnelStep = { stage: string; count: number }

export const funnel: FunnelStep[] = [
  { stage: 'Applied', count: 37 },
  { stage: 'Responded', count: 14 },
  { stage: 'Screened', count: 8 },
  { stage: 'Interviewed', count: 4 },
  { stage: 'Offer', count: 1 },
]

export type TrackRow = {
  track: string
  applied: number
  responded: number
  interviews: number
  offers: number
}

export const trackComparison: TrackRow[] = [
  { track: 'Academia', applied: 26, responded: 10, interviews: 3, offers: 1 },
  { track: 'Industry', applied: 11, responded: 4, interviews: 1, offers: 0 },
]

/**
 * Radar axes. Per Infogram, a radar chart is for "comparing multiple variables
 * for a single data point" to "reveal strengths and weaknesses at a glance" —
 * which is exactly a self-assessment against a benchmark.
 *
 * `score` is where you are, `target` is a healthy search. The gap is the
 * suggestion.
 */
export type RadarAxis = {
  axis: string
  score: number
  target: number
  /** Shown when this axis is the weakest. */
  suggestion: string
}

export const searchHealth: RadarAxis[] = [
  {
    axis: 'Volume',
    score: 78,
    target: 70,
    suggestion: 'Application volume is ahead of target — protect quality over adding more.',
  },
  {
    axis: 'Response rate',
    score: 52,
    target: 70,
    suggestion: 'Below target. Tailor the opening paragraph per posting rather than reusing one.',
  },
  {
    axis: 'Follow-up',
    score: 34,
    target: 80,
    suggestion:
      'Weakest area. Three follow-ups are overdue — clear them before applying anywhere new.',
  },
  {
    axis: 'Materials',
    score: 64,
    target: 75,
    suggestion: 'Teaching statement is a month old while you keep sending it. Refresh it.',
  },
  {
    axis: 'Referrals',
    score: 41,
    target: 65,
    suggestion: 'Only one referral so far. Referred applications convert several times better.',
  },
  {
    axis: 'Interview prep',
    score: 70,
    target: 75,
    suggestion: 'Roughly on track. Book a mock job talk before the UH campus visit.',
  },
]

export type Outcome = { label: string; count: number; tone: 'teal' | 'red' | 'gray' | 'green' }

export const outcomes: Outcome[] = [
  { label: 'In progress', count: 21, tone: 'teal' },
  { label: 'Rejected', count: 12, tone: 'red' },
  { label: 'Withdrawn', count: 3, tone: 'gray' },
  { label: 'Offer', count: 1, tone: 'green' },
]
