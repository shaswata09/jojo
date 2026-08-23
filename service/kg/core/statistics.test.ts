/**
 * The Statistics page's arithmetic, which had no test file at all.
 *
 * 447 lines, every one of them a number shown to the user, on BOTH platforms:
 * `web/src/routes/Statistics.tsx` and `mobile/src/screens/StatisticsScreen.tsx`
 * both call `statsFor`, and `SearchHealth` on the web dashboard and the phone's
 * statistics screen both call `searchHealthFor`. It was the largest untested
 * module in the shared package, and removing the even-sample average from
 * "Median reply time" — `Math.round((lo + hi) / 2)` for `hi` — was green on all
 * 474 tests.
 *
 * The cases below are chosen from this module's own header, which is unusually
 * specific about what it got wrong before: a single Draft reporting an offer, a
 * headline percentage disagreeing with the caption under it, two different
 * offer percentages on one screen, and an axis measured against a pinned October
 * so every follow-up was late forever. Each of those is a case here, because a
 * bug a module documents having had is the one most worth keeping out.
 *
 * Clock-free: `searchHealthFor` takes `today` as an argument (D26), and every
 * date below is a literal.
 */

import { describe, expect, it } from 'vitest'
import type { Application, Outcome, RoleTag, Stage, TimelineItem } from './model'
import {
  OUTCOME_BANDS,
  REACH,
  TYPICAL,
  outcomesFor,
  reachedOf,
  searchHealthFor,
  statsFor,
} from './statistics'

let n = 0

/**
 * The minimum an `Application` needs, plus whatever the case is about.
 *
 * `daysAgo` defaults to 0 rather than being left off: it is a required field and
 * it is the input to the "Kept moving" axis, so a fixture that omitted it would
 * silently make every record look freshly touched.
 */
function app(over: Partial<Application> = {}): Application {
  n += 1
  return {
    id: `a${n}`,
    org: `Org ${n}`,
    role: 'Assistant professor',
    note: '',
    roleTag: 'Assistant Professor',
    stage: 'draft',
    lastAction: 'Draft created',
    daysAgo: 0,
    ...over,
  }
}

const staged = (stage: Stage, over: Partial<Application> = {}) => app({ stage, ...over })
const closed = (outcome: Outcome, over: Partial<Application> = {}) =>
  app({ stage: 'closed', outcome, ...over })

function item(over: Partial<TimelineItem> = {}): TimelineItem {
  n += 1
  return {
    id: `t${n}`,
    title: 'Follow up',
    date: '2026-10-01',
    allDay: true,
    applicationIds: [],
    kind: 'follow-up',
    urgency: 'gray',
    remind: true,
    ...over,
  }
}

const kpi = (all: readonly Application[], label: string) => {
  const found = statsFor(all).kpis.find((k) => k.label === label)
  if (!found) throw new Error(`no KPI called ${label}`)
  return found
}

const band = (all: readonly Application[], label: string) => {
  const found = outcomesFor(all).find((b) => b.label === label)
  if (!found) throw new Error(`no outcome band called ${label}`)
  return found
}

const axis = (input: Parameters<typeof searchHealthFor>[0], name: string) => {
  const found = searchHealthFor(input).find((a) => a.axis === name)
  if (!found) throw new Error(`no axis called ${name}`)
  return found
}

/* ------------------------------ how far it got ---------------------------- */

describe('reachedOf', () => {
  it('leaves a bare draft at the bottom', () => {
    expect(reachedOf(app())).toBe(REACH.draft)
  })

  /**
   * A date is evidence on its own. A record dragged straight to Closed on the
   * board never passes through Submitted, and counting it as a draft would have
   * dropped it out of every denominator on the page.
   */
  it('counts a record as sent on its stage or on either sent date', () => {
    expect(reachedOf(staged('submitted'))).toBe(REACH.sent)
    expect(reachedOf(staged('closed'))).toBe(REACH.sent)
    expect(reachedOf(app({ submittedOn: '2026-09-01' }))).toBe(REACH.sent)
    expect(reachedOf(app({ appliedOn: '2026-09-01' }))).toBe(REACH.sent)
  })

  it('promotes a record that has a first reply', () => {
    expect(reachedOf(app({ firstReplyOn: '2026-09-20' }))).toBe(REACH.replied)
  })

  /**
   * The header's rule: `declined` and `accepted` both mean an offer existed, so
   * a closed record still counts at the end of the funnel — that is what
   * happened to it. `rejected` does not, and that is the pair worth pinning
   * together, because they are all `stage: 'closed'` and only the outcome
   * separates them.
   */
  it('counts a decided offer at the end of the funnel and a rejection not at all', () => {
    expect(reachedOf(closed('accepted'))).toBe(REACH.offer)
    expect(reachedOf(closed('declined'))).toBe(REACH.offer)
    expect(reachedOf(closed('rejected'))).toBe(REACH.sent)
  })

  /**
   * Under-counting is the safe direction, and this is where it shows: an
   * application that reached an interview before it was rejected counts only as
   * far as its `firstReplyOn`, because the app never recorded the rest.
   */
  it('never claims more than the record can show', () => {
    expect(reachedOf(closed('rejected', { firstReplyOn: '2026-09-20' }))).toBe(REACH.replied)
  })
})

