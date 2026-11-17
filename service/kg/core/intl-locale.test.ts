import { describe, expect, it } from 'vitest'
import { intlLocale } from './intl-locale'

/** The twenty languages the phone ships, and the web with it. */
const LANGUAGES = [
  'en', 'es', 'fr', 'de', 'pt-BR', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'hi',
  'ar', 'bn', 'ru', 'ur', 'id', 'it', 'mr', 'ta', 'tr', 'vi',
]

describe('intlLocale — one numbering system for every number on a screen', () => {
  it('formats Bengali and Marathi dates and numbers in the Latin digits counts use', () => {
    const day = new Date(2026, 10, 17)
    for (const language of ['bn', 'mr']) {
      const number = new Intl.NumberFormat(intlLocale(language)).format(131072)
      const date = new Intl.DateTimeFormat(intlLocale(language), { day: 'numeric' }).format(day)
      expect(number).toMatch(/^[0-9,]+$/)
      expect(date).toBe('17')
      // Still the language's own grouping, words and month names.
      expect(number).toBe(new Intl.NumberFormat('en-IN').format(131072))
      expect(
        new Intl.DateTimeFormat(intlLocale(language), { month: 'long' }).format(day),
      ).toBe(new Intl.DateTimeFormat(language, { month: 'long' }).format(day))
    }
  })

  it('leaves every language in Latin digits, Arabic included', () => {
    for (const language of LANGUAGES) {
      const tag = intlLocale(language)
      expect(new Intl.NumberFormat(tag).resolvedOptions().numberingSystem).toBe('latn')
      expect(new Intl.DateTimeFormat(tag).resolvedOptions().numberingSystem).toBe('latn')
      expect(new Intl.NumberFormat(tag).resolvedOptions().locale.startsWith(language)).toBe(true)
    }
  })

  it('keeps a numbering system a tag already names, and adds to an existing extension', () => {
    expect(intlLocale('ar-u-nu-arab')).toBe('ar-u-nu-arab')
    expect(intlLocale('de-u-ca-gregory')).toBe('de-u-nu-latn-ca-gregory')
    expect(intlLocale('en-x-test')).toBe('en-u-nu-latn-x-test')
    expect(intlLocale('bn')).toBe('bn-u-nu-latn')
  })

  it('gives no tag for no language, so Intl falls back as it did', () => {
    expect(intlLocale(undefined)).toBeUndefined()
    expect(intlLocale('')).toBeUndefined()
  })
})
