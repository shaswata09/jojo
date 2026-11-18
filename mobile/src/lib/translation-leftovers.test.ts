/**
 * Two translation leftovers from the third review, on the phone.
 *
 * The graph's caption said its counts in one sentence that could be plural on
 * neither ("1 edges"); it is now a frame around two plurals, run here through
 * the real catalogs. The tailoring chooser named each document by core's
 * English `label`; it now says the translated kind — wiring in a file that
 * imports React Native, which this runner does not load, so it is read as text.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { domain } from '@/i18n/domain'
import { i18next } from '@/i18n/i18n'
import { graphCaption } from './graph-view'
import type { Say } from './graph-view'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const say = (language: string): Say => {
  const t = i18next.getFixedT(language, 'screens')
  return (key, options) => t(key, options) as string
}

describe('the graph caption counts in real plurals', () => {
  it('says one node and one edge in the singular, two in the plural', () => {
    const t = say('en')
    expect(graphCaption(t, 1, 1, 1)).toBe(
      '1 of 1 node · 1 edge. Tap a node to read it; tap a type below to hide it.',
    )
    expect(graphCaption(t, 2, 2, 2)).toBe(
      '2 of 2 nodes · 2 edges. Tap a node to read it; tap a type below to hide it.',
    )
  })

  it('agrees the nodes phrase with the total, the number the noun follows', () => {
    expect(graphCaption(say('en'), 1, 5, 0)).toMatch(/^1 of 5 nodes · 0 edges\./)
  })

  it('uses Arabic’s dual for two', () => {
    const caption = graphCaption(say('ar'), 2, 2, 2)
    expect(caption).toContain('2 من 2 عقدتين')
    expect(caption).toContain('2 وصلتان')
    expect(caption).not.toMatch(/\{\{/)
  })
})

describe('the phone’s tailoring chooser in another language (review 3: i18n-2)', () => {
  const panel = strip(
    readFileSync(path.join(SRC, 'components/applications/TailoredPanel.tsx'), 'utf8'),
  )

  it('names each document by its translated kind, not core’s English label', () => {
    expect(panel).toMatch(/capitalise\(domain\.document\(cand\.kind\), i18n\.language\)/)
    expect(panel).not.toMatch(/cand\.label/)
    expect(panel).toMatch(/word\.charAt\(0\)\.toLocaleUpperCase\(language\)/)
  })
})

describe('the tailoring job’s label on both apps', () => {
  // Through the package's exports map, the way the app imports it.
  const hook = strip(
    readFileSync(
      createRequire(import.meta.url).resolve('@jojo/service/react/use-tailoring'),
      'utf8',
    ),
  )

  it('is worded by the DomainText the app hands KgProvider, not core’s English titleFor', () => {
    expect(hook).toMatch(/const \{[^}]*\btext\b[^}]*\} = useKg\(\)/)
    expect(hook).toMatch(/label: text\.tailoredTitle\(candidate\.kind, org\)/)
    expect(hook).not.toMatch(/\btitleFor\(/)
  })

  it('reads in the language on screen through the phone’s domain words', async () => {
    await i18next.changeLanguage('de')
    try {
      expect(domain.tailoredTitle('research-statement', 'Rice')).toBe('Forschungsstatement — Rice')
      expect(domain.tailoredTitle('cover-letter', ' ')).toBe('Anschreiben')
      await i18next.changeLanguage('zh-Hant')
      expect(domain.tailoredTitle('cv', 'Rice')).toBe(`${i18next.t('domain:document.cv')}——Rice`)
    } finally {
      await i18next.changeLanguage('en')
    }
    expect(domain.tailoredTitle('research-statement', 'Rice')).toBe('Research statement — Rice')
  })
})

describe('the phone date picker heading (review 3: i18n-6)', () => {
  it('writes the month and year in the language’s order, as the calendar does', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const here = path.dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(path.join(here, '../components/common/DateField.tsx'), 'utf8')
    expect(source).toContain('domain.monthYearParts(month.month, month.year)')
    expect(source).not.toMatch(/\{monthName\}\{' '\}/)
  })
})
