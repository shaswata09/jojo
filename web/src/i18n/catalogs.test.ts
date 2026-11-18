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

/*
 * Every key the web's code asks for exists in the English catalog (review 3,
 * i18n-11) — the phone's `used-keys.test.ts`, ported.
 *
 * The test above compares the catalogs with each other, so a key the code uses
 * and NO catalog holds passes it: i18next then renders the key itself, in every
 * language. A source scan rather than a runtime one, because the components
 * cannot be mounted here (D20).
 *
 * Each file's namespaces are resolved the ways the web names them: the first
 * namespace of `useTranslation(...)` is its `t`'s default (none means
 * `common`, the app's `defaultNS`), and a renamed `t: tx` keeps its own;
 * `TFunction<'ns'>` and `getFixedT(null, 'ns')` name one; `i18next.t` defaults
 * to `common`; an `ns:` prefix or a `{ ns: '…' }` option overrides any of
 * them; `<Trans i18nKey>` reads its `ns=`. A templated key is checked against
 * the keys its fixed parts allow. A plural key is present through any suffix.
 */
const sourceFiles = import.meta.glob<string>(
  ['../**/*.{ts,tsx}', '!../**/*.test.ts', '!../**/*.d.ts'],
  { query: '?raw', import: 'default', eager: true },
)

const PLURAL = ['_zero', '_one', '_two', '_few', '_many', '_other']

const englishKeys = new Map<string, Set<string>>()
for (const [ns, catalog] of source) {
  const keys = new Set<string>()
  const walk = (node: Catalog, prefix: string) => {
    for (const [k, v] of Object.entries(node)) {
      const key = prefix ? `${prefix}.${k}` : k
      keys.add(key)
      if (v && typeof v === 'object') walk(v as Catalog, key)
    }
  }
  walk(catalog, '')
  englishKeys.set(ns, keys)
}

const holds = (ns: string, key: string): boolean => {
  const keys = englishKeys.get(ns)
  return keys !== undefined && (keys.has(key) || PLURAL.some((s) => keys.has(key + s)))
}

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Every key a file asks for that English does not hold, as `file:line key`. */
function missingKeys(file: string, text: string): string[] {
  const aliases = new Map<string, Set<string>>()
  const alias = (name: string, ns: string) => {
    const set = aliases.get(name) ?? new Set<string>()
    set.add(ns)
    aliases.set(name, set)
  }
  for (const m of text.matchAll(
    /const\s*\{\s*([^}]*)\}\s*=\s*useTranslation\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")?/g,
  )) {
    const first = m[2] ? (/['"]([^'"]+)['"]/.exec(m[2])?.[1] ?? 'common') : 'common'
    for (const part of (m[1] ?? '').split(',')) {
      const named = /^\s*t\s*(?::\s*(\w+))?\s*$/.exec(part)
      if (named) alias(named[1] ?? 't', first)
    }
  }
  for (const m of text.matchAll(/TFunction<'(\w+)'>/g)) alias('t', m[1] ?? 'common')
  for (const m of text.matchAll(/getFixedT\(\s*null\s*,\s*'(\w+)'/g)) alias('t', m[1] ?? 'common')
  if (aliases.size === 0 && !/i18next\.t\(|i18nKey/.test(text)) return []

  const fallback = [...(aliases.get('t') ?? new Set(['common']))]
  const namespacesFor = (caller: string, after: string): string[] => {
    const option = /^\s*,\s*\{[^}]*\bns:\s*'(\w+)'/.exec(after)
    if (option) return [option[1] ?? 'common']
    if (caller === 'i18next.t') return ['common']
    return [...(aliases.get(caller) ?? fallback)]
  }
  const missing: string[] = []
  const report = (index: number, what: string) =>
    missing.push(`${file.replace(/^\.\.\//, '')}:${lineOf(text, index)} ${what}`)
  const check = (caller: string, raw: string, index: number, after: string) => {
    const colon = raw.indexOf(':')
    const ok =
      colon > 0 && englishKeys.has(raw.slice(0, colon))
        ? holds(raw.slice(0, colon), raw.slice(colon + 1))
        : namespacesFor(caller, after).some((ns) => holds(ns, raw))
    if (!ok) report(index, raw)
  }

  const callers = [...aliases.keys(), 'i18next.t'].map(escape).join('|')
  const after = (m: RegExpMatchArray) =>
    text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 300)
  for (const m of text.matchAll(
    new RegExp(`(?<![\\w.])(${callers})\\(\\s*(['"])([\\w.:-]+)\\2`, 'g'),
  )) {
    check(m[1] ?? 't', m[3] ?? '', m.index ?? 0, after(m))
  }
  for (const m of text.matchAll(new RegExp(`(?<![\\w.])(${callers})\\(\\s*\`([^\`]*)\``, 'g'))) {
    const caller = m[1] ?? 't'
    const template = m[2] ?? ''
    if (!template.includes('${')) {
      check(caller, template, m.index ?? 0, after(m))
      continue
    }
    const named = /^(\w+):/.exec(template)
    const body = named ? template.slice(named[0].length) : template
    // Wholly dynamic (`${key}`): nothing fixed to check against.
    if (body.startsWith('${')) continue
    const pattern = new RegExp(
      `^${body
        .split(/\$\{[^}]*\}/)
        .map(escape)
        .join('[^]+?')}(_(zero|one|two|few|many|other))?$`,
    )
    const candidates = named ? [named[1] ?? 'common'] : namespacesFor(caller, after(m))
    const ok = candidates.some((ns) =>
      [...(englishKeys.get(ns) ?? [])].some((key) => pattern.test(key)),
    )
    if (!ok) report(m.index ?? 0, template)
  }
  for (const m of text.matchAll(/i18nKey=["']([\w.:-]+)["']/g)) {
    const raw = m[1] ?? ''
    const index = m.index ?? 0
    const around = text.slice(Math.max(0, index - 200), index + 300)
    const ns = /\bns=["'](\w+)["']/.exec(around)?.[1]
    if (ns !== undefined && !raw.includes(':')) {
      if (!holds(ns, raw)) report(index, `<Trans i18nKey="${raw}">`)
    } else check(/\bt=\{(\w+)\}/.exec(around)?.[1] ?? 't', raw, index, '')
  }
  return missing
}

describe('the keys the web asks for (review 3, i18n-11)', () => {
  it('scans the app’s sources, not an empty set', () => {
    expect(Object.keys(sourceFiles).length).toBeGreaterThan(200)
    expect(Object.keys(sourceFiles).some((file) => file.endsWith('.test.ts'))).toBe(false)
  })

  it('are all in the English catalog, in the namespace each file reads them from', () => {
    const missing = Object.entries(sourceFiles).flatMap(([file, text]) => missingKeys(file, text))
    expect(missing).toEqual([])
  })

  it('would catch a key nobody added', () => {
    // The scanner itself, on a file shaped like a component: one key that is
    // there, one that is not, one in another namespace, one from a template.
    const fake = [
      "const { t } = useTranslation('vault')",
      "t('pdf.saved', { name })",
      "t('pdf.notAKey')",
      "i18next.t('messages:backup.failedTitle')",
      't(`pdf.modes.${mode}`)',
      't(`pdf.nothing.${mode}`)',
    ].join('\n')
    expect(missingKeys('Fake.tsx', fake)).toEqual([
      'Fake.tsx:3 pdf.notAKey',
      'Fake.tsx:6 pdf.nothing.${mode}',
    ])
  })
})
