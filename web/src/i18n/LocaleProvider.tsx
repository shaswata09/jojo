import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  DEVICE_LOCALE,
  isLocaleCode,
  localeInfo,
  negotiateLocale,
  resolveLocale,
} from '@jojo/service/core/locale'
import type { LocaleChoice, LocaleCode } from '@jojo/service/core/locale'
import { i18next, loadLocale } from '@/i18n/i18n'
import { LOCALE_STORAGE_KEY, LocaleContext } from '@/i18n/locale-context'
import { readStored, writeStored } from '@/lib/storage'

const deviceLocale = (): LocaleCode =>
  negotiateLocale(
    typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]),
  )

const readChoice = (): LocaleChoice => {
  const stored = readStored(LOCALE_STORAGE_KEY)
  return isLocaleCode(stored) ? stored : DEVICE_LOCALE
}

/**
 * The language on screen, kept in step with the person's choice.
 *
 * It also sets `<html lang dir>`: `lang` so screen readers pronounce the page
 * in the right voice and the browser hyphenates and picks fonts correctly, and
 * `dir` so Arabic reads right to left. A language change waits for its catalog
 * before switching, so the page never flashes half English, half the new one.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<LocaleChoice>(readChoice)
  const [device, setDevice] = useState<LocaleCode>(deviceLocale)
  const [locale, setLocale] = useState<LocaleCode>(() =>
    resolveLocale(readChoice(), [deviceLocale()]),
  )

  // The browser's own language can change under an open tab.
  useEffect(() => {
    const onChange = () => setDevice(deviceLocale())
    window.addEventListener('languagechange', onChange)
    return () => window.removeEventListener('languagechange', onChange)
  }, [])

  useEffect(() => {
    const target = resolveLocale(choice, [device])
    let current = true
    void loadLocale(target)
      .then(() => i18next.changeLanguage(target))
      .then(() => {
        if (current) setLocale(target)
      })
      .catch(() => {
        // A chunk that would not load (offline, before the service worker had
        // it) leaves the page in the language it was in, rather than broken.
      })
    return () => {
      current = false
    }
  }, [choice, device])

  useEffect(() => {
    const root = document.documentElement
    root.lang = locale
    root.dir = localeInfo(locale).dir
  }, [locale])

  const setChoice = useCallback((next: LocaleChoice) => {
    setChoiceState(next)
    writeStored(LOCALE_STORAGE_KEY, next)
  }, [])

  const value = useMemo(
    () => ({ choice, locale, device, setChoice }),
    [choice, locale, device, setChoice],
  )
  return <LocaleContext value={value}>{children}</LocaleContext>
}
