/**
 * L1 — which languages jojo speaks, and which one a person gets.
 *
 * One list for both apps, so the web picker and the phone picker cannot offer
 * different sets, and a language added here is added everywhere. The strings
 * themselves live with each app (`web/src/i18n`, `mobile/src/i18n`), because
 * the two apps say different things; this file only decides WHICH catalog.
 *
 * The set is the world's most-spoken languages, written as BCP 47 tags: the
 * first ten from 2026-11-16, then the next ten by number of speakers —
 * Bengali, Russian, Urdu, Indonesian, Turkish, Vietnamese, Italian, Marathi,
 * Tamil — and Traditional Chinese, so Taiwan and Hong Kong are no longer sent
 * to English. `dir` is there for Arabic and Urdu: a right-to-left language
 * needs the document's direction set, not just its words.
 */

export type LocaleInfo = {
  /** BCP 47 tag, the catalog's key: 'en', 'pt-BR', 'zh-Hans'. */
  readonly code: string
  /** The language's own name for itself — what a picker shows, so a person can find theirs. */
  readonly native: string
  /** The English name, for the guide and for anyone helping someone else. */
  readonly english: string
  readonly dir: 'ltr' | 'rtl'
}

export const LOCALES = [
  { code: 'en', native: 'English', english: 'English', dir: 'ltr' },
  { code: 'es', native: 'Español', english: 'Spanish', dir: 'ltr' },
  { code: 'fr', native: 'Français', english: 'French', dir: 'ltr' },
  { code: 'de', native: 'Deutsch', english: 'German', dir: 'ltr' },
  { code: 'pt-BR', native: 'Português (Brasil)', english: 'Portuguese (Brazil)', dir: 'ltr' },
  { code: 'zh-Hans', native: '简体中文', english: 'Chinese (Simplified)', dir: 'ltr' },
  { code: 'ja', native: '日本語', english: 'Japanese', dir: 'ltr' },
  { code: 'ko', native: '한국어', english: 'Korean', dir: 'ltr' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', dir: 'ltr' },
  { code: 'ar', native: 'العربية', english: 'Arabic', dir: 'rtl' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali', dir: 'ltr' },
  { code: 'ru', native: 'Русский', english: 'Russian', dir: 'ltr' },
  { code: 'ur', native: 'اردو', english: 'Urdu', dir: 'rtl' },
  { code: 'id', native: 'Bahasa Indonesia', english: 'Indonesian', dir: 'ltr' },
  { code: 'tr', native: 'Türkçe', english: 'Turkish', dir: 'ltr' },
  { code: 'vi', native: 'Tiếng Việt', english: 'Vietnamese', dir: 'ltr' },
  { code: 'it', native: 'Italiano', english: 'Italian', dir: 'ltr' },
  { code: 'zh-Hant', native: '繁體中文', english: 'Chinese (Traditional)', dir: 'ltr' },
  { code: 'mr', native: 'मराठी', english: 'Marathi', dir: 'ltr' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil', dir: 'ltr' },
] as const satisfies readonly LocaleInfo[]

export type LocaleCode = (typeof LOCALES)[number]['code']

/** The language every string is written in first, and the fallback for a missing one. */
export const SOURCE_LOCALE: LocaleCode = 'en'

/** The picker's "follow this device" choice, stored instead of a code. */
export const DEVICE_LOCALE = 'system'
export type LocaleChoice = LocaleCode | typeof DEVICE_LOCALE

const CODES: ReadonlySet<string> = new Set(LOCALES.map((l) => l.code))

export const isLocaleCode = (value: unknown): value is LocaleCode =>
  typeof value === 'string' && CODES.has(value)

export const localeInfo = (code: LocaleCode): LocaleInfo =>
  LOCALES.find((l) => l.code === code) ?? LOCALES[0]

/**
 * The best supported language for what a device asks for, in its order of
 * preference — `navigator.languages` on the web, the device locale on a phone.
 *
 * Matched exactly first ('pt-BR'), then by script for Chinese, whose region
 * tags name a script without saying so ('zh-CN' and 'zh-SG' are Simplified;
 * 'zh-TW', 'zh-HK' and 'zh-MO' are Traditional), then by language alone
 * ('es-MX' → 'es', 'pt-PT' → 'pt-BR'). Nothing matching is English.
 */
export function negotiateLocale(wanted: readonly string[]): LocaleCode {
  for (const raw of wanted) {
    const tag = raw.trim().replace(/_/g, '-')
    if (tag === '') continue
    const exact = LOCALES.find((l) => l.code.toLowerCase() === tag.toLowerCase())
    if (exact) return exact.code
    const [language = '', ...rest] = tag.toLowerCase().split('-')
    if (language === 'zh') {
      const traditional = rest.some((part) => ['hant', 'tw', 'hk', 'mo'].includes(part))
      return traditional ? 'zh-Hant' : 'zh-Hans'
    }
    const byLanguage = LOCALES.find((l) => l.code.toLowerCase().split('-')[0] === language)
    if (byLanguage) return byLanguage.code
  }
  return SOURCE_LOCALE
}

/** What a stored choice resolves to on this device. */
export function resolveLocale(choice: unknown, device: readonly string[]): LocaleCode {
  return isLocaleCode(choice) ? choice : negotiateLocale(device)
}
