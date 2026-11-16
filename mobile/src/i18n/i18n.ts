import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { LOCALES, SOURCE_LOCALE } from '@jojo/service/core/locale'
import { RESOURCES } from '@/i18n/resources'

/**
 * The phone's translations.
 *
 * Every language is bundled — an installed app has no CDN to fetch a catalog
 * from, and they are small beside the 3D scene. English is the source and the
 * fallback, key by key, exactly as on the web (`web/src/i18n/i18n.ts`).
 *
 * The catalogs are listed in `resources.ts`, which `scripts/i18n-index.mjs`
 * writes, because Metro cannot glob a folder.
 */
void i18next.use(initReactI18next).init({
  resources: RESOURCES,
  lng: SOURCE_LOCALE,
  fallbackLng: SOURCE_LOCALE,
  supportedLngs: LOCALES.map((l) => l.code),
  ns: Object.keys(RESOURCES[SOURCE_LOCALE]),
  defaultNS: 'common',
  // React Native renders text, not HTML: there is nothing to escape.
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
  initAsync: false,
})

export { i18next }
