/**
 * Everything the Statistics page reports — counted from the store, not invented.
 *
 * This module used to hold the SHAPE of a made-up 37-application search,
 * projected onto however many records you actually had. That projection is what
 * made a single Draft application report an offer: each funnel step was floored
 * at one, so `applied = 1` filled all five rows and the page told a first-run
 * user they had already been interviewed and hired — beside an Outcomes panel
 * correctly saying "Offer 0" and a board showing one draft.
 *
 * A `Sample` chip could never fix that, because the denominator underneath it
 * was the user's real total: "Offer rate 2.7% · 1 of 1 reached an offer"
 * contradicted itself before it contradicted anything else on the page.
 *
 * So nothing here invents a count any more. The only literals left are the
 * TYPICAL benchmarks below, and every one of them reaches the screen behind the
 * word "typical" — a second figure to compare against, never the user's own.
 */

import type { Application, RoleTag } from '@/data/seed'
import { ROLES } from '@/data/seed'
import { daysBetween } from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'

/**
 * A typical search, for the comparison figure beside each real one.
 *
 * Deliberately round. The old page printed a fabricated offer rate as "2.7%",
 * and a made-up number carrying a decimal place is a made-up number wearing a
 * lab coat — precision is the one thing it has not got.
 */
export const TYPICAL = {
  responseRate: 38,
  interviewRate: 11,
  offerRate: 3,
  replyDays: 18,
  /** Share of records that have left Draft. */
  sentShare: 90,
  /** Share of applications that came through a referral. */
  referralShare: 20,
  /** Share of open follow-ups that are not yet late. */
  followUpsOnTime: 90,
  /** Share of live applications touched inside `STALE_DAYS`. */
  keptMoving: 70,
} as const

/** After a fortnight with no activity, an application has gone quiet. */
const STALE_DAYS = 14

/* ------------------------------ how far it got ---------------------------- */

/**
 * The rank a record has to reach to be counted at each funnel step.
 *
 * The store keeps only the CURRENT stage, so this reads how far a record can be
 * *shown* to have got: its stage, plus the two dates it carries. A closed
 * application that reached an interview before it was rejected therefore counts
 * only as far as its `firstReplyOn` — the app never recorded the rest, and
 * guessing it back is how the old funnel came to disagree with the board.
 *
 * Under-counting is the safe direction: this can never claim more than the
 * board shows, which is the whole point.
 */
export const REACH = {
  draft: 0,
  sent: 1,
  replied: 2,
  screen: 3,
  interview: 4,
  offer: 5,
} as const

export function reachedOf(a: Application): number {
  // `declined` and `accepted` both mean an offer existed, so a closed record
  // still counts at the end of the funnel — that is what happened to it.
  if (a.stage === 'offer' || a.outcome === 'accepted' || a.outcome === 'declined')
    return REACH.offer
  if (a.stage === 'interview') return REACH.interview
  if (a.stage === 'screen') return REACH.screen
  if (a.firstReplyOn) return REACH.replied
  if (a.stage === 'submitted' || a.stage === 'closed' || a.submittedOn || a.appliedOn)
    return REACH.sent
  return REACH.draft
}

/* --------------------------------- helpers -------------------------------- */

/** Rounded the way the funnel panel rounds, so the two can never disagree. */
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)

/** Null rather than zero: "no follow-ups at all" is not "0% on time". */
const shareOrNull = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : null)

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/* ---------------------------------- funnel -------------------------------- */

export type FunnelStep = { stage: string; count: number }

/** In order. A record counts at step `i` when it reached rank `i + 1`. */
const FUNNEL_STEPS = ['Applied', 'Replied', 'Screening call', 'Interview', 'Offer'] as const

/**
 * Counted as nested subsets of one another, so the funnel can only ever narrow
 * — no clamping needed, and no step can round itself into existence.
 */
function funnelFor(all: readonly Application[]): FunnelStep[] {
  const reached = all.map(reachedOf)
  return FUNNEL_STEPS.map((stage, i) => ({
    stage,
    count: reached.filter((r) => r >= i + 1).length,
  }))
}

