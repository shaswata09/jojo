/**
 * Turning a search into a ranked list of things to do.
 *
 * The tests below are mostly about what the list REFUSES to say and about the
 * order it says things in, because both are where advice stops being useful:
 * a suggestion drawn from three records is noise, and a correct list that opens
 * with the month-long item is a list read once.
 */

import { describe, expect, it } from 'vitest'
import type { Application, TimelineItem } from './model'
import { recommendationsFor } from './recommend'

const TODAY = '2026-09-14'

let n = 0
type Over = { [K in keyof Application]?: Application[K] | undefined }
const app = (over: Over): Application =>
  ({
    id: `a${String((n += 1))}`,
    slug: `a${String(n)}`,
    org: 'Example',
    role: 'Engineer',
    note: '',
    roleTag: 'Industry',
    stage: 'submitted',
    lastAction: 'Sent',
    daysAgo: 2,
    appliedOn: '2026-09-01',
    ...over,
  }) as unknown as Application

const item = (over: Partial<TimelineItem>): TimelineItem =>
  ({
    id: `t${String((n += 1))}`,
    kind: 'follow-up',
    title: 'Chase',
    date: '2026-09-01',
    urgency: 'soon',
    allDay: true,
    ...over,
  }) as unknown as TimelineItem

const run = (
  applications: readonly Application[],
  over: { timeline?: TimelineItem[]; background?: number } = {},
) =>
  recommendationsFor({
    applications,
    timeline: over.timeline ?? [],
    background: over.background ?? 1,
    today: TODAY,
  })

const ids = (rs: ReturnType<typeof run>) => rs.map((r) => r.id)

describe('an empty search', () => {
  it('says nothing at all rather than inventing a plan', () => {
    /*
     * The first-run state. A page that greets somebody with six suggestions
     * about a search they have not started is the same failure `statistics.ts`
     * was rebuilt to remove — advice about a fictional job hunt.
     */
    expect(run([])).toEqual([])
  })

  it('says nothing about drafts alone if that is all there is', () => {
    // A draft IS worth saying something about, and it is the only thing here —
    // but there must be no chase list, no funnel diagnosis and no "all clear".
    expect(ids(run([app({ stage: 'draft', appliedOn: undefined, daysAgo: 3 })]))).toEqual([
      'drafts:open',
    ])
  })
})

