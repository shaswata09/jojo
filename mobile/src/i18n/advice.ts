import { useTranslation } from 'react-i18next'
import { adviceText } from '@jojo/service/core/advice-text'
import type { AdviceText } from '@jojo/service/core/advice-text'
import { i18next } from '@/i18n/i18n'

/**
 * Core's Statistics advice (`kg/core/advice-text.ts`) through the phone's
 * i18next: the ranked next steps and the search-health radar. Call it while
 * rendering, so the words follow the language picked in Settings.
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
