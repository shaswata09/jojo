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
    const rows = [...arm('Referral', 3, 3), ...arm('Job board', 12, 0)]
    expect(compare(rows, REPLIED)).toBeNull()
  })

  it('does call the most lopsided split the floor allows', () => {
    /*
     * 4 of 4 against 0 of 4 — the extreme of what `MIN_ARM` lets through — and
     * the app does report it: 51–100% against 0–49%. That is the right answer
     * rather than an accident of the formula. Fisher's exact test on the same
     * table gives p ≈ 0.029, so a reader who reached for the standard tool
     * would come to the same conclusion from the same eight records.
     *
     * Pinned because it is the boundary of the module's willingness to speak,
     * and a change to `MIN_ARM` or to Z should have to move this line
     * deliberately rather than in passing.
     */
    const found = compare([...arm('Referral', 4, 4), ...arm('Job board', 4, 0)], REPLIED)
    expect(found?.best.rate).toBe(100)
    expect(found?.worst.rate).toBe(0)
    expect(found?.confident).toBe(true)
  })

  it('stays quiet on a small split that is merely suggestive', () => {
    // 3 of 4 against 1 of 4 is the shape a person would over-read on sight —
    // "referrals do three times better" — and eight records cannot support it.
    // 30–95% against 5–70%, overlapping heavily.
    const found = compare([...arm('Referral', 4, 3), ...arm('Job board', 4, 1)], REPLIED)
    expect(found?.best.rate).toBe(75)
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
