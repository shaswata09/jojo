import { useTranslation } from 'react-i18next'
import { domainText } from '@jojo/service/core/domain-text'
import type { DomainText } from '@jojo/service/core/domain-text'
import { i18next } from '@/i18n/i18n'

/**
 * Core's domain words (`kg/core/domain-text.ts`) through the phone's i18next:
 * stage names, timeline kinds, months, and the backup and handover sentences.
 * Call it while rendering, so the words follow the language picked in
 * Settings.
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
