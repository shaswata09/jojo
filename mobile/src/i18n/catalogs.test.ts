import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOCALES, SOURCE_LOCALE } from '@jojo/service/core/locale'
import { catalogProblems } from '@jojo/service/core/locale-catalog'
import type { Catalog } from '@jojo/service/core/locale-catalog'
import { DOMAIN_EN } from '@jojo/service/core/domain-text'
import { ADVICE_EN } from '@jojo/service/core/advice-text'

/**
 * The phone's catalogs, held to the rule the web's are (`catalogProblems`),
 * and the generated index held to the folder — a catalog file that
 * `resources.ts` does not import is a translation the app never shows.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(HERE, 'locales') + path.sep
const read = (locale: string) =>
  new Map<string, Catalog>(
    readdirSync(path.join(root, locale))
      .filter((f) => f.endsWith('.json'))
      .map((f) => [
        f.slice(0, -5),
        JSON.parse(readFileSync(path.join(root, locale, f), 'utf8')) as Catalog,
      ]),
  )
const locales = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
const source = read(SOURCE_LOCALE)

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

describe('the phone translation catalogs', () => {
  it('has a folder for every offered language and none for anything else', () => {
    expect([...locales].sort()).toEqual(LOCALES.map((l) => l.code).sort())
  })

  it('are all imported by resources.ts', () => {
    const index = readFileSync(path.join(HERE, 'resources.ts'), 'utf8')
    for (const locale of locales) {
      for (const ns of read(locale).keys()) {
        expect(index, `run node scripts/i18n-index.mjs (${locale}/${ns})`).toContain(
          `./locales/${locale}/${ns}.json`,
        )
      }
    }
  })

  it('says the domain words exactly as core does in English', () => {
    expect(source.get('domain')).toEqual(DOMAIN_EN)
  })

  it('says the Statistics advice exactly as core does in English', () => {
    expect(source.get('advice')).toEqual(ADVICE_EN)
  })

  it('uses no HTML void element as a Trans tag', () => {
    const offenders = locales
      .map((l) => [l, read(l)] as const)
      .flatMap(([locale, namespaces]) =>
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
      const theirs = read(code)
      expect([...theirs.keys()].sort()).toEqual([...source.keys()].sort())
      const problems = [...source].flatMap(([ns, english]) =>
        catalogProblems(english, theirs.get(ns) ?? {}).map((p) => `${ns}: ${p}`),
      )
      expect(problems).toEqual([])
    })
  }
})
