import { useTranslation } from 'react-i18next'
import { adviceText } from '@jojo/service/core/advice-text'
import type { AdviceText } from '@jojo/service/core/advice-text'
import { i18next } from '@/i18n/i18n'

/**
 * The Statistics advice — the ranked next steps and the search-health radar —
 * in the language on screen. The logic and the English are core's
 * (`kg/core/advice-text.ts`); this is the web's translator plugged into it.
 *
 * Read at render, never at module scope: each call asks i18next for the
 * current language, so a component that re-renders on a language change shows
 * the new words.
 */
export const advice = adviceText((key, options) => i18next.t(key, options))

/**
 * `advice`, for a component: subscribes it to language changes, so a switch in
 * Settings re-renders it with the new words.
 */
export function useAdvice(): AdviceText {
  useTranslation('advice')
  return advice
}
