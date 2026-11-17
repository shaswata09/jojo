import { describe, expect, it } from 'vitest'
import { LOCALES, SOURCE_LOCALE } from '@jojo/service/core/locale'
import { catalogProblems } from '@jojo/service/core/locale-catalog'
import type { Catalog } from '@jojo/service/core/locale-catalog'
import { DOMAIN_EN } from '@jojo/service/core/domain-text'
import { ADVICE_EN } from '@jojo/service/core/advice-text'

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

/**
 * HTML void elements. react-i18next parses a translation as HTML, so one of
 * these names used as a Trans tag closes at once: `<link>Files</link>` renders
 * an empty, nameless anchor with "Files" as plain text after it. Name such
 * tags something else (`<anchor>`).
 */
const VOID_TAGS = [
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]
const VOID_TAG = new RegExp(`</?(?:${VOID_TAGS.join('|')})\\b[^>]*>`, 'i')
const strings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : value && typeof value === 'object'
      ? Object.values(value).flatMap(strings)
      : []

describe('the web translation catalogs', () => {
  it('has a folder for every offered language and none for anything else', () => {
    expect([...byLocale.keys()].sort()).toEqual(LOCALES.map((l) => l.code).sort())
  })

  it('holds the domain words in the English core writes them in', () => {
    // Generated from core's tables; a label changed there fails here until
    // en/domain.json follows (`kg/core/domain-text.ts`).
    expect(source.get('domain')).toEqual(DOMAIN_EN)
  })

  it('holds the Statistics advice in the English core writes it in', () => {
    // Generated from `ADVICE_EN` (`kg/core/advice-text.ts`); a sentence changed
    // there fails here until en/advice.json follows.
    expect(source.get('advice')).toEqual(ADVICE_EN)
  })

  it('uses no HTML void element as a Trans tag', () => {
    const offenders = [...byLocale].flatMap(([locale, namespaces]) =>
      [...namespaces].flatMap(([ns, catalog]) =>
        strings(catalog)
          .filter((text) => VOID_TAG.test(text))
          .map((text) => `${locale}/${ns}: ${text}`),
      ),
    )
    expect(offenders).toEqual([])
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