/* ---------------------------------- funnel -------------------------------- */

describe('the funnel', () => {
  /**
   * The bug this module was rewritten for, stated as a test.
   *
   * Each step used to be floored at one, so a single Draft filled all five rows
   * and the page told a first-run user they had already been interviewed and
   * hired — beside an Outcomes panel correctly saying "Offer 0".
   */
  it('reports nothing at all for a single draft', () => {
    const stats = statsFor([app()])
    expect(stats.sent).toBe(0)
    expect(stats.funnel.map((f) => f.count)).toEqual([0, 0, 0, 0, 0])
    expect(stats.outcomes.every((b) => b.count === 0)).toBe(true)
    expect(stats.roles).toEqual([])
  })

  /** Counted as nested subsets, so it can only ever narrow. */
  it('never widens from one step to the next', () => {
    const counts = statsFor([
      app(),
      staged('submitted'),
      app({ firstReplyOn: '2026-09-20' }),
      staged('screen'),
      staged('interview'),
      staged('offer'),
      closed('accepted'),
    ]).funnel.map((f) => f.count)

    expect(counts).toEqual([6, 5, 4, 3, 2])
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i] ?? 0, `step ${i} widened`).toBeLessThanOrEqual(counts[i - 1] ?? 0)
    }
  })
})

/* ---------------------------------- KPIs ---------------------------------- */

describe('the KPI tiles', () => {
  /**
   * "The headline and the caption under it are now the same division, so a tile
   * can no longer read 11% above 1 of 12." Asserted as the two strings together,
   * because the bug was that they were computed twice.
   */
  it('divides the headline and the caption by the same denominator', () => {
    const all = [app(), staged('submitted'), staged('interview'), staged('offer')]
    // Three of the four are sent; the draft is in neither number.
    const response = kpi(all, 'Response rate')
    expect(response.note).toBe('2 of 3 replied')
    expect(response.value).toBe('67%')
    expect(kpi(all, 'Offer rate').note).toBe('1 of 3 reached an offer')
    expect(kpi(all, 'Offer rate').value).toBe('33%')
  })

  it('reads 0% rather than dividing by zero when nothing has been sent', () => {
    expect(kpi([app()], 'Response rate').value).toBe('0%')
  })

  /**
   * The even-sample average, which is the mutation that was green.
   *
   * Gaps of 2 and 8 days: `hi` is 8 and `lo` is 2, so the median is 5. Returning
   * `hi` alone — the shape the ternary had before both halves were pulled into
   * locals — reads "8 days" and is wrong by three days on every even sample.
   */
  it('averages the middle two when the sample is even', () => {
    const replied = [
      app({ appliedOn: '2026-10-01', firstReplyOn: '2026-10-03' }),
      app({ appliedOn: '2026-10-01', firstReplyOn: '2026-10-09' }),
    ]
    const median = kpi(replied, 'Median reply time')
    expect(median.value).toBe('5 days')
    expect(median.note).toBe('across 2 replies')
  })

  it('takes the middle one when the sample is odd', () => {
    const replied = [
      app({ appliedOn: '2026-10-01', firstReplyOn: '2026-10-03' }),
      app({ appliedOn: '2026-10-01', firstReplyOn: '2026-10-05' }),
      app({ appliedOn: '2026-10-01', firstReplyOn: '2026-10-21' }),
    ]
    expect(kpi(replied, 'Median reply time').value).toBe('4 days')
  })

  it('says a day rather than 1 days', () => {
    const replied = [app({ appliedOn: '2026-10-01', firstReplyOn: '2026-10-02' })]
    const median = kpi(replied, 'Median reply time')
    expect(median.value).toBe('1 day')
    expect(median.note).toBe('across 1 reply')
  })

  /** '—', never a guess, and a note that says why rather than showing a zero. */
  it('declines to invent a median with no measurable reply', () => {
    const median = kpi([staged('interview')], 'Median reply time')
    expect(median.value).toBe('—')
    expect(median.note).toBe('no reply yet with both dates recorded')
  })

  /**
   * A reply recorded before the send is not a negative gap, it is a typo — and
   * one negative number drags a median below zero, which reads as the app being
   * broken rather than the date being wrong.
   */
  it('drops a reply dated before the application went out', () => {
    const replied = [
      app({ appliedOn: '2026-10-10', firstReplyOn: '2026-10-01' }),
      app({ appliedOn: '2026-10-01', firstReplyOn: '2026-10-05' }),
    ]
    const median = kpi(replied, 'Median reply time')
    expect(median.note).toBe('across 1 reply')
    expect(median.value).toBe('4 days')
  })

  /** `appliedOn` first, then `submittedOn` — the same fallback the chart uses. */
  it('falls back to submittedOn for a seed row that has no appliedOn', () => {
    const replied = [app({ submittedOn: '2026-10-01', firstReplyOn: '2026-10-04' })]
    expect(kpi(replied, 'Median reply time').value).toBe('3 days')
  })

  it('labels every comparison figure as typical', () => {
    for (const k of statsFor([staged('submitted')]).kpis) expect(k.typical).toContain('typical')
    expect(kpi([staged('submitted')], 'Offer rate').typical).toBe(`${TYPICAL.offerRate}% typical`)
  })
})

