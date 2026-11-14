/**
 * Comparing slices of a search without inventing findings.
 *
 * Almost every test here is about REFUSING to report something. That is the
 * point of the module: split nine applications any way at all and one side is
 * ahead, so the interesting behaviour is not "does it find the difference" but
 * "does it stay quiet when the difference is three coincidences".
 */

import { describe, expect, it } from 'vitest'
import type { Application } from './model'
import { compare, comparisonsFor, MIN_ARM, rangeLabel, wilson } from './segments'

let n = 0
/**
 * `| undefined` on every field rather than `Partial<Application>`.
 *
 * `exactOptionalPropertyTypes` is on, so `Partial<T>` will not accept an
 * explicit `undefined` — and these fixtures need to say "this one has no
 * source" out loud, which is the case the split has to drop.
 */
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
    daysAgo: 3,
    appliedOn: '2026-08-01',
    ...over,
  }) as unknown as Application

/** `count` of `of` records from `source`, the first `count` having replied. */
const arm = (source: string, of: number, count: number): Application[] =>
  Array.from({ length: of }, (_, i) =>
    app({
      source: source as Application['source'],
      firstReplyOn: i < count ? '2026-08-15' : undefined,
    }),
  )

const REPLIED = {
  dimension: 'where they came from',
  measure: 'replied',
  labelOf: (a: Application) => a.source ?? null,
  hit: (a: Application) => a.firstReplyOn !== undefined,
}

describe('the interval', () => {
  it('does not claim certainty from a run of zeros', () => {
    /*
     * The reason this is Wilson and not the textbook interval. The normal
     * approximation on 0 of 4 is `0 ± 0` — it says the true rate is exactly
     * zero — and four cold sends with no reply is the single commonest arm a
     * job search produces. Wilson says 0% to 49%, which is what four records
     * actually support.
     */
    const zero = wilson(0, 4)
    expect(zero.low).toBe(0)
    expect(zero.high).toBeGreaterThan(0.4)
  })

  it('does not claim certainty from a run of ones either', () => {
    const all = wilson(4, 4)
    expect(all.high).toBe(1)
    expect(all.low).toBeLessThan(0.6)
  })

  it('matches the published figures', () => {
    // 5 of 10 at 95% is 0.2366–0.7634; 0 of 10 is 0–0.2775. Pinned so a
    // rearrangement of the formula cannot quietly change what it computes.
    const half = wilson(5, 10)
    expect(half.low).toBeCloseTo(0.2366, 3)
    expect(half.high).toBeCloseTo(0.7634, 3)
    expect(wilson(0, 10).high).toBeCloseTo(0.2775, 3)
  })

  it('narrows as the evidence grows', () => {
    const width = (c: number, o: number) => wilson(c, o).high - wilson(c, o).low
    expect(width(5, 10)).toBeGreaterThan(width(50, 100))
    expect(width(50, 100)).toBeGreaterThan(width(500, 1000))
  })

  it('says nothing at all about nothing', () => {
    // The full range, not 0. An empty arm has not scored badly.
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 })
  })

  it('never leaves 0–1', () => {
    // Floating point at n = 1 lands just under zero, which formats as '-0%'.
    for (const [c, o] of [[0, 1], [1, 1], [1, 2], [0, 3]]) {
      const i = wilson(c!, o!)
      expect(i.low).toBeGreaterThanOrEqual(0)
      expect(i.high).toBeLessThanOrEqual(1)
    }
  })
})

describe('refusing to compare', () => {
  it('says nothing when only one slice has enough records', () => {
    const rows = [...arm('Referral', 8, 6), ...arm('Job board', MIN_ARM - 1, 0)]
    expect(compare(rows, REPLIED)).toBeNull()
  })

  it('says nothing when there is only one slice at all', () => {
    expect(compare(arm('Referral', 10, 5), REPLIED)).toBeNull()
  })

  it('drops records that do not say which slice they are in', () => {
    /*
     * An application with no source recorded is not evidence about any source.
     * Bundling those into an "unknown" arm invents a slice nobody chose and
     * then reports findings about it.
     */
    const rows = [...arm('Referral', 5, 5), ...arm('Job board', 5, 0), ...Array.from({ length: 20 }, () => app({}))]
    const found = compare(rows, REPLIED)
    expect(found?.arms.map((a) => a.label).sort()).toEqual(['Job board', 'Referral'])
    expect(found?.arms.reduce((t, a) => t + a.of, 0)).toBe(10)
  })

  it('counts the slices it dropped, so the screen can say so', () => {
    const rows = [...arm('Referral', 5, 5), ...arm('Job board', 5, 0), ...arm('Careers page', 2, 2)]
    expect(compare(rows, REPLIED)?.tooFew).toBe(1)
  })
})

