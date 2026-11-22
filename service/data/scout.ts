/**
 * Scout fixtures. The three record types moved down to `kg/core/model` and
 * are re-exported here so every existing import still resolves.
 */

import type { Match, Pipeline, SavedPosting } from '../kg/core/model'

export type { Match, Pipeline, SavedPosting } from '../kg/core/model'

/*
 * The two academic boards are real sites, so they are seeded SWITCHED OFF.
 * They used to be seeded on, which meant a new person who did nothing but add
 * a model found the scout already crawling cra.org and higheredjobs.com on a
 * daily timer in their browser — reading somebody else's server because of
 * demo data they never chose. A person turns one on when they want it. Only
 * new seeds are affected: a pipeline already in someone's store keeps whatever
 * they set.
 */
export const pipelines: Pipeline[] = [
  {
    id: 'cra',
    name: 'CRA faculty job board',
    source: 'cra.org/ads',
    schedule: 'daily',
    filter: 'assistant professor, CS/ECE',
    enabled: false,
  },
  {
    id: 'higheredjobs',
    name: 'HigherEdJobs — computer science',
    source: 'higheredjobs.com/faculty',
    schedule: 'daily',
    filter: 'region: TX, remote',
    enabled: false,
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

export const matches: Match[] = [
  {
    id: 'unt',
    role: 'UNT — Assistant professor, machine learning',
    detail: 'Matches ML systems, teaching focus, TX',
    fit: 92,
    applicationId: 'unt',
  },
  {
    id: 'utsa',
    role: 'UTSA — Assistant professor, data science',
    detail: 'Matches ML, statistics minor',
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
    detail: 'Below your seniority target',
    fit: 41,
  },
]

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
