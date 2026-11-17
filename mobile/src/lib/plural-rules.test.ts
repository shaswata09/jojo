import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import { LOCALES as SHIPPED } from '@jojo/service/core/locale'
import { installPluralRules, PluralRules } from '@/lib/plural-rules'

/**
 * Node has ICU's `Intl.PluralRules`; Hermes has none. So Node is the oracle here
 * and the shim is held to it, number by number, for every language jojo ships.
 */

/** Every language the apps offer — read from the shared list, so a new one is checked here too. */
const LOCALES = SHIPPED.map((l) => l.code)

const NUMBERS = [
  ...Array.from({ length: 1001 }, (_, i) => i),
  0.5,
  1.5,
  2.5,
  0.1,
  1.0004,
  3.25,
  10.5,
  -1,
  -2,
  1_000_000,
  2_000_000,
  1_000_001,
  1_000_000.5,
]

describe('the PluralRules shim against Node’s ICU', () => {
  it.each(LOCALES)('selects the same category as ICU in %s', (locale) => {
    const real = new Intl.PluralRules(locale)
    const shim = new PluralRules(locale)
    const wrong = NUMBERS.filter((n) => shim.select(n) !== real.select(n)).map(
      (n) => `${n}: ${shim.select(n)} ≠ ${real.select(n)}`,
    )
    expect(wrong).toEqual([])
  })

  it.each(LOCALES)('reports the same plural categories as ICU in %s', (locale) => {
    const real = new Intl.PluralRules(locale).resolvedOptions().pluralCategories
    const shim = new PluralRules(locale).resolvedOptions().pluralCategories
    expect([...shim].sort()).toEqual([...real].sort())
  })

  it('refuses ordinal rules rather than answering them wrongly', () => {
    expect(() => new PluralRules('en', { type: 'ordinal' })).toThrow(RangeError)
  })
})

describe('installing the shim', () => {
  it('never replaces an engine that has the real thing', () => {
    const intl = { PluralRules: Intl.PluralRules }
    expect(installPluralRules({ Intl: intl })).toBe(false)
    expect(intl.PluralRules).toBe(Intl.PluralRules)
  })

  it('fills the gap on an engine without it, as Hermes is', () => {
    const intl: { PluralRules?: unknown } = {}
    expect(installPluralRules({ Intl: intl })).toBe(true)
    expect(intl.PluralRules).toBe(PluralRules)
  })

  /*
   * The bug end to end: with Node's PluralRules taken away, i18next's own
   * fallback says "1 → one, else other". With the shim in its place, the
   * Japanese count of 1 must reach `_other`, Arabic must reach `_two`/`_few`,
   * and French 0 must be singular.
   */
  it('gives i18next the right forms when the engine has no PluralRules', async () => {
    const real = Intl.PluralRules
    const intl = Intl as unknown as { PluralRules?: unknown }
    try {
      delete intl.PluralRules
      expect(installPluralRules()).toBe(true)
      const t = i18next.createInstance()
      await t.init({
        lng: 'en',
        fallbackLng: 'en',
        initAsync: false,
        resources: {
          en: { x: { n_one: 'EN one', n_other: 'EN other' } },
          ja: { x: { n_other: 'JA {{count}}' } },
          ar: {
            x: {
              n_zero: 'AR zero',
              n_one: 'AR one',
              n_two: 'AR two',
              n_few: 'AR few',
              n_many: 'AR many',
              n_other: 'AR other',
            },
          },
          fr: { x: { n_one: 'FR one', n_other: 'FR other' } },
          'pt-BR': { x: { n_one: 'PT one', n_many: 'PT many', n_other: 'PT other' } },
        },
      })
      const say = (lng: string, count: number) => t.t('n', { ns: 'x', lng, count })
      expect(say('ja', 1)).toBe('JA 1')
      expect([0, 1, 2, 3, 11, 100].map((n) => say('ar', n))).toEqual([
        'AR zero',
        'AR one',
        'AR two',
        'AR few',
        'AR many',
        'AR other',
      ])
      expect(say('fr', 0)).toBe('FR one')
      expect(say('pt-BR', 0)).toBe('PT one')
      expect(say('pt-BR', 1_000_000)).toBe('PT many')
    } finally {
      Object.defineProperty(Intl, 'PluralRules', {
        value: real,
        writable: true,
        configurable: true,
        enumerable: false,
      })
    }
  })
})