/* -------------------------------- outcomes -------------------------------- */

describe('the outcome bands', () => {
  const mixed = () => [
    app(), // draft — banded nowhere
    staged('submitted'),
    staged('offer'),
    closed('accepted'),
    closed('rejected'),
    closed('ghosted'),
    closed('withdrawn'),
    app({ stage: 'closed' }), // no outcome recorded at all
  ]

  /**
   * The cross-foot the module's header argues for: the bands sum to the funnel's
   * first step, NOT to the board's total. Two offer percentages on one screen is
   * what the old partition produced — "1 of 9" in the headline and "1 of 12" in
   * the band eleven inches below it, both arithmetically right, which is exactly
   * what made it unarguable and unusable.
   */
  it('sums to sent, not to the number of records', () => {
    const all = mixed()
    const stats = statsFor(all)
    const total = stats.outcomes.reduce((sum, b) => sum + b.count, 0)

    expect(all).toHaveLength(8)
    expect(total).toBe(stats.sent)
    expect(total).not.toBe(all.length)
  })

  /** 'Offer' is the same set as the funnel's last step, not merely a similar one. */
  it('puts the Offer band and the funnel Offer step at the same number', () => {
    const stats = statsFor(mixed())
    expect(band(mixed(), 'Offer').count).toBe(stats.funnel[4]?.count)
  })

  it('bands a live offer as Offer rather than sweeping it into In progress', () => {
    expect(band([staged('offer')], 'Offer').count).toBe(1)
    expect(band([staged('offer')], 'In progress').count).toBe(0)
  })

  it('reads a record closed with no outcome as withdrawn', () => {
    expect(band([app({ stage: 'closed' })], 'Withdrawn').count).toBe(1)
  })

  it('files a ghosting under No reply and a rejection under Rejected', () => {
    expect(band([closed('ghosted')], 'No reply').count).toBe(1)
    expect(band([closed('rejected')], 'Rejected').count).toBe(1)
  })

  it('returns every band even when nothing is in it', () => {
    expect(outcomesFor([]).map((b) => b.label)).toEqual([...OUTCOME_BANDS])
  })
})

/* --------------------------------- by role -------------------------------- */

describe('the role table', () => {
  /** A row of zeros under a role nobody applied for is data the page invented. */
  it('lists only the roles something has actually been sent for', () => {
    const rows = statsFor([
      app({ roleTag: 'Lecturer' }), // draft — not sent, so no row
      staged('interview', { roleTag: 'ML Engineer' }),
    ]).roles

    expect(rows.map((r) => r.role)).toEqual<RoleTag[]>(['ML Engineer'])
  })

  it('cross-foots each column against the same test the funnel uses', () => {
    const rows = statsFor([
      staged('submitted', { roleTag: 'Postdoc' }),
      app({ roleTag: 'Postdoc', firstReplyOn: '2026-09-20' }),
      staged('interview', { roleTag: 'Postdoc' }),
      closed('accepted', { roleTag: 'Postdoc' }),
    ]).roles

    expect(rows[0]).toEqual({
      role: 'Postdoc',
      applied: 4,
      responded: 3,
      interviews: 2,
      offers: 1,
    })
  })
})

/* ------------------------------ search health ----------------------------- */

