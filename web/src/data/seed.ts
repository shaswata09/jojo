/**
 * The seed the session store starts from.
 *
 * Transcribed from the design mockup. Nothing here is mutated in place, and
 * nothing here is state: these arrays are read exactly twice, by `repo/seed.ts`
 * and by the `memory.reset` tool, each of which COMPILES them into graph nodes.
 * Every edit the user makes lands on those nodes. (This paragraph used to say
 * the arrays were "the initial value handed to `StoreProvider`" and that edits
 * lived "in that reducer" — there has been no reducer since Wave 1, and the
 * provider never saw the fixtures.)
 *
 * Fixtures only, as of the KG layer. The domain types moved DOWN to
 * `@/kg/core/model` and are re-exported here, so every existing import still
 * resolves — but the model no longer depends on this file, and a demo record is
 * no longer the definition of what a record is. There is deliberately no badge
 * field on an application: rows used to carry a hand-authored `chips` array —
 * `offer`, `prep due`, `24d left` — rendered with the same component as the
 * user's keywords, so a tag the app invented was indistinguishable from one the
 * user chose. Everything it carried is derived elsewhere now.
 */

import { shortDate } from '@/kg/core/dates'
import { STAGE_LABEL, STAGE_VALUES } from '@/kg/core/model'
import type { Application, Offer, Stage } from '@/kg/core/model'

export { ROLES, SOURCES, STAGE_LABEL } from '@/kg/core/model'
/* `offerDaysLeft` followed `kg/react/use-priority.ts`, its only reader outside
 * this file's own callers, down into `kg/core/dates.ts`. `respondByLabel` below
 * stayed: nothing under `src/kg` asks for it. */
export { offerDaysLeft } from '@/kg/core/dates'
export type {
  Application,
  Offer,
  OfferApplication,
  Outcome,
  RoleTag,
  Source,
  Stage,
  Urgency,
} from '@/kg/core/model'

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

/*
 * `STAGE_LABEL` moved to `kg/core/model.ts`, beside the `STAGE_VALUES` union it
 * annotates, and is re-exported below so the 52 modules importing it from here
 * did not move. It left because `kg/tools/support.ts` had to re-export it in
 * turn — the model's own prose for its own enum was filed under demo data, and
 * two layers of the service layer reached through the `@/data` alias to read six
 * words. `STAGE_DOT` stayed: its values are Tailwind class names.
 */

/**
 * One colour per phase.
 *
 * Draft and Closed both used --text-3, and Submitted and Screening call both
 * --info, so six stages rendered as four colours and the funnel read as though
 * it doubled back. The stage tokens are validated in index.css for contrast
 * against the bar track and for separation under colour-blind simulation.
 *
 * Whole class names, never interpolated: Tailwind scans source text, so
 * `bg-stage-${id}` would compile to no CSS at all.
 */
export const STAGE_DOT: Record<Stage, string> = {
  draft: 'bg-stage-draft',
  submitted: 'bg-stage-submitted',
  screen: 'bg-stage-screen',
  interview: 'bg-stage-interview',
  offer: 'bg-stage-offer',
  closed: 'bg-stage-closed',
}

/**
 * The six stages in funnel order, which is the order the board columns, the
 * pipeline bar and the stage menu all read in.
 *
 * Derived from `STAGE_VALUES` rather than listed again, so the order is the
 * model's and the two lookups above are the only place a stage's prose lives.
 * `STAGE_VALUES` is where a stage is added; the compiler then asks for its label
 * and its dot before this file will build.
 */
export const STAGES: { id: Stage; label: string; dot: string }[] = STAGE_VALUES.map((id) => ({
  id,
  label: STAGE_LABEL[id],
  dot: STAGE_DOT[id],
}))

/**
 * A frozen `frequencyByPeriod` table used to sit here — three ranges of
 * hand-authored counts, with a `RoleBucket` type and a `bucket()` constructor
 * that existed only to build it. `ApplicationFrequency` counts the real records
 * now and has said so in a past-tense comment for two waves, while the table it
 * replaced stayed exported with no consumer at all. Deleted.
 */
export type Period = 'week' | 'month' | 'quarter'

export const PERIODS: { value: Period; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
]
