import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { I18nManager } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  DEVICE_LOCALE,
  isLocaleCode,
  localeInfo,
  negotiateLocale,
  resolveLocale,
} from '@jojo/service/core/locale'
import type { LocaleChoice, LocaleCode } from '@jojo/service/core/locale'
import { i18next } from '@/i18n/i18n'
import { LOCALE_STORAGE_KEY, LocaleContext } from '@/i18n/locale-context'

/**
 * The phone's own language, from the platform rather than from `Intl`.
 *
 * Android reports it through `I18nManager`'s constants (`localeIdentifier`,
 * 'de_DE'); Hermes's `Intl` can answer 'en-US' whatever the phone is set to.
 */
function deviceLocale(): LocaleCode {
  const constants = I18nManager.getConstants() as { localeIdentifier?: string }
  const wanted = [constants.localeIdentifier ?? '']
  try {
    wanted.push(Intl.DateTimeFormat().resolvedOptions().locale)
  } catch {
    // No Intl: the platform's answer, or English.
  }
  return negotiateLocale(wanted)
}

/**
 * The language on screen, kept in step with the person's choice and stored.
 *
 * Text changes at once. Layout DIRECTION does not: React Native fixes it when
 * the app starts, so switching into or out of Arabic sets the direction for the
 * next launch and says so (`restartPending`) rather than half-mirroring the
 * screens that are already up.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [device] = useState<LocaleCode>(deviceLocale)
  const [choice, setChoiceState] = useState<LocaleChoice>(DEVICE_LOCALE)
  const locale = resolveLocale(choice, [device])

  useEffect(() => {
    let current = true
    void AsyncStorage.getItem(LOCALE_STORAGE_KEY)
      .then((stored) => {
        if (current && isLocaleCode(stored)) setChoiceState(stored)
      })
      .catch(() => {
        // Unreadable storage: the phone's own language.
      })
    return () => {
      current = false
    }
  }, [])

  useEffect(() => {
    void i18next.changeLanguage(locale)
    const rtl = localeInfo(locale).dir === 'rtl'
    I18nManager.allowRTL(rtl)
    I18nManager.forceRTL(rtl)
  }, [locale])

  const setChoice = useCallback((next: LocaleChoice) => {
    setChoiceState(next)
    void AsyncStorage.setItem(LOCALE_STORAGE_KEY, next).catch(() => {
      // Kept for this session even when it cannot be stored.
    })
  }, [])

  const restartPending = (localeInfo(locale).dir === 'rtl') !== I18nManager.isRTL

  const value = useMemo(
    () => ({ choice, locale, device, restartPending, setChoice }),
    [choice, locale, device, restartPending, setChoice],
  )
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}
