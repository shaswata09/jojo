/**
 * The `advice` namespace says, in English, exactly what `recommendationsFor`
 * and `searchHealthFor` write — so the Statistics page in any language and the
 * agent reading core describe the same search, and a sentence changed in one
 * place fails here until the other follows.
 *
 * Every catalog sentence English can reach is reached: the translator is
 * wrapped to record each key it resolves, and the last test checks the record
 * against `ADVICE_EN` itself.
 */

import { describe, expect, it } from 'vitest'
import { ADVICE_EN, adviceText, englishAdviceT } from './advice-text'
import type { Translate } from './domain-text'
import { flattenCatalog } from './locale-catalog'
import type { Application, TimelineItem } from './model'
import { recommendationsFor } from './recommend'
import { searchHealthFor } from './statistics'

const TODAY = '2026-09-14'

/** Each key `englishAdviceT` resolved, with the plural form English picked. */
const used = new Set<string>()
const recording: Translate = (key, options = {}) => {
  const path = key.replace(/^advice:/, '')
  const count = options['count']
  used.add(typeof count === 'number' ? `${path}_${count === 1 ? 'one' : 'other'}` : path)
  return englishAdviceT(key, options)
}
const en = adviceText(recording)

let n = 0
type Over = { [K in keyof Application]?: Application[K] | undefined }
const app = (over: Over = {}): Application =>
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
const many = (count: number, over: Over = {}) => Array.from({ length: count }, () => app(over))

const followUp = (date: string, completedOn?: string): TimelineItem =>
  ({
    id: `t${String((n += 1))}`,
    kind: 'follow-up',
    title: 'Chase',
    date,
    urgency: 'gray',
    allDay: true,
    applicationIds: [],
    ...(completedOn === undefined ? {} : { completedOn }),
  }) as unknown as TimelineItem

const late = followUp('2026-09-01')
const early = followUp('2026-09-30')
const replied = { firstReplyOn: '2026-09-05' }

type Search = { applications: Application[]; timeline?: TimelineItem[]; background?: number }

/** Searches chosen so that, between them, every sentence English has is said. */
const searches: [string, Search][] = [
  ['empty', { applications: [] }],
  ['one draft', { applications: [app({ stage: 'draft', appliedOn: undefined, daysAgo: 1 })] }],
  [
    'three drafts, the oldest a day old, nothing open',
    { applications: many(3, { stage: 'draft', appliedOn: undefined, daysAgo: 1 }) },
  ],
  [
    'one sent, no reply, one late follow-up, quiet a month, no CV',
    { applications: [app({ daysAgo: 30 })], timeline: [late], background: 0 },
  ],
  [
    'two sent, silent past a five-day usual, one early and two late follow-ups',
    {
      applications: [
        app({ appliedOn: '2026-09-01', firstReplyOn: '2026-09-06', stage: 'closed', daysAgo: 3 }),
        ...many(2, { appliedOn: '2026-09-01', daysAgo: 20 }),
      ],
      timeline: [early, late, followUp('2026-09-02')],
    },
  ],
  [
    'one silent past a one-day usual',
    {
      applications: [
        app({ appliedOn: '2026-09-01', firstReplyOn: '2026-09-02', stage: 'closed' }),
        app({ appliedOn: '2026-09-10' }),
      ],
    },
  ],
  ['one sent, replied', { applications: [app(replied)], timeline: [early] }],
  ['three sent, all replied', { applications: many(3, replied) }],
  [
    'one reply, one call, one referral',
    {
      applications: [
        app({ ...replied, stage: 'interview', source: 'Referral' }),
        app({}),
        app({ stage: 'draft', appliedOn: undefined, daysAgo: 0 }),
      ],
    },
  ],
  [
    'three replies, two calls, two referrals',
    {
      applications: [
        ...many(2, { ...replied, stage: 'interview', source: 'Referral' }),
        app(replied),
        app({}),
      ],
    },
  ],
  ['ten sent, none answered', { applications: many(10) }],
  [
    'ten sent, two replied, two calls',
    { applications: [...many(2, { ...replied, stage: 'interview' }), ...many(8)] },
  ],
  [
    'ten sent, five replied, none a call',
    { applications: [...many(5, replied), ...many(5)] },
  ],
  [
    'referrals and postdocs far ahead of job boards and industry',
    {
      applications: [
        ...many(20, { ...replied, stage: 'interview', source: 'Referral', roleTag: 'Postdoc' }),
        ...many(40, { source: 'Job board', roleTag: 'Industry' }),
      ],
    },
  ],
  ['every follow-up done, a day ago', { applications: [app({ ...replied, daysAgo: 1 })], timeline: [followUp('2026-09-01', '2026-09-02')] }],
]

describe('the next steps, through the catalog', () => {
  it.each(searches)('says what recommendationsFor says: %s', (_, s) => {
    const found = recommendationsFor({
      applications: s.applications,
      timeline: s.timeline ?? [],
      background: s.background ?? 1,
      today: TODAY,
    })
    for (const r of found) {
      expect(en.recommendation(r)).toEqual({ headline: r.headline, because: r.because })
    }
  })

  it('names an arm as written where the language says so', () => {
    const t: Translate = (key, options) =>
      key === 'advice:rec.segment.labelCase' ? 'asWritten' : englishAdviceT(key, options)
    const [finding] = recommendationsFor({
      applications: searches.find(([name]) => name.startsWith('referrals'))?.[1].applications ?? [],
      timeline: [],
      background: 1,
      today: TODAY,
    })
    expect(adviceText(t).recommendation(finding!).headline).toBe(
      'Put more of your effort into Referral.',
    )
  })
})

describe('the search-health radar, through the catalog', () => {
  it.each(searches)('says what searchHealthFor says: %s', (_, s) => {
    for (const a of searchHealthFor({ applications: s.applications, timeline: s.timeline ?? [], today: TODAY })) {
      expect(en.health(a)).toEqual({ axis: a.axis, basis: a.basis, suggestion: a.suggestion })
      expect(en.axis(a.id)).toBe(a.axis)
    }
  })
})

describe('the catalog', () => {
  /**
   * Plural forms English holds for the other languages' sake and never picks
   * itself: two drafts or more is always "drafts", and a finding needs at least
   * five records a side, so its leading count is never one.
   */
  const unreachable = new Set([
    'rec.drafts.headline_one',
    'rec.segment.because.source.replied_one',
    'rec.segment.because.source.interview_one',
    'rec.segment.because.role.replied_one',
    'rec.segment.because.role.interview_one',
    // No finding has been measured over interviews by role.
    'rec.segment.because.role.interview_other',
    // Read by `adviceText`, never shown.
    'rec.segment.labelCase',
  ])

  it('has every sentence said by some search above', () => {
    const missing = [...flattenCatalog(ADVICE_EN).keys()].filter(
      (key) => !used.has(key) && !unreachable.has(key),
    )
    expect(missing).toEqual([])
  })
})
