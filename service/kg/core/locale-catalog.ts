/**
 * L1 — whether a translation catalog says everything English says.
 *
 * Both apps keep their own strings (`web/src/i18n/locales`,
 * `mobile/src/i18n/locales`) and both hold them to the same rule, so the rule
 * lives here once rather than in two tests that could drift apart:
 *
 *   - every key English has, the language has, and no key English lacks — a
 *     missing one shows one English sentence in a translated page, an extra
 *     one is a string nothing renders;
 *   - every `{{placeholder}}` English uses, the translation uses — a different
 *     one prints a literal brace pair or drops the number the sentence was about;
 *   - nothing translated to an empty string.
 *
 * Plural keys are compared without their suffix, because languages pluralise
 * differently: Arabic has six forms, Japanese one, English two.
 */

export type Catalog = { readonly [key: string]: string | Catalog }

/** A namespace's strings by dotted path: `language.label`. */
export function flattenCatalog(tree: Catalog, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.set(path, value)
    else for (const [k, v] of flattenCatalog(value, path)) out.set(k, v)
  }
  return out
}

const PLURAL = /_(zero|one|two|few|many|other)$/
const baseKey = (key: string) => key.replace(PLURAL, '')

export const placeholdersOf = (text: string): string[] =>
  [...text.matchAll(/\{\{\s*(\w+)[^}]*\}\}/g)].map((m) => m[1] ?? '').sort()

/** Every way `translated` differs from `english`, as sentences. Empty means it matches. */
export function catalogProblems(english: Catalog, translated: Catalog): string[] {
  const source = flattenCatalog(english)
  const theirs = flattenCatalog(translated)
  const problems: string[] = []
  const sourceBases = new Set([...source.keys()].map(baseKey))
  const theirBases = new Set([...theirs.keys()].map(baseKey))
  for (const key of sourceBases) if (!theirBases.has(key)) problems.push(`missing ${key}`)
  for (const key of theirBases) if (!sourceBases.has(key)) problems.push(`extra ${key}`)
  for (const [key, text] of theirs) {
    const englishText = source.get(key) ?? source.get(`${baseKey(key)}_other`) ?? source.get(baseKey(key))
    if (englishText === undefined) continue
    if (text.trim() === '') problems.push(`empty ${key}`)
    const want = placeholdersOf(englishText).join(',')
    const got = placeholdersOf(text).join(',')
    // A plural form may say the number English's form leaves out: English
    // "one" is only ever 1 ("one change"), but Russian's covers 21 and 31 too,
    // Hindi's and Bengali's cover 0, so their "one" needs `{{count}}`.
    const withCount = placeholdersOf(`${englishText}{{count}}`).join(',')
    const countAdded = PLURAL.test(key) && !want.split(',').includes('count') && got === withCount
    if (want !== got && !countAdded)
      problems.push(`placeholders ${key}: {${got}} where English has {${want}}`)
  }
  return problems
}
