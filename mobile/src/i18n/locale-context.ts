import { createContext, useContext } from 'react'
import type { LocaleChoice, LocaleCode } from '@jojo/service/core/locale'

/** Where the person's language choice is kept on this phone. */
export const LOCALE_STORAGE_KEY = 'jojo/locale/v1'

export type LocaleState = {
  /** What the person picked: a language, or 'system' to follow the phone. */
  choice: LocaleChoice
  /** The language on screen now. */
  locale: LocaleCode
  /** What 'system' resolves to on this phone — named in the picker. */
  device: LocaleCode
  /** True when the layout direction changes only after a restart (into or out of Arabic). */
  restartPending: boolean
  setChoice: (choice: LocaleChoice) => void
}

export const LocaleContext = createContext<LocaleState | null>(null)

export function useLocale(): LocaleState {
  const value = useContext(LocaleContext)
  if (!value) throw new Error('useLocale must be used inside a LocaleProvider.')
  return value
}