describe('searchHealthFor', () => {
  const TODAY = '2026-10-12'
  const health = (over: Partial<Parameters<typeof searchHealthFor>[0]> = {}) => ({
    applications: [] as Application[],
    timeline: [] as TimelineItem[],
    today: TODAY,
    ...over,
  })

  /**
   * "Null rather than zero: 'no follow-ups at all' is not '0% on time'."
   *
   * The distinction is the whole point of `HealthAxis['score']` being nullable —
   * a zero draws a spoke at the origin and reads as a failing grade for
   * something the user has not done wrong.
   */
  it('scores an axis with nothing to count as null, never as zero', () => {
    const axes = searchHealthFor(health())
    expect(axes.every((a) => a.score === null)).toBe(true)
    expect(axis(health(), 'Follow-ups').basis).toBe('nothing open')
    expect(axis(health(), 'Kept moving').basis).toBe('nothing live')
  })

  /**
   * The pinned-October bug: "late" was measured against the fixtures' own
   * calendar, so every open follow-up counted as late forever once the real date
   * passed it, and the panel reported a search falling apart on a store nobody
   * had touched. `today` is an argument for exactly this reason.
   */
  it('measures late against the day it is asked on', () => {
    const timeline = [item({ date: '2026-10-05' }), item({ date: '2026-10-20' })]

    // One of the two is behind 2026-10-12, so half are on time.
    expect(axis(health({ timeline }), 'Follow-ups').score).toBe(50)
    expect(axis(health({ timeline }), 'Follow-ups').basis).toBe('1 of 2 open follow-ups are late')

    // Asked a fortnight earlier, neither is late — same records, same module.
    const early = health({ timeline, today: '2026-09-28' })
    expect(axis(early, 'Follow-ups').score).toBe(100)
    expect(axis(early, 'Follow-ups').suggestion).toContain('Nothing is late')
  })

  /**
   * Due today is not late yet, which is the boundary and the only one the
   * comparison can get wrong quietly.
   *
   * `i.date < today` reading `<=` still passes every case above — both of those
   * dates are on one side or the other — and would tell someone their follow-up
   * was overdue on the morning it was due, alongside a suggestion to go and
   * clear it.
   */
  it('does not call a follow-up due today late', () => {
    const timeline = [item({ date: TODAY })]
    expect(axis(health({ timeline }), 'Follow-ups').score).toBe(100)
    expect(axis(health({ timeline }), 'Follow-ups').basis).toBe('0 of 1 open follow-ups are late')
  })

  it('ignores a follow-up that has been completed and anything that is not one', () => {
    const timeline = [
      item({ date: '2026-10-01', completedOn: '2026-10-02' }),
      item({ date: '2026-10-01', kind: 'deadline' }),
    ]
    expect(axis(health({ timeline }), 'Follow-ups').basis).toBe('nothing open')
  })

  /**
   * A closed application is meant to sit still, so counting it as neglected
   * would be a reproach for finishing.
   */
  it('leaves closed applications out of Kept moving', () => {
    const applications = [
      staged('interview', { daysAgo: 40 }),
      closed('rejected', { daysAgo: 400 }),
      staged('submitted', { daysAgo: 1 }),
    ]
    const moving = axis(health({ applications }), 'Kept moving')
    expect(moving.basis).toBe('1 of 2 touched in the last fortnight')
    expect(moving.score).toBe(50)
    expect(moving.suggestion).toContain('1 live application has')
  })

  /** Fourteen days is the boundary, and the boundary itself is not stale. */
  it('treats a fortnight exactly as still moving', () => {
    const at = (daysAgo: number) => health({ applications: [staged('submitted', { daysAgo })] })
    expect(axis(at(14), 'Kept moving').score).toBe(100)
    expect(axis(at(15), 'Kept moving').score).toBe(0)
  })

  it('counts Sent and Referrals against every record, drafts included', () => {
    const applications = [app(), staged('submitted', { source: 'Referral' })]
    expect(axis(health({ applications }), 'Sent').basis).toBe('1 of 2 out of draft')
    expect(axis(health({ applications }), 'Sent').score).toBe(50)
    expect(axis(health({ applications }), 'Referrals').basis).toBe('1 of 2 came through a referral')
  })

  it('changes its suggestion when there is nothing left in draft', () => {
    const none = health({ applications: [staged('submitted')] })
    expect(axis(none, 'Sent').suggestion).toContain('Nothing is sitting in draft')
    const some = health({ applications: [app(), app()] })
    expect(axis(some, 'Sent').suggestion).toContain('2 applications are still in draft')
  })

  /** No "Materials" axis: its only honest version can say one thing (see header). */
  it('reports the six axes the panel draws, in order', () => {
    expect(searchHealthFor(health()).map((a) => a.axis)).toEqual([
      'Sent',
      'Replies',
      'Interviews',
      'Referrals',
      'Follow-ups',
      'Kept moving',
    ])
  })
})