/* ---------------------------------- KPIs ---------------------------------- */

export type Kpi = {
  label: string
  /** '—' when the store cannot support the figure. Never a guess. */
  value: string
  note: string
  /** The same figure for a typical search, always rendered as such. */
  typical: string
}

/** Every reply whose gap can actually be measured — both dates present. */
function replyGaps(all: readonly Application[]): number[] {
  return all
    .map((a) => {
      // Same fallback order as the frequency chart: seed rows carry
      // `submittedOn` and rows the user creates carry `appliedOn`.
      const sent = a.appliedOn ?? a.submittedOn
      return sent && a.firstReplyOn ? daysBetween(sent, a.firstReplyOn) : null
    })
    .filter((n): n is number => n !== null && n >= 0)
    .sort((a, b) => a - b)
}

function kpisFor(all: readonly Application[], funnel: FunnelStep[]): Kpi[] {
  const sent = funnel[0].count
  const gaps = replyGaps(all)
  const mid = Math.floor(gaps.length / 2)
  const median =
    gaps.length === 0
      ? null
      : gaps.length % 2 === 1
        ? gaps[mid]
        : Math.round((gaps[mid - 1] + gaps[mid]) / 2)

  // The headline and the caption under it are now the same division, so a tile
  // can no longer read "11%" above "1 of 12".
  const rate = (label: string, step: number, verb: string, typical: number): Kpi => ({
    label,
    value: `${pct(funnel[step].count, sent)}%`,
    note: `${funnel[step].count} of ${sent} ${verb}`,
    typical: `${typical}% typical`,
  })

  return [
    rate('Response rate', 1, 'replied', TYPICAL.responseRate),
    rate('Interview rate', 3, 'reached an interview', TYPICAL.interviewRate),
    rate('Offer rate', 4, 'reached an offer', TYPICAL.offerRate),
    {
      label: 'Median reply time',
      value: median === null ? '—' : plural(median, 'day', 'days'),
      note:
        median === null
          ? 'no reply yet with both dates recorded'
          : `across ${plural(gaps.length, 'reply', 'replies')}`,
      typical: `${TYPICAL.replyDays} days typical`,
    },
  ]
}

/* -------------------------------- outcomes -------------------------------- */

/**
 * One band of the outcomes panel — a label and how many sent applications are
 * in it.
 *
 * Named `OutcomeBand`, not `Outcome`. `Outcome` is already a type in this
 * directory: the five-value union on a record (`rejected`, `withdrawn`,
 * `accepted`, `declined`, `ghosted`) declared in `kg/core/model.ts` and
 * re-exported by the sibling `seed.ts`. Two unrelated types under one name in
 * one folder is a mis-import the compiler cannot help with, because both are
 * plausible in an outcomes function's signature. It pairs with `OUTCOME_BANDS`
 * below, which is where the labels come from.
 */
export type OutcomeBand = { label: string; count: number }

/**
 * A partition of everything that has been SENT.
 *
 * It used to partition every record, drafts included, so that the panel's total
 * matched the board's. That is what put two offer percentages on one screen:
 * the headline read "Offer rate 11% · 1 of 9 reached an offer" and the band
 * eleven inches below it read "Offer 1 8%", because one divided by the nine
 * sent and the other by all twelve records. Both were labelled and both were
 * arithmetically right, which is exactly what made it unarguable and unusable —
 * a reader cannot tell a second measurement from a contradiction.
 *
 * Sent is the denominator that had to survive, because every other rate on the
 * page already uses it. It is also the truer reading of the word: a draft has
 * not had an outcome, it has not been anywhere. The old partition had to file
 * one under 'In progress', which claimed something was in train with an
 * employer who has never seen it.
 *
 * The bands now sum to the funnel's first step rather than to the board, and
 * 'Offer' is the same set as the funnel's last step — so the three statements
 * of that one number cross-foot instead of merely coexisting. The count the
 * board shows is still on the page: the panel heading says how many of the
 * store's records these are.
 */
