/**
 * `Intl.PluralRules` for the ten languages the phone ships, because Hermes has
 * none.
 *
 * Hermes 0.81 implements `Intl.Collator`, `DateTimeFormat` and `NumberFormat`
 * and nothing else. i18next picks a plural form with `new Intl.PluralRules(code)`
 * and, when that throws, falls back quietly to "1 is one, everything else is
 * other". That fallback is English: Japanese, Chinese and Korean catalogs only
 * have `_other`, so a count of 1 found no `_one` and showed the English string;
 * Arabic never reached zero/two/few/many; French and Portuguese called 0 plural.
 * The catalog tests run on Node, which has the real thing, so none of them could
 * see it.
 *
 * Hand-written rather than `@formatjs/intl-pluralrules` because the whole need
 * is ten cardinal rules, and that package also wants an `Intl.Locale` polyfill
 * Hermes lacks. `plural-rules.test.ts` holds every rule here against Node's ICU
 * for 0..1000 and a set of decimals, so a mistake cannot hide.
 *
 * The rules are CLDR's cardinal rules, written in CLDR's operands:
 * `n` absolute value, `i` integer digits, `v` count of visible fraction digits.
 * Operands come from the number as `Intl` would format it by default — at most
 * three fraction digits, trailing zeros dropped — which is what `select()`
 * itself does.
 *
 * Cardinal only. Nothing in jojo uses ordinal plurals (`_ordinal_` keys); asking
 * for one throws, which i18next turns into its own fallback rather than this file
 * pretending to know the answer.
 */

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

type Operands = { n: number; i: number; v: number }

type Rule = {
  categories: readonly PluralCategory[]
  select: (o: Operands) => PluralCategory
}

/**
 * The French/Spanish/Portuguese "many": an exact non-zero multiple of a
 * million with no fraction ("1 000 000 de rappels"). The `e` operand (compact
 * exponent) is always 0 for a plain number, so its half of the CLDR rule never
 * applies here.
 */
const millions = ({ i, v }: Operands) => i !== 0 && i % 1_000_000 === 0 && v === 0

const RULES: Record<string, Rule> = {
  // one: i = 1 and v = 0
  en: {
    categories: ['one', 'other'],
    select: ({ i, v }) => (i === 1 && v === 0 ? 'one' : 'other'),
  },
  // one: i = 1 and v = 0
  de: {
    categories: ['one', 'other'],
    select: ({ i, v }) => (i === 1 && v === 0 ? 'one' : 'other'),
  },
  // one: n = 1; many: millions; other
  es: {
    categories: ['many', 'one', 'other'],
    select: (o) => (o.n === 1 ? 'one' : millions(o) ? 'many' : 'other'),
  },
  // one: i = 0,1; many: millions; other
  fr: {
    categories: ['many', 'one', 'other'],
    select: (o) => (o.i === 0 || o.i === 1 ? 'one' : millions(o) ? 'many' : 'other'),
  },
  // Brazilian Portuguese is CLDR's `pt` (pt-PT is the one that differs).
  // one: i = 0..1; many: millions; other
  pt: {
    categories: ['many', 'one', 'other'],
    select: (o) => (o.i === 0 || o.i === 1 ? 'one' : millions(o) ? 'many' : 'other'),
  },
  // one: i = 0 or n = 1
  hi: {
    categories: ['one', 'other'],
    select: ({ i, n }) => (i === 0 || n === 1 ? 'one' : 'other'),
  },
  zh: { categories: ['other'], select: () => 'other' },
  ja: { categories: ['other'], select: () => 'other' },
  ko: { categories: ['other'], select: () => 'other' },
  // zero: n = 0; one: n = 1; two: n = 2; few: n % 100 = 3..10;
  // many: n % 100 = 11..99; other. A CLDR range on `n` matches whole values
  // only, so 3.5 is "other", not "few".
  ar: {
    categories: ['few', 'many', 'one', 'two', 'zero', 'other'],
    select: ({ n }) => {
      if (n === 0) return 'zero'
      if (n === 1) return 'one'
      if (n === 2) return 'two'
      if (!Number.isInteger(n)) return 'other'
      const m = n % 100
      if (m >= 3 && m <= 10) return 'few'
      if (m >= 11 && m <= 99) return 'many'
      return 'other'
    },
  },
}

/** The language a tag resolves to here: `pt-BR` → `pt`, `zh-Hans` → `zh`. */
function resolve(locales: unknown): string {
  const list = Array.isArray(locales) ? locales : locales === undefined ? [] : [locales]
  for (const tag of list) {
    if (typeof tag !== 'string') continue
    const language = tag.split(/[-_]/)[0]?.toLowerCase() ?? ''
    if (language in RULES) return language
  }
  // What a real engine does with a language it has no data for: use its default
  // locale. jojo's source language is English.
  return 'en'
}

/** CLDR operands of `value` formatted the default way (≤ 3 fraction digits). */
export function operands(value: number): Operands {
  const abs = Math.abs(value)
  const text = abs.toFixed(3).replace(/\.?0+$/, '')
  const dot = text.indexOf('.')
  const v = dot === -1 ? 0 : text.length - dot - 1
  const n = Number(text)
  return { n, i: Math.trunc(n), v }
}

type Options = { type?: 'cardinal' | 'ordinal' }

/**
 * The slice of `Intl.PluralRules` i18next calls: the constructor, `select` and
 * `resolvedOptions().pluralCategories`.
 */
export class PluralRules {
  private readonly locale: string

  constructor(locales?: string | readonly string[], options?: Options) {
    if (options?.type === 'ordinal') {
      throw new RangeError('jojo PluralRules: ordinal plurals are not supported')
    }
    this.locale = resolve(locales)
  }

  select(value: number): PluralCategory {
    const number = Number(value)
    if (!Number.isFinite(number)) return 'other'
    return RULES[this.locale]!.select(operands(number))
  }

  resolvedOptions() {
    return {
      locale: this.locale,
      type: 'cardinal' as const,
      minimumIntegerDigits: 1,
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
      pluralCategories: [...RULES[this.locale]!.categories],
    }
  }

  static supportedLocalesOf(locales?: string | readonly string[]): string[] {
    const list = Array.isArray(locales) ? locales : locales === undefined ? [] : [locales]
    return list.filter(
      (tag): tag is string =>
        typeof tag === 'string' && (tag.split(/[-_]/)[0]?.toLowerCase() ?? '') in RULES,
    )
  }
}

/**
 * Put `PluralRules` on `Intl` where the engine has none. Guarded, never
 * overwriting: a Hermes that grows a real one should win. Returns whether it
 * installed anything, for the test.
 */
export function installPluralRules(target: { Intl?: unknown } = globalThis): boolean {
  const intl = target.Intl as { PluralRules?: unknown } | undefined
  if (intl === undefined || intl === null) return false
  if (typeof intl.PluralRules === 'function') return false
  Object.defineProperty(intl, 'PluralRules', {
    value: PluralRules,
    writable: true,
    configurable: true,
    enumerable: false,
  })
  return true
}
