/**
 * Every `Intl` formatter that formats in the language jojo is showing goes
 * through `intlLocale` (`@jojo/service/core/intl-locale`), as on the phone.
 *
 * Counts reach the page through i18next interpolation in Latin digits; `Intl`
 * on a bare `bn` or `mr` tag answers in Bengali or Devanagari ones, so one line
 * mixed the two ("১৭ নভেম্বর · 12টি"). A call with no argument, or an explicit
 * English tag, is the guide's English-only prose and is left alone.
 */
import { describe, expect, it } from 'vitest'
import { intlLocale } from '@jojo/service/core/intl-locale'

const files = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const CALL =
  /(?:new\s+)?Intl\.(?:DateTimeFormat|NumberFormat|ListFormat|RelativeTimeFormat)\(([^)]*)|\.toLocale(?:Date|Time)?String\(([^)]*)/g

const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('numbers in the language on screen', () => {
  it('hands every Intl formatter the app language through intlLocale', () => {
    const offenders: string[] = []
    let calls = 0
    for (const [file, raw] of Object.entries(files)) {
      if (/\.test\.tsx?$/.test(file)) continue
      for (const m of withoutComments(raw).matchAll(CALL)) {
        calls += 1
        const arg = (m[1] ?? m[2] ?? '').trim()
        if (arg === '' || /^['"]/.test(arg) || arg.startsWith('intlLocale(')) continue
        offenders.push(`${file}: ${m[0]}`)
      }
    }
    expect(calls).toBeGreaterThan(10)
    expect(offenders).toEqual([])
  })

  it('formats Bengali dates and numbers in the digits counts use', () => {
    const day = new Date(2026, 10, 17)
    expect(new Intl.NumberFormat(intlLocale('bn')).format(131072)).toBe('1,31,072')
    expect(new Intl.DateTimeFormat(intlLocale('bn'), { day: 'numeric' }).format(day)).toBe('17')
    expect(new Intl.DateTimeFormat(intlLocale('mr'), { day: 'numeric' }).format(day)).toBe('17')
  })
})
