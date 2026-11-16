import { describe, expect, it } from 'vitest'
import { LOCALES, SOURCE_LOCALE } from '@jojo/service/core/locale'
import { catalogProblems } from '@jojo/service/core/locale-catalog'
import type { Catalog } from '@jojo/service/core/locale-catalog'

/**
 * Every language holds exactly what English holds — the rule is
 * `catalogProblems`, shared with the phone's catalogs.
 */

const catalogs = import.meta.glob<{ default: Catalog }>('./locales/*/*.json', { eager: true })

const byLocale = new Map<string, Map<string, Catalog>>()
for (const [path, mod] of Object.entries(catalogs)) {
  const parts = path.split('/')
  const locale = parts.at(-2) ?? ''
  const ns = (parts.at(-1) ?? '').replace(/\.json$/, '')
  const map = byLocale.get(locale) ?? new Map<string, Catalog>()
  map.set(ns, mod.default)
  byLocale.set(locale, map)
}
const source = byLocale.get(SOURCE_LOCALE) ?? new Map<string, Catalog>()

describe('the web translation catalogs', () => {
  it('has a folder for every offered language and none for anything else', () => {
    expect([...byLocale.keys()].sort()).toEqual(LOCALES.map((l) => l.code).sort())
  })

  for (const { code } of LOCALES) {
    if (code === SOURCE_LOCALE) continue
    it(`${code} has every namespace English has, saying everything English says`, () => {
      const theirs = byLocale.get(code) ?? new Map<string, Catalog>()
      expect([...theirs.keys()].sort()).toEqual([...source.keys()].sort())
      const problems = [...source].flatMap(([ns, english]) =>
        catalogProblems(english, theirs.get(ns) ?? {}).map((p) => `${ns}: ${p}`),
      )
      expect(problems).toEqual([])
    })
  }
})
