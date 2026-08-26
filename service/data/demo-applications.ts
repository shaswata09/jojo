/**
 * The demo store's application rows, and nothing else.
 *
 * ## Why these left `data/seed.ts`
 *
 * That module was two things wearing one name: the domain VOCABULARY — stage
 * lists, period lists, label helpers, re-exports from `kg/core` — and this
 * fixture. 103 files import it, and four of them want the fixture: the seeder
 * and three tests. So a production file that needed `STAGES` pulled in two
 * hundred lines of invented job applications, and `import { STAGES,
 * applications }` was one autocomplete away from shipping demo data into a real
 * screen.
 *
 * Splitting this direction rather than the other is deliberate. Moving the
 * vocabulary out would have been the same end state and 103 import rewrites;
 * moving the fixture out is four, and it is the half that carries the risk.
 *
 * The remaining tidy-up — `data/seed.ts` holds no seed and should be called
 * `data/vocabulary.ts` — is a rename with no behaviour behind it, and is worth
 * doing when nothing else is in flight.
 */
import type { Application } from './seed'

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
    note: 'Negotiating the package',
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
    note: 'Onsite · 5 rounds',
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
    note: 'Submitted · snapshot saved',
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
    note: 'Zoom with the committee',
    roleTag: 'Assistant Professor',
    stage: 'screen',
    lastAction: 'Committee call scheduled',
    daysAgo: 4,
    source: 'Job scout',
    location: 'Santa Clara, CA',
    submittedOn: '2026-09-08',
    firstReplyOn: '2026-10-05',
  },
  {
    id: 'uh',
    org: 'UH',
    role: 'Assistant professor, CS',
    note: 'Campus visit · job talk',
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
    note: 'Statements still missing',
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
    /**
     * The second Rice row, and the only pair in the fixtures that shares an
     * employer.
     *
     * Converted from a Meta research-scientist row rather than added beside it,
     * so the seed is still twelve applications — five separate pieces of
     * user-facing copy count them out loud ("Twelve applications, a timeline and
     * a full vault"), and a thirteenth would have made all five wrong to buy one
     * fixture.
     *
     * Two roles at one university is the commonest shape of an academic job
     * search and this seed had none of it: all twelve employers were distinct,
     * which made the org-per-employer rule look like an org-per-row rule. It is
     * also the ONLY fixture that exercises that rule. `memory.reset` compiles
     * every application in one transaction, calling `org.ensure` and
     * `ctx.mintSlug` per row, so with twelve distinct employers the repeat case
     * never ran — the transaction overlay's whole job, a staged node being
     * visible to the rest of its own transaction, was unobservable from the test
     * suite. `seed.test.ts` beside this file asserts it; delete this row's
     * duplicate employer and the first case there fails rather than silently
     * disarming the other two.
     */
    id: 'rice-research',
    org: 'Rice',
    role: 'Research scientist',
    note: 'Rolling · same committee as the Statistics post',
    roleTag: 'Researcher',
    stage: 'draft',
    lastAction: 'Referral requested',
    daysAgo: 11,
    source: 'Careers page',
    location: 'Houston, TX',
  },
  {
    id: 'unt',
    org: 'UNT',
    role: 'Assistant professor, CS',
    note: 'Applications open',
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
    note: 'Rejected after the first round',
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