describe('refusing to call it a finding', () => {
  it('will not call three coincidences a difference', () => {
    /*
     * Why `MIN_ARM` exists on top of the interval rule. Three of three is 100%
     * with a Wilson range of 44–100%, which clears a weak opposing arm — and
     * "every referral you sent got a reply" would be printed from three
     * records. The interval is the mathematics; the floor is the judgement.
     */
    const rows = [...arm('Referral', MIN_ARM - 1, MIN_ARM - 1), ...arm('Job board', 12, 0)]
    expect(compare(rows, REPLIED)).toBeNull()
  })

  it('does call the most lopsided split the floor allows', () => {
    /*
     * 5 of 5 against 0 of 5 — the extreme of what `MIN_ARM` lets through — and
     * the app does report it when it is the only pair on screen. Fisher's exact
     * test on the same table gives p ≈ 0.008.
     *
     * Pinned because it is the boundary of the module's willingness to speak,
     * and a change to `MIN_ARM` or to Z should have to move this line
     * deliberately rather than in passing.
     */
    const found = compare([...arm('Referral', 5, 5), ...arm('Job board', 5, 0)], REPLIED)
    expect(found?.best.rate).toBe(100)
    expect(found?.worst.rate).toBe(0)
    expect(found?.confident).toBe(true)
  })

  it('no longer reports four of four against none of four', () => {
    // The old floor's extreme, and the shape noise produces most often.
    expect(compare([...arm('Referral', 4, 4), ...arm('Job board', 4, 0)], REPLIED)).toBeNull()
  })

  it('stays quiet on a small split that is merely suggestive', () => {
    // 4 of 5 against 1 of 5 is the shape a person would over-read on sight —
    // "referrals do four times better" — and ten records cannot support it.
    const found = compare([...arm('Referral', 5, 4), ...arm('Job board', 5, 1)], REPLIED)
    expect(found?.best.rate).toBe(80)
    expect(found?.confident).toBe(false)
  })

  it('calls it once the evidence is actually there', () => {
    const found = compare([...arm('Referral', 20, 16), ...arm('Job board', 40, 4)], REPLIED)
    expect(found?.confident).toBe(true)
    expect(found?.best.label).toBe('Referral')
    expect(found?.worst.label).toBe('Job board')
  })

  it('refuses when the intervals merely touch', () => {
    /*
     * The marginal case is the one this rule exists for, so the comparison is
     * strictly greater rather than greater-or-equal. Anything decided on the
     * boundary is decided by rounding.
     */
    const found = compare([...arm('Referral', 20, 12), ...arm('Job board', 20, 8)], REPLIED)
    expect(found?.confident).toBe(false)
  })
})

describe('what it reports', () => {
  it('ranks by the rate a person reads, not by the interval', () => {
    // The order on screen has to match the numbers on screen.
    const found = compare(
      [...arm('Referral', 10, 5), ...arm('Job board', 30, 3), ...arm('Careers page', 10, 8)],
      REPLIED,
    )
    expect(found?.arms.map((a) => a.label)).toEqual(['Careers page', 'Referral', 'Job board'])
  })

  it('breaks a tie towards the better-evidenced slice', () => {
    const found = compare([...arm('Referral', 8, 4), ...arm('Job board', 20, 10)], REPLIED)
    expect(found?.arms[0]?.label).toBe('Job board')
  })

  it('carries the denominator on every arm', () => {
    // No rate ever reaches the screen without what it is a share of.
    const found = compare([...arm('Referral', 10, 5), ...arm('Job board', 10, 1)], REPLIED)
    for (const a of found?.arms ?? []) expect(a.of).toBeGreaterThan(0)
  })

  it('formats a range rather than a bare rate', () => {
    expect(rangeLabel({ label: 'x', of: 10, count: 5, rate: 50, interval: wilson(5, 10) })).toBe(
      '24–76%',
    )
  })
})

