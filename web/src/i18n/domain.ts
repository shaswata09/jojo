import { useTranslation } from 'react-i18next'
import { domainText } from '@jojo/service/core/domain-text'
import type { DomainText } from '@jojo/service/core/domain-text'
import { i18next } from '@/i18n/i18n'

/**
 * The model's own words — stages, timeline kinds, months, the backup and
 * handover sentences — in the language on screen. The logic and the English
 * are core's (`kg/core/domain-text.ts`); this is the web's translator plugged
 * into it.
 *
 * Read at render, never at module scope: each call asks i18next for the
 * current language, so a component that re-renders on a language change shows
 * the new words.
 */
export const domain = domainText((key, options) => i18next.t(key, options))

/**
 * `domain`, for a component: subscribes it to language changes, so a switch in
 * Settings re-renders it with the new words. Code outside a component (a
 * builder a component calls) uses `domain` directly; the component that calls
 * it is what has to re-render.
 */
export function useDomain(): DomainText {
  useTranslation('domain')
  return domain
}
