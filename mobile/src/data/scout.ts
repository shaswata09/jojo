export type Pipeline = {
  id: string
  name: string
  source: string
  schedule: string
  filter: string
  enabled: boolean
}

export const pipelines: Pipeline[] = [
  {
    id: 'cra',
    name: 'CRA faculty job board',
    source: 'cra.org/ads',
    schedule: 'daily',
    filter: 'assistant professor, CS/ECE',
    enabled: true,
  },
  {
    id: 'higheredjobs',
    name: 'HigherEdJobs — computer science',
    source: 'higheredjobs.com/faculty',
    schedule: 'daily',
    filter: 'region: TX, remote',
    enabled: true,
  },
  {
    id: 'stripe',
    name: 'Stripe careers — ML',
    source: 'stripe.com/jobs/search?q=machine+learning',
    schedule: 'weekly',
    filter: '—',
    enabled: false,
  },
]

export type Match = {
  id: string
  role: string
  detail: string
  fit: number
  /** Set once the match has been promoted. The match itself stays in the feed. */
  applicationId?: string
}

export const matches: Match[] = [
  {
    id: 'unt',
    role: 'UNT — Assistant professor, machine learning',
    detail: 'Deadline Nov 20 · matches ML systems, teaching focus, TX',
    fit: 92,
    applicationId: 'unt',
  },
  {
    id: 'utsa',
    role: 'UTSA — Assistant professor, data science',
    detail: 'Deadline Dec 1 · matches ML, statistics minor',
    fit: 85,
  },
  {
    id: 'oracle',
    role: 'Oracle — Applied scientist, Austin',
    detail: 'Rolling · matches ML systems; missing cloud infra',
    fit: 64,
  },
  {
    id: 'tarleton',
    role: 'Tarleton State — Lecturer, CS',
    detail: 'Deadline Nov 30 · below your seniority target',
    fit: 41,
  },
]

export type SavedPosting = {
  id: string
  title: string
  url: string
  /** ISO date the snapshot was taken. Rendered through `agoLabel`. */
  savedOn: string
  size: string
  /** `linked` is this edge rendered as a boolean; the store keeps them in step. */
  linked: boolean
  applicationId?: string
}

export const savedPostings: SavedPosting[] = [
  {
    id: 'rice',
    title: 'Assistant Professor of Computer Science — Rice University',
    url: 'jobs.rice.edu/postings/29411',
    savedOn: '2026-10-09',
    size: '1.1 MB',
    linked: false,
  },
  {
    id: 'stripe',
    title: 'ML Engineer, Payments — Stripe',
    url: 'stripe.com/jobs/listing/4482',
    savedOn: '2026-10-07',
    size: '0.8 MB',
    linked: true,
    applicationId: 'stripe',
  },
]
