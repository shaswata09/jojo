/**
 * The locale tag to hand `Intl`, and every `toLocale*String`, for the language
 * jojo is showing.
 *
 * Counts reach the screen through i18next interpolation, which prints a number
 * with `String()` — Latin digits whatever the language. Dates and grouped
 * numbers reach it through `Intl`, which uses the language's CLDR default
 * numbering system: Bengali digits for `bn`, Devanagari for `mr`. So one line
 * of Bengali read "মঙ্গলবার ১৭ নভেম্বর · 12টি আবেদন", and the context-window
 * hint printed "১,৩১,০৭২" beside a field holding 131072. Asking `Intl` for
 * Latin digits (`-u-nu-latn`) puts every number on a screen in one script.
 *
 * Every language gets the extension, not only the ones where it changes
 * anything: the default differs between ICU builds. Node's ICU says `latn` for
 * `ar`, Android's says `arab` — the phone's Arabic header read "١٧ نوفمبر"
 * over "12 طلب" — so a list of exceptions is a list that is right on one
 * engine. For a language whose default is already Latin the tag changes
 * nothing.
 *
 * A tag that already names a numbering system keeps it. No language gives
 * `undefined`, which `Intl` reads as the device's own language.
 */
export function intlLocale(language: string | undefined): string | undefined {
  if (!language) return undefined
  if (/-u(-[a-z0-9]{2,8})*-nu-/i.test(language)) return language
  if (/-u-/i.test(language)) return language.replace(/-u-/i, '-u-nu-latn-')
  const privateUse = language.search(/-x-/i)
  if (privateUse >= 0) {
    return `${language.slice(0, privateUse)}-u-nu-latn${language.slice(privateUse)}`
  }
  return `${language}-u-nu-latn`
}
