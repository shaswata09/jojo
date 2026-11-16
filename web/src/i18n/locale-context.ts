import { createContext, useContext } from 'react'
import type { LocaleChoice, LocaleCode } from '@jojo/service/core/locale'

/** Where the person's language choice is kept in this browser. */
export const LOCALE_STORAGE_KEY = 'jojo/locale/v1'

export type LocaleState = {
  /** What the person picked: a language, or 'system' to follow the browser. */
  choice: LocaleChoice
  /** The language on screen now. */
  locale: LocaleCode
  /** What 'system' resolves to in this browser — named in the picker. */
  device: LocaleCode
  setChoice: (choice: LocaleChoice) => void
}

export const LocaleContext = createContext<LocaleState | null>(null)

export function useLocale(): LocaleState {
  const value = useContext(LocaleContext)
  if (!value) throw new Error('useLocale must be used inside a LocaleProvider.')
  return value
}
