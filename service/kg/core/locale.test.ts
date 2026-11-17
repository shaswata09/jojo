import { describe, expect, it } from 'vitest'
import { DEVICE_LOCALE, LOCALES, negotiateLocale, resolveLocale } from './locale'

describe('which language a device gets', () => {
  it('takes an exact match, then the language alone', () => {
    expect(negotiateLocale(['pt-BR'])).toBe('pt-BR')
    expect(negotiateLocale(['pt-PT'])).toBe('pt-BR')
    expect(negotiateLocale(['es-MX', 'en'])).toBe('es')
    expect(negotiateLocale(['de_AT'])).toBe('de')
  })

  it('reads Chinese by script, and never shows Simplified to a Traditional reader', () => {
    expect(negotiateLocale(['zh-CN'])).toBe('zh-Hans')
    expect(negotiateLocale(['zh-Hans-SG'])).toBe('zh-Hans')
    expect(negotiateLocale(['zh-TW', 'ja'])).toBe('zh-Hant')
    expect(negotiateLocale(['zh-Hant'])).toBe('zh-Hant')
    expect(negotiateLocale(['zh-HK'])).toBe('zh-Hant')
  })

  it('walks the preference list and falls back to English', () => {
    expect(negotiateLocale(['xx', 'fr-CA'])).toBe('fr')
    expect(negotiateLocale([])).toBe('en')
    expect(negotiateLocale(['', 'tlh'])).toBe('en')
  })

  it('prefers a stored choice over the device, unless it is "follow the device"', () => {
    expect(resolveLocale('ja', ['fr'])).toBe('ja')
    expect(resolveLocale(DEVICE_LOCALE, ['fr'])).toBe('fr')
    expect(resolveLocale('klingon', ['ko-KR'])).toBe('ko')
  })

  it('marks Arabic and Urdu right-to-left and nothing else', () => {
    expect(LOCALES.filter((l) => l.dir === 'rtl').map((l) => l.code)).toEqual(['ar', 'ur'])
  })

  it('offers Bengali and the other most-spoken languages', () => {
    const codes = LOCALES.map((l) => l.code)
    for (const code of ['bn', 'ru', 'ur', 'id', 'tr', 'vi', 'it', 'zh-Hant', 'mr', 'ta'] as const) {
      expect(codes).toContain(code)
    }
    expect(negotiateLocale(['bn-IN'])).toBe('bn')
    expect(negotiateLocale(['ur-PK'])).toBe('ur')
    expect(negotiateLocale(['ru-RU'])).toBe('ru')
  })
})
