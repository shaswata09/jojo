import { describe, expect, it } from 'vitest'
import { annualised, comparable, parseComp } from './comp'

/**
 * Reading money out of free text.
 *
 * The refusals matter as much as the reads. This feeds a comparison between two
 * job offers, which is the highest-stakes screen in the product — a figure that
 * is quietly wrong there does more damage than no figure at all, so anything
 * this cannot read has to come back `undefined` rather than as a guess.
 */
describe('parseComp', () => {
  it('reads the shapes the seeded data actually uses', () => {
    expect(parseComp('$112k')).toMatchObject({ amount: 112_000, currency: '$', period: 'year' })
    expect(parseComp('£45,000')).toMatchObject({ amount: 45_000, currency: '£' })
    expect(parseComp('€72 000')).toMatchObject({ amount: 72_000, currency: '€' })
    expect(parseComp('112000 USD')).toMatchObject({ amount: 112_000, currency: 'USD' })
    expect(parseComp('$1.2m')).toMatchObject({ amount: 1_200_000 })
    expect(parseComp('112.5k')).toMatchObject({ amount: 112_500 })
  })

  it('reads a European point as thousands, and a real decimal as a decimal', () => {
    // `€65.000` read as sixty-five euros a year until the point stopped always
    // winning — a thousandth of the offer, which the comparison screen then
    // ranked below every other one while showing the text that contradicted it.
    expect(parseComp('€65.000')).toMatchObject({ amount: 65_000, currency: '€' })
    expect(parseComp('€112.500')?.amount).toBe(112_500)
    expect(parseComp('1.234.567')?.amount).toBe(1_234_567)
    // And the other half: three digits and no multiplier is what makes a point
    // a separator, so cents and `k` fractions are still read as written.
    expect(parseComp('$60.50/hr')).toMatchObject({ amount: 60.5, period: 'hour' })
    expect(parseComp('112.500k')?.amount).toBe(112_500)
    expect(parseComp('$1.2m')?.amount).toBe(1_200_000)
  })

  it('takes the first amount and leaves the rest alone', () => {
    // `$112k + $15k startup` is a salary and a one-off. Adding them would rank
    // a generous signing bonus above a better job, which is a judgement about
    // what somebody values and not one this app gets to make.
    expect(parseComp('$112k + $15k startup')?.amount).toBe(112_000)
    expect(parseComp('$150,000 base, $40,000 equity')?.amount).toBe(150_000)
  })

  it('reads a stated period, and says that it was stated', () => {
    expect(parseComp('$60/hr')).toMatchObject({ amount: 60, period: 'hour', periodStated: true })
    expect(parseComp('€3,500 per month')).toMatchObject({ amount: 3500, period: 'month' })
    expect(parseComp('$95,000 per annum')).toMatchObject({ period: 'year', periodStated: true })
  })

  it('assumes a year when nothing says, and flags the assumption', () => {
    const parsed = parseComp('$112k')
    expect(parsed?.period).toBe('year')
    expect(parsed?.periodStated).toBe(false)
  })

  it('hands back the characters it read, so a wrong parse is traceable', () => {
    expect(parseComp('Package around $112k plus relocation')?.matched).toContain('112k')
  })

  it('refuses text with no amount in it', () => {
    for (const text of ['', '   ', 'competitive', 'DOE', 'negotiable', 'top of scale']) {
      expect(parseComp(text), text).toBeUndefined()
    }
  })

  it('refuses a zero, which is not a salary anyone was offered', () => {
    expect(parseComp('$0')).toBeUndefined()
  })
})

describe('annualised', () => {
  it('puts every period on one axis', () => {
    expect(annualised(parseComp('$112k')!)).toBe(112_000)
    expect(annualised(parseComp('€3,500 per month')!)).toBe(42_000)
    expect(annualised(parseComp('$60/hr')!)).toBe(124_800)
  })
})

describe('comparable', () => {
  it('refuses to rank two different currencies', () => {
    // There is no exchange rate in this app and there should not be one: a rate
    // needs a network call and a date, and a comparison that quietly used last
    // Tuesday's is worse than one that admits it cannot compare.
    expect(comparable(parseComp('$112k')!, parseComp('£90k')!)).toBe(false)
  })

  it('compares when both name the same currency, or when neither names one', () => {
    expect(comparable(parseComp('$112k')!, parseComp('$95k')!)).toBe(true)
    expect(comparable(parseComp('112k')!, parseComp('95k')!)).toBe(true)
    // One side unmarked is treated as the same currency — a store is one
    // person's job search, and "$112k" beside "95,000" is not two economies.
    expect(comparable(parseComp('$112k')!, parseComp('95,000')!)).toBe(true)
  })
})

/**
 * The ISO code before the digits, which the pattern only looked for after them.
 *
 * `EUR 112,500` is at least as common in European postings as `112,500 EUR`,
 * and a dropped currency is not a cosmetic loss: `comparable()` reads a missing
 * currency as "same as anything", so a euro offer sat straight against a dollar
 * one on the comparison screen with nothing saying they were different units.
 */
describe('a currency code written first', () => {
  for (const [text, currency] of [
    ['EUR 112,500', 'EUR'],
    ['eur 112,500', 'EUR'],
    ['GBP 95,000 per year', 'GBP'],
    ['USD 180k', 'USD'],
  ] as const) {
    it(`reads ${text} as ${currency}`, () => {
      expect(parseComp(text)?.currency).toBe(currency)
    })
  }

  it('still reads a code written last', () => {
    expect(parseComp('112,500 EUR')?.currency).toBe('EUR')
  })

  it('does not mistake an ordinary word for a currency', () => {
    // `for` matches [a-z]{3}. The CODES guard is what stops it — and the amount
    // must survive either way.
    const parsed = parseComp('for 112,500')
    expect(parsed?.currency).toBeUndefined()
    expect(parsed?.amount).toBe(112500)
  })

  it('leaves a symbol as the symbol, which is what the rest of the app renders', () => {
    // SYMBOLS maps a symbol to itself — the ISO code is only for the written
    // form. Widening the pattern must not change that.
    expect(parseComp('€112,500')?.currency).toBe('€')
  })
})