describe('the splits the app actually makes', () => {
  it('ignores anything still in draft', () => {
    /*
     * A draft has not been anywhere, so counting it against a source reports a
     * reply rate for applications no employer has seen — and it is the same
     * denominator mistake `statistics.ts` was rebuilt to remove.
     */
    const drafts = Array.from({ length: 30 }, () =>
      app({ stage: 'draft', source: 'Referral', appliedOn: undefined }),
    )
    const found = comparisonsFor([...arm('Referral', 20, 16), ...arm('Job board', 40, 4), ...drafts])
    const source = found.find((c) => c.dimension === 'where they came from')
    expect(source?.arms.find((a) => a.label === 'Referral')?.of).toBe(20)
  })

  it('returns nothing at all for a young search', () => {
    // The commonest state, and silence is the right output for it.
    expect(comparisonsFor(arm('Referral', 3, 2))).toEqual([])
  })
})

describe('many looks at the same records', () => {
  /** A seeded LCG, so the simulation is the same run every time. */
  const seeded = (seed: number) => {
    let s = seed
    return () => {
      s = (s * 1103515245 + 12345) % 2147483648
      return s / 2147483648
    }
  }
  const SOURCES = ['Referral', 'Job board', 'Careers page', 'Recruiter', 'LinkedIn', 'Conference']
  const ROLES = ['Faculty', 'Industry', 'Postdoc']
  /** A search where nothing makes a difference: every slice replies at `p`. */
  const noEffect = (rnd: () => number, i: number, p: number) =>
    app({
      id: `s${String(i)}`,
      source: SOURCES[Math.floor(rnd() * SOURCES.length)] as Application['source'],
      roleTag: ROLES[Math.floor(rnd() * ROLES.length)] as Application['roleTag'],
      firstReplyOn: rnd() < p ? '2026-08-15' : undefined,
    })
  const falseFinding = (rows: readonly Application[]) => comparisonsFor(rows).some((c) => c.confident)

  it('rarely invents a finding from a search with no real difference', () => {
    /*
     * The reviewer's simulation: six sources, three role tags, one reply rate
     * for everybody. Taking the best and worst of six arms across three splits
     * found a "difference" in ~5–8% of such searches at 40–60 records — and
     * re-checking after every save, ~20% over a search's life.
     */
    const rnd = seeded(12345)
    for (const size of [40, 60]) {
      let found = 0
      const trials = 400
      for (let t = 0; t < trials; t += 1) {
        const rows = Array.from({ length: size }, (_, i) => noEffect(rnd, i, 0.38))
        if (falseFinding(rows)) found += 1
      }
      expect(found / trials).toBeLessThanOrEqual(0.05)
    }
  })

  it('stays quiet when re-checked after every record is added', () => {
    const rnd = seeded(777)
    let ever = 0
    const trials = 150
    for (let t = 0; t < trials; t += 1) {
      const rows: Application[] = []
      let seen = false
      for (let i = 0; i < 60 && !seen; i += 1) {
        rows.push(noEffect(rnd, i, 0.38))
        seen = falseFinding(rows)
      }
      if (seen) ever += 1
    }
    expect(ever / trials).toBeLessThanOrEqual(0.05)
  })

  it('makes each split pay for the others on the same screen', () => {
    /*
     * 9 of 10 against 2 of 10 clears the bar on its own (one pair), and does
     * not once fourteen other pairs are being looked at too.
     */
    const rows = [...arm('Referral', 10, 9), ...arm('Job board', 10, 2)]
    expect(compare(rows, REPLIED)?.confident).toBe(true)
    expect(compare(rows, REPLIED, 15)?.confident).toBe(false)
    // And the family can only make it stricter, never looser.
    const many = [...rows, ...arm('Careers page', 10, 5), ...arm('Recruiter', 10, 5)]
    expect(compare(many, REPLIED, 0)?.confident).toBe(compare(many, REPLIED, 6)?.confident)
  })

  it('counts the pairs of every split on the screen, not just its own', () => {
    // The same 9-of-10 against 2-of-10 by source, now beside a role split with
    // six pairs of its own: the source finding has to clear all of them.
    const rows = [...arm('Referral', 10, 9), ...arm('Job board', 10, 2)].map((a, i) => ({
      ...a,
      roleTag: ['Faculty', 'Industry', 'Postdoc', 'Staff'][i % 4] as Application['roleTag'],
    }))
    const source = comparisonsFor(rows).find(
      (c) => c.measure === 'replied' && c.dimension === 'where they came from',
    )
    expect(source?.arms).toHaveLength(2)
    expect(source?.confident).toBe(false)
  })

  it('still finds a difference that is really there', () => {
    const found = comparisonsFor([...arm('Referral', 20, 16), ...arm('Job board', 40, 4)])
    expect(found.find((c) => c.measure === 'replied' && c.dimension === 'where they came from')?.confident).toBe(true)
  })
})
