/**
 * Reading a number out of what somebody typed about money.
 *
 * ## Why parse rather than ask
 *
 * `comp` is free text — `$112k + $15k startup`, `£45,000`, `60/hr` — and nothing
 * ever read it, so the one screen that could have ranked two offers could not
 * compare them, and Statistics charted everything about a search except what it
 * paid. The obvious fix is a numeric field beside the text; the better one is
 * this, because a numeric field only helps records entered AFTER it exists. A
 * parser makes every offer already in the store comparable on the day it ships,
 * and costs the user nothing.
 *
 * ## The text stays the truth
 *
 * Nothing here is written back. `comp` is still exactly what the user typed and
 * still what every detail screen shows; this is a reading OF it, recomputed on
 * demand and shown beside it so a wrong parse is visible rather than silently
 * ranked. That is the whole reason `parseComp` returns the matched substring —
 * a figure a reader cannot trace back to the words it came from is a figure they
 * have to trust.
 *
 * ## What it deliberately does not do
 *
 * It takes the FIRST amount and ignores the rest. `$112k + $15k startup` is
 * 112,000, not 127,000: the startup package is one-off, the equity line is not
 * salary, and a parser that added everything it saw would rank a generous
 * signing bonus above a better job. Summing is a judgement about what somebody
 * values, and the app does not get to make it.
 */

/** How often the amount is paid, when the text says. */
export type CompPeriod = 'year' | 'month' | 'week' | 'day' | 'hour'

export type ParsedComp = {
  /** The number as written, before any annualising. */
  amount: number
  /** '$', '£', '€' or a three-letter code, when one was written. */
  currency?: string
  period: CompPeriod
  /** Whether the period was stated or assumed. See `annualised`. */
  periodStated: boolean
  /** Exactly the characters this was read from, so a reader can check it. */
  matched: string
}

const SYMBOLS: Record<string, string> = { $: '$', '£': '£', '€': '€', '¥': '¥' }

const CODES = new Set(['usd', 'gbp', 'eur', 'cad', 'aud', 'chf', 'sek', 'jpy', 'inr'])

const PERIODS: { pattern: RegExp; period: CompPeriod }[] = [
  { pattern: /\b(?:per\s+)?(?:hour|hr|hourly)\b|\/\s*(?:hour|hr)\b/i, period: 'hour' },
  { pattern: /\b(?:per\s+)?(?:day|daily)\b|\/\s*day\b/i, period: 'day' },
  { pattern: /\b(?:per\s+)?(?:week|wk|weekly)\b|\/\s*(?:week|wk)\b/i, period: 'week' },
  { pattern: /\b(?:per\s+)?(?:month|mo|monthly|pcm)\b|\/\s*(?:month|mo)\b/i, period: 'month' },
  { pattern: /\b(?:per\s+)?(?:year|yr|annum|annually|pa)\b|\/\s*(?:year|yr)\b/i, period: 'year' },
]

/**
 * `112k`, `112,000`, `112 000`, `112.5k`.
 *
 * The thousands separator is allowed to be a comma, a space or nothing, and a
 * decimal point only survives when a `k` follows it — `112.5k` is a number and
 * `112.500` is a European hundred and twelve thousand five hundred, which this
 * deliberately does not try to tell apart. It reads the first as written and
 * treats the second as 112500 either way, which is the same answer.
 */
const AMOUNT =
  /(?<currency>[$£€¥])?\s*(?<digits>\d{1,3}(?:[,\s]\d{3})+|\d+(?:\.\d+)?)\s*(?<k>k\b|m\b)?\s*(?<code>[a-z]{3}\b)?/i

/**
 * The first amount in the text, or `undefined` when there is none to find.
 *
 * `undefined` rather than zero, and every caller has to handle it: an offer
 * whose package was described in words has not been read, and a comparison that
 * showed it as nothing would rank a real job last.
 */
export function parseComp(text: string): ParsedComp | undefined {
  const source = text.trim()
  if (!source) return undefined

  const hit = AMOUNT.exec(source)
  const groups = hit?.groups
  if (!hit || !groups) return undefined

  // Bracket access throughout: named groups arrive through an index signature,
  // so `noUncheckedIndexedAccess` types every one of them as possibly absent —
  // which they are, since all but `digits` are optional in the pattern.
  const raw = groups['digits']
  if (raw === undefined) return undefined
  const base = Number(raw.replace(/[,\s]/g, ''))
  if (!Number.isFinite(base) || base <= 0) return undefined

  const suffix = groups['k']?.toLowerCase()
  const amount = base * (suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1)

  const symbol = groups['currency']
  const code = groups['code']?.toLowerCase()
  const currency = symbol
    ? SYMBOLS[symbol]
    : code && CODES.has(code)
      ? code.toUpperCase()
      : undefined

  const stated = PERIODS.find((p) => p.pattern.test(source))

  return {
    amount,
    ...(currency === undefined ? {} : { currency }),
    /*
     * A year when nothing says otherwise, and `periodStated` is how the caller
     * knows the difference. Salaries are quoted annually far more often than
     * not, so assuming a year is right almost always — but a $60 that meant an
     * hourly rate would be ranked below a $45,000, and the flag is what lets a
     * comparison mark the guess rather than bury it.
     */
    period: stated?.period ?? 'year',
    periodStated: stated !== undefined,
    matched: hit[0].trim(),
  }
}

/** Hours, days and so on in a working year. Stated here so a caller can say so. */
export const PER_YEAR: Record<CompPeriod, number> = {
  year: 1,
  month: 12,
  week: 52,
  day: 260,
  hour: 2080,
}

/**
 * The amount as a yearly figure, for putting two offers on one axis.
 *
 * The multipliers above are conventions, not facts — 2080 hours is 40 a week
 * for 52 weeks with no holiday — so anything annualised from a stated
 * non-yearly period is a derived number and a comparison has to label it.
 */
export const annualised = (parsed: ParsedComp): number => parsed.amount * PER_YEAR[parsed.period]

/**
 * Whether two parsed amounts can honestly be put side by side.
 *
 * Currencies are NOT converted. There is no exchange rate in this app and there
 * should not be one: a rate needs a network call and a date, and a comparison
 * that quietly used last Tuesday's is worse than one that admits it cannot
 * compare. Two offers in different currencies are shown with both figures and
 * no ranking.
 */
export function comparable(a: ParsedComp, b: ParsedComp): boolean {
  if (a.currency === undefined || b.currency === undefined) return true
  return a.currency === b.currency
}
