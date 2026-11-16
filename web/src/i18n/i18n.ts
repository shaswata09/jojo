import i18next from 'i18next'
import type { Resource, ResourceLanguage } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { LOCALES, SOURCE_LOCALE } from '@jojo/service/core/locale'
import type { LocaleCode } from '@jojo/service/core/locale'

/**
 * The web app's translations.
 *
 * One JSON file per language and NAMESPACE under `locales/<code>/`, where a
 * namespace is an area of the app — `common`, `settings`, `dashboard`. English
 * is the source: it is written first, it is bundled, and every other language
 * falls back to it key by key, so a string not yet translated shows in English
 * rather than as a key.
 *
 * Every other language is a separate chunk, fetched the first time somebody
 * picks it. Ten languages bundled up front would make every visitor download
 * nine catalogs they will never read.
 *
 * `catalogs.test.ts` holds the catalogs to one shape: every key English has,
 * every language has, with the same `{{placeholders}}`.
 */

const english = import.meta.glob<{ default: ResourceLanguage[string] }>('./locales/en/*.json', {
  eager: true,
})
const others = import.meta.glob<{ default: ResourceLanguage[string] }>([
  './locales/*/*.json',
  '!./locales/en/*.json',
])

const namespaceOf = (path: string) =>
  path
    .split('/')
    .pop()
    ?.replace(/\.json$/, '') ?? 'common'
const localeOf = (path: string) => path.split('/').at(-2) ?? SOURCE_LOCALE

/** The namespaces English has, which is every namespace there is. */
export const NAMESPACES = Object.keys(english).map(namespaceOf)

const sourceCatalog: ResourceLanguage = Object.fromEntries(
  Object.entries(english).map(([path, mod]) => [namespaceOf(path), mod.default]),
)

const loaded = new Set<string>([SOURCE_LOCALE])

/** Fetches a language's catalogs, once. English is already here. */
export async function loadLocale(code: LocaleCode): Promise<void> {
  if (loaded.has(code)) return
  const entries = Object.entries(others).filter(([path]) => localeOf(path) === code)
  await Promise.all(
    entries.map(async ([path, load]) => {
      const mod = await load()
      i18next.addResourceBundle(code, namespaceOf(path), mod.default, true, true)
    }),
  )
  loaded.add(code)
}

const resources: Resource = { [SOURCE_LOCALE]: sourceCatalog }

void i18next.use(initReactI18next).init({
  resources,
  lng: SOURCE_LOCALE,
  fallbackLng: SOURCE_LOCALE,
  supportedLngs: LOCALES.map((l) => l.code),
  ns: NAMESPACES,
  defaultNS: 'common',
  // React escapes what it renders; escaping here too would show `&amp;`.
  interpolation: { escapeValue: false },
  // A missing key renders its English, never the key itself.
  returnNull: false,
  react: { useSuspense: false },
  initAsync: false,
})

export { i18next }