describe('what it counts', () => {
  it('names the overdue follow-ups', () => {
    const found = run([app({})], { timeline: [item({ date: '2026-09-01' }), item({ date: '2026-09-02' })] })
    const late = found.find((r) => r.id === 'follow-ups:late')
    expect(late?.headline).toContain('2 overdue follow-ups')
  })

  it('does not count a follow-up that is done, or one still ahead', () => {
    const found = run([app({})], {
      timeline: [
        item({ date: '2026-09-01', completedOn: '2026-09-02' }),
        item({ date: '2026-12-01' }),
      ],
    })
    expect(ids(found)).not.toContain('follow-ups:late')
  })

  it('chases what has been silent longer than this person’s own median', () => {
    /*
     * The most specific claim the file can make, and it is only sayable once
     * there are replies to take a median of. The figure is theirs — not a rule
     * of thumb — which is what the copy has to be able to say.
     */
    const replied = [
      app({ appliedOn: '2026-08-01', firstReplyOn: '2026-08-06' }),
      app({ appliedOn: '2026-08-01', firstReplyOn: '2026-08-06' }),
    ]
    const silent = app({ appliedOn: '2026-08-01' })
    const found = run([...replied, silent])
    const chase = found.find((r) => r.id === 'silent:past-median')
    expect(chase?.because).toContain('5 days')
    expect(chase?.headline).toContain('1 application')
  })

  it('says nothing about silence before there is a median to compare to', () => {
    // No reply has ever arrived, so there is no "usual" — and "chase anything
    // older than a fortnight" would be a rule of thumb wearing their data's
    // clothes.
    expect(ids(run([app({ appliedOn: '2026-01-01' })]))).not.toContain('silent:past-median')
  })

  it('does not chase something sent more recently than a reply usually takes', () => {
    /*
     * Without this the item degenerates into "chase everything that has not
     * replied", which on a search where replies take a fortnight means chasing
     * an application sent yesterday. The median is the whole point of the line.
     */
    const replied = [
      app({ appliedOn: '2026-08-01', firstReplyOn: '2026-08-06' }),
      app({ appliedOn: '2026-08-01', firstReplyOn: '2026-08-06' }),
    ]
    // Median is 5 days; this went out 2 days ago.
    const fresh = app({ appliedOn: '2026-09-12' })
    expect(ids(run([...replied, fresh]))).not.toContain('silent:past-median')
  })

  it('does not chase a closed application', () => {
    const replied = [
      app({ appliedOn: '2026-08-01', firstReplyOn: '2026-08-06' }),
      app({ appliedOn: '2026-08-01', firstReplyOn: '2026-08-06' }),
    ]
    const done = app({ appliedOn: '2026-01-01', stage: 'closed', outcome: 'rejected' })
    expect(ids(run([...replied, done]))).not.toContain('silent:past-median')
  })

  it('names the oldest draft rather than only counting them', () => {
    // "Five drafts" is a statistic; "the oldest has been open 40 days" is a
    // decision.
    const found = run([
      app({ stage: 'draft', appliedOn: undefined, daysAgo: 3 }),
      app({ stage: 'draft', appliedOn: undefined, daysAgo: 40 }),
    ])
    expect(found.find((r) => r.id === 'drafts:open')?.because).toContain('40 days')
  })

  it('offers to read the CV only when nothing is known and something is out', () => {
    expect(ids(run([app({})], { background: 0 }))).toContain('background:none')
    expect(ids(run([app({})], { background: 12 }))).not.toContain('background:none')
    // Nothing sent — there is nothing to weigh yet, so the offer is premature.
    expect(
      ids(run([app({ stage: 'draft', appliedOn: undefined })], { background: 0 })),
    ).not.toContain('background:none')
  })
})

describe('what the split says', () => {
  /** `of` sent from `source`, the first `count` having replied. */
  const from = (source: string, of: number, count: number) =>
    Array.from({ length: of }, (_, i) =>
      app({
        source: source as Application['source'],
        firstReplyOn: i < count ? '2026-09-05' : undefined,
      }),
    )

  it('reports a difference the evidence supports', () => {
    const found = run([...from('Referral', 20, 16), ...from('Job board', 40, 4)])
    const finding = found.find((r) => r.id.startsWith('segment:'))
    expect(finding?.headline).toContain('referral')
    // The counts, both denominators, and both ranges — never a bare rate.
    expect(finding?.because).toContain('16 of 20')
    expect(finding?.because).toContain('4 of 40')
    expect(finding?.because).toMatch(/\d+–\d+%/)
    expect(finding?.strength).toBe('measured')
  })

  it('says nothing about a difference the evidence does not support', () => {
    /*
     * THE refusal this whole layer rests on. Eight records split 3–1 against
     * 1–3 looks like "referrals do three times better", and it is noise —
     * `segments.ts` declines to call it, and nothing here may promote it.
     */
    const found = run([...from('Referral', 4, 3), ...from('Job board', 4, 1)])
    expect(ids(found).some((id) => id.startsWith('segment:'))).toBe(false)
  })

  it('leads with the finding when there is one', () => {
    // A measured difference in their own records is the most valuable thing
    // this page can say, and it outranks the chores.
    const found = run([...from('Referral', 20, 16), ...from('Job board', 40, 4)], {
      timeline: [item({ date: '2026-09-01' })],
    })
    expect(found[0]?.id).toMatch(/^segment:/)
  })
})

