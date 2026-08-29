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

/**
 * The first AMOUNT, not the first number.
 *
 * Every money signal in the pattern is optional, so the pattern by itself
 * matched any run of digits and `parseComp` returned whichever integer came
 * first. Measured against posting-shaped text, that is a holiday allowance, a
 * headcount, a start year and a room number, each of them then ranked as pay on
 * the offer comparison — the one screen this module exists to feed.
 */
describe('a number that is not money', () => {
  for (const [text, amount] of [
    ['25 days holiday, salary £45,000', 45_000],
    ['Team of 12 engineers. $112k base.', 112_000],
    ['2026 start date, $180,000 per annum', 180_000],
    ['Office 402, EUR 65.000 per year', 65_000],
    ['Sponsors 5 conferences a year. 95,000 EUR.', 95_000],
  ] as const) {
    it(`reads ${text} as ${amount}`, () => {
      expect(parseComp(text)?.amount).toBe(amount)
    })
  }

  it('still hands back characters a reader can find in the text', () => {
    // The traceability contract survives the skip: `matched` is the amount that
    // was chosen, not the one that was passed over.
    expect(parseComp('Team of 12 engineers. $112k base.')?.matched).toContain('112k')
  })

  it('counts a period only when it touches the digits', () => {
    // `PERIODS` is scanned across the whole text to LABEL an amount, which is
    // fair once we know which number is the pay. As evidence that a bare number
    // IS pay it would be worthless: `per annum` at the end of the sentence would
    // otherwise vouch for the 12 at the start of it.
    expect(parseComp('60/hr')).toMatchObject({ amount: 60, period: 'hour' })
    expect(parseComp('60000 per year')?.amount).toBe(60_000)
    expect(parseComp('Team of 12, paid $95,000 per annum')?.amount).toBe(95_000)
  })

  it('reads a lone unmarked number, which is what the comp field holds', () => {
    // Nothing said money, but there is nothing here for the choice to get
    // wrong, and `matched` shows the reader exactly what was taken.
    expect(parseComp('60000')?.amount).toBe(60_000)
    expect(parseComp('salary 60000')?.amount).toBe(60_000)
  })

  it('refuses several unmarked numbers rather than picking one', () => {
    // Choosing among bare integers is a guess no reader can audit. The module
    // refuses `competitive`; this is the same refusal.
    expect(parseComp('Team of 12 engineers, 4 offices')).toBeUndefined()
  })
})

/**
 * One signal each, with a decoy integer in front of it.
 *
 * Each text below carries exactly ONE of the five things that mark digits as
 * money, and a bare number earlier in the string that would win without it.
 * Written this way deliberately: a text with two signals cannot tell you which
 * one is doing the work, and dropping any one of the five silently narrows what
 * the comparison screen can read.
 */
describe('what marks digits as money', () => {
  for (const [signal, text, amount] of [
    ['a currency symbol', 'Team of 12 engineers, $95000 base', 95_000],
    ['an ISO code', 'Team of 12 engineers, 95000 EUR', 95_000],
    ['a k/m multiplier', 'Team of 12 engineers, 95k base', 95_000],
    ['a thousands separator', 'Team of 12 engineers, 95,000 base', 95_000],
    ['a period touching the digits', 'Team of 12 engineers, 60/hr', 60],
  ] as const) {
    it(`reads ${signal}`, () => {
      expect(parseComp(text)?.amount).toBe(amount)
    })
  }
})
