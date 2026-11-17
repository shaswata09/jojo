import { i18next } from '@/i18n/i18n'

/**
 * A label table that reads in the language jojo is showing NOW.
 *
 * A module-scope `{ deadline: 'Deadline' }` is evaluated once, at import, and
 * stays in English whatever the person picks afterwards. This keeps the shape
 * callers already index — `LABEL[key]` — but each read is a getter that asks
 * i18next at that moment. A component that re-renders on a language change
 * (anything calling `useTranslation`) therefore shows the new words.
 */
export function localised<K extends string>(keys: Readonly<Record<K, string>>): Record<K, string> {
  const out = {} as Record<K, string>
  for (const k of Object.keys(keys) as K[]) {
    Object.defineProperty(out, k, { enumerable: true, get: () => i18next.t(keys[k]) })
  }
  return out
}