export const OUTCOME_BANDS = ['In progress', 'Offer', 'Rejected', 'Withdrawn', 'No reply'] as const

/** Only what has gone out. Anything still in draft has no outcome to band. */
export function outcomesFor(all: readonly Application[]): OutcomeBand[] {
  const sent = all.filter((a) => reachedOf(a) >= REACH.sent)
  return OUTCOME_BANDS.map((label) => ({
    label,
    count: sent.filter((a) => bandOf(a) === label).length,
  }))
}

function bandOf(a: Application): (typeof OUTCOME_BANDS)[number] {
  // Offer first, or a live offer would be swept into "In progress" and the
  // panel would disagree with the funnel step beside it.
  if (a.stage === 'offer' || a.outcome === 'accepted' || a.outcome === 'declined') return 'Offer'
  if (a.stage !== 'closed') return 'In progress'
  if (a.outcome === 'rejected') return 'Rejected'
  if (a.outcome === 'ghosted') return 'No reply'
  // A record closed before the app started recording outcomes reads as
  // withdrawn — the same fallback the detail page settles on.
  return 'Withdrawn'
}

/* --------------------------------- by role -------------------------------- */

export type RoleRow = {
  role: RoleTag
  applied: number
  responded: number
  interviews: number
  offers: number
}

/**
 * Only the roles something has actually been sent for. A row of zeros under a
 * role the user has never applied for is data the page invented for itself.
 *
 * Every column is the same per-record test the funnel uses, so the rows
 * cross-foot against it exactly rather than approximately.
 */
function rolesFor(all: readonly Application[]): RoleRow[] {
  const sent = all.filter((a) => reachedOf(a) >= REACH.sent)
  return ROLES.filter((role) => sent.some((a) => a.roleTag === role)).map((role) => {
    const rows = sent.filter((a) => a.roleTag === role)
    const at = (rank: number) => rows.filter((a) => reachedOf(a) >= rank).length
    return {
      role,
      applied: rows.length,
      responded: at(REACH.replied),
      interviews: at(REACH.interview),
      offers: at(REACH.offer),
    }
  })
}

/* --------------------------------- surface -------------------------------- */

export type Stats = {
  /**
   * How many records have actually gone out. Every rate's denominator, the
   * outcome bands' included — that is the whole point of there being one.
   */
  sent: number
  funnel: FunnelStep[]
  kpis: Kpi[]
  /** Bands over the sent records only. Sums to `sent`, not to `all.length`. */
  outcomes: OutcomeBand[]
  roles: RoleRow[]
}

/** One call site, so the panels cannot drift apart. */
export function statsFor(all: readonly Application[]): Stats {
  const funnel = funnelFor(all)
  return {
    sent: funnel[0].count,
    funnel,
    kpis: kpisFor(all, funnel),
    outcomes: outcomesFor(all),
    roles: rolesFor(all),
  }
}

/* ------------------------------ search health ----------------------------- */

/**
 * One axis of the radar and the suggestion that falls out of it.
 *
 * `score` is the user's, counted; `target` is the typical search, invented and
 * labelled. The gap decides the ORDER of the suggestions and nothing else — it
 * used to be printed as a red `-46` chip beside every axis, which handed a
 * person looking for something to do next a report card on a process that is
 * demoralising enough already.
 */
export type HealthAxis = {
  axis: string
  /** 0–100, counted from the store. Null when there is nothing to count. */
  score: number | null
  target: number
  /** What the score is a share of, so it is never a bare number. */
  basis: string
  suggestion: string
}

/**
 * The suggestions used to be six fixed strings that never consulted anything:
 * "Three follow-ups are overdue", "One referral so far", "The teaching
 * statement is a month old", "before the UH campus visit". On a store the user
 * had just cleared, every one of them described somebody else's job search —
 * naming a record that no longer existed and a count the panel above it
 * contradicted. Each line below is either counted here or carries no count at
 * all.
 *
 * There is deliberately no "Materials" axis any more. Its old suggestion named
 * a teaching statement nobody had uploaded, and the only honest version of it —
 * the share of applications with a Vault record pointing at them — reads 0 of 9
 * on a store whose Vault is full, because files cannot be linked to an
 * application at all yet. An axis that can only say one thing is not a
 * diagnosis.
 */