describe('the funnel diagnosis', () => {
  const sentOnly = (count: number) => Array.from({ length: count }, () => app({}))

  it('stays quiet until there is a denominator worth dividing by', () => {
    /*
     * A reply rate off three applications is not a leak, it is three
     * applications — and this is the one item drawn from a benchmark rather
     * than from the person, so it has the least licence to speak early.
     */
    expect(ids(run(sentOnly(3))).some((id) => id.startsWith('funnel:'))).toBe(false)
  })

  it('picks the step furthest behind, not the lowest one', () => {
    /*
     * Interview rate is always lower than reply rate, so "the lowest number"
     * would name the same step for everybody forever. What matters is the gap
     * against what that step is normally worth.
     *
     * The fixture is built so the two answers differ: replies run at 20%
     * against a typical 38% — eighteen points down — while interviews run at
     * 10% against a typical 11%, which is one point down and essentially on
     * target. Interviews is the smaller number; replies is the problem.
     */
    const rows = [
      ...Array.from({ length: 1 }, () => app({ firstReplyOn: '2026-09-05', stage: 'interview' })),
      ...Array.from({ length: 1 }, () => app({ firstReplyOn: '2026-09-05' })),
      ...Array.from({ length: 8 }, () => app({})),
    ]
    const found = run(rows).find((r) => r.id.startsWith('funnel:'))
    expect(found?.id).toBe('funnel:replies')
  })

  it('does not call a step a leak when it is ahead', () => {
    /*
     * Without the filter, the least-ahead step is still "the worst one" and the
     * page tells somebody whose reply rate is double the benchmark to rewrite
     * their opening paragraph. A search doing well has to be allowed to be told
     * nothing.
     */
    const rows = [
      ...Array.from({ length: 3 }, () => app({ firstReplyOn: '2026-09-05', stage: 'interview' })),
      ...Array.from({ length: 5 }, () => app({ firstReplyOn: '2026-09-05' })),
      ...Array.from({ length: 2 }, () => app({})),
    ]
    expect(ids(run(rows)).some((id) => id.startsWith('funnel:'))).toBe(false)
  })

  it('admits the benchmark is jojo’s own invention', () => {
    // `TYPICAL`'s header says the numbers are round on purpose. A suggestion
    // built on them must not read like a measurement of other people.
    const found = run(sentOnly(10)).find((r) => r.id.startsWith('funnel:'))
    expect(found?.strength).toBe('suggested')
    expect(found?.because).toMatch(/not one measured from anybody/)
  })
})

describe('the order', () => {
  it('puts everything counted above anything merely suggested', () => {
    /*
     * THE ranking rule. A claim drawn from the person's own records outranks
     * one drawn from a benchmark nobody in this app has met, however large the
     * benchmark's gap looks.
     */
    const rows = [...Array.from({ length: 10 }, () => app({ daysAgo: 40 }))]
    const found = run(rows, { timeline: [item({ date: '2026-09-01' })] })
    const firstSuggested = found.findIndex((r) => r.strength === 'suggested')
    const lastMeasured = found.map((r) => r.strength).lastIndexOf('measured')
    expect(firstSuggested).toBeGreaterThan(lastMeasured)
  })

  it('leads with the cheapest thing that is already half done', () => {
    // Chasing an overdue follow-up is an hour on an application an employer has
    // already seen. Rewriting how you open a cover letter is a month.
    const rows = Array.from({ length: 10 }, () => app({ daysAgo: 40 }))
    const found = run(rows, { timeline: [item({ date: '2026-09-01' })] })
    expect(found[0]?.id).toBe('follow-ups:late')
  })

  it('gives every item a stable id, so a list can key on it', () => {
    const rows = Array.from({ length: 10 }, () => app({ daysAgo: 40 }))
    const found = run(rows, { timeline: [item({ date: '2026-09-01' })], background: 0 })
    expect(new Set(ids(found)).size).toBe(found.length)
  })
})

describe('when there is genuinely nothing to do', () => {
  it('says so instead of leaving a blank panel', () => {
    const found = run([app({ daysAgo: 1, firstReplyOn: '2026-09-05' })])
    expect(ids(found)).toEqual(['clear'])
    expect(found[0]?.because).toContain('1 application is')
  })
})