export function searchHealthFor(input: {
  applications: readonly Application[]
  timeline: readonly TimelineItem[]
  /**
   * Passed in, not read from a constant. "Late" is the one axis below that
   * depends on the day it is asked on, and it was measured against the
   * fixtures' pinned October — so every open follow-up counted as late forever
   * once the calendar passed it, and the panel reported a search falling apart
   * on a store nobody had touched.
   */
  today: string
}): HealthAxis[] {
  const { applications, timeline, today } = input
  const total = applications.length
  const sent = applications.filter((a) => reachedOf(a) >= REACH.sent)
  const replied = sent.filter((a) => reachedOf(a) >= REACH.replied).length
  const interviewed = sent.filter((a) => reachedOf(a) >= REACH.interview).length
  const referred = applications.filter((a) => a.source === 'Referral').length
  const drafts = total - sent.length

  const openFollowUps = timeline.filter((i) => i.kind === 'follow-up' && !i.completedOn)
  const late = openFollowUps.filter((i) => i.date < today).length

  // Only the ones still live can go quiet — a closed application is meant to
  // sit still, and counting it as neglected would be a reproach for finishing.
  const live = sent.filter((a) => a.stage !== 'closed')
  const stale = live.filter((a) => a.daysAgo > STALE_DAYS).length

  return [
    {
      axis: 'Sent',
      score: shareOrNull(sent.length, total),
      target: TYPICAL.sentShare,
      basis: `${sent.length} of ${total} out of draft`,
      suggestion:
        drafts === 0
          ? 'Nothing is sitting in draft. Worth protecting the care in each one rather than adding more.'
          : `${plural(drafts, 'application is', 'applications are')} still in draft. A draft does nothing until it goes out, and the one closest to done is the cheapest to finish.`,
    },
    {
      axis: 'Replies',
      score: shareOrNull(replied, sent.length),
      target: TYPICAL.responseRate,
      basis: `${replied} of ${sent.length} replied`,
      suggestion:
        'Tailoring the opening paragraph to each posting moves this more than anything else.',
    },
    {
      axis: 'Interviews',
      score: shareOrNull(interviewed, sent.length),
      target: TYPICAL.interviewRate,
      basis: `${interviewed} of ${sent.length} reached an interview`,
      suggestion:
        'Replies that stall before a call usually mean the fit is not obvious in the first paragraph.',
    },
    {
      axis: 'Referrals',
      score: shareOrNull(referred, total),
      target: TYPICAL.referralShare,
      basis: `${referred} of ${total} came through a referral`,
      suggestion:
        'A referred application is several times likelier to get a reply, so one introduction is worth several cold sends.',
    },
    {
      axis: 'Follow-ups',
      score: shareOrNull(openFollowUps.length - late, openFollowUps.length),
      target: TYPICAL.followUpsOnTime,
      basis:
        openFollowUps.length === 0
          ? 'nothing open'
          : `${late} of ${openFollowUps.length} open follow-ups are late`,
      suggestion:
        late === 0
          ? 'Nothing is late. A chase a week or so after sending is usually the one that lands.'
          : `${plural(late, 'follow-up is', 'follow-ups are')} overdue. Clearing those usually pays off faster than applying somewhere new.`,
    },
    {
      axis: 'Kept moving',
      score: shareOrNull(live.length - stale, live.length),
      target: TYPICAL.keptMoving,
      basis:
        live.length === 0
          ? 'nothing live'
          : `${live.length - stale} of ${live.length} touched in the last fortnight`,
      suggestion:
        stale === 0
          ? 'Nothing has gone quiet. Recording what happened as it happens is what keeps this honest.'
          : `${plural(stale, 'live application has', 'live applications have')} had no activity in a fortnight. A short nudge costs less than starting somewhere new.`,
    },
  ]
}
