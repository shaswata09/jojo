/**
 * What the tool calls the document it just made.
 *
 * A name is not cosmetic here: every result is saved as a NEW vault file beside
 * the original, so the name is the only thing distinguishing the copy with the
 * highlights from the copy without them. Getting it wrong produces two rows
 * reading `cv.pdf` and no way to tell which is which.
 *
 * ## In the reader's language
 *
 * The words a suggestion is built from — "annotated", "3 pages", "+ 2 more",
 * "merged" — are the reader's, from `vault:pdf.names` (review 3, i18n-10).
 * They prefill an editable field and become the saved document's name in the
 * Vault, so a Japanese reader was handed `CV (annotated).pdf`. Every function
 * takes its words as a parameter, defaulting to the catalog's, so the naming
 * rules stay pure and are tested in English.
 */

import { i18next } from '@/i18n/i18n'

/** The words a suggested name is made of. */
export type NameWords = {
  /** The suffix for a marked-up copy: `cv (annotated).pdf`. */
  readonly annotated: string
  /** The suffix for a copy of some of the pages: `cv (3 pages).pdf`. */
  readonly pages: (count: number) => string
  /** The name for a page selection with no source name. */
  readonly pagesFile: string
  /** The name for a merge of nothing nameable. */
  readonly merged: string
  /** The tail of a merge of many: `a + b + 2 more.pdf`. */
  readonly more: (count: number) => string
}

/** The words in the language jojo is showing. */
export const nameWords = (): NameWords => ({
  annotated: i18next.t('vault:pdf.names.annotated'),
  pages: (count) => i18next.t('vault:pdf.names.pages', { count }),
  pagesFile: i18next.t('vault:pdf.names.pagesFile'),
  merged: i18next.t('vault:pdf.names.merged'),
  more: (count) => i18next.t('vault:pdf.names.more', { count }),
})

/**
 * Everything before the extension, and the extension.
 *
 * Only a trailing dot followed by a few letters or digits counts. Taking the
 * last dot in the name instead loses text: `v1.2 report` splits at the `.2`,
 * and every function here rebuilds the name from the stem, so the document
 * comes out called `v1.pdf`. A leading dot is a hidden file rather than an
 * extension, so `.pdf` has stem `.pdf` and no extension at all.
 */
function split(name: string): { stem: string; extension: string } {
  const trimmed = name.trim()
  const match = /^(.+)(\.[A-Za-z0-9]{1,5})$/.exec(trimmed)
  if (!match) return { stem: trimmed, extension: '' }
  return { stem: match[1] ?? trimmed, extension: match[2] ?? '' }
}

const asPdf = (stem: string) => `${stem || 'document'}.pdf`

/**
 * `cv.pdf` + 'annotated' -> `cv (annotated).pdf`, and again -> `cv (annotated) 2.pdf`.
 *
 * The counter exists because the obvious implementation produces
 * `cv (annotated) (annotated) (annotated).pdf` for anyone who marks up a
 * document, saves, and marks it up again — which is the normal way to use this
 * tool, not an edge case.
 */
export function derivedName(name: string, suffix: string): string {
  const { stem } = split(name)
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const already = new RegExp(`\\s*\\(${escaped}\\)(?:\\s+(\\d+))?$`)
  const match = already.exec(stem)
  if (!match) return asPdf(`${stem} (${suffix})`.trim())
  const next = Number(match[1] ?? '1') + 1
  return asPdf(`${stem.slice(0, match.index)} (${suffix}) ${next}`.trim())
}

/**
 * The name for a merge: `a + b.pdf`, or `a + 3 more.pdf` past three sources.
 *
 * Named after what went in, because that is the only thing a person can
 * recognise it by afterwards. Capped at three because four stems is already
 * longer than the column it renders in, and past that the count is the more
 * useful fact anyway.
 */
export function mergedName(
  names: readonly string[],
  max = 3,
  words: Pick<NameWords, 'merged' | 'more'> = nameWords(),
): string {
  const stems = names.map((name) => split(name).stem.trim()).filter((stem) => stem !== '')
  if (stems.length === 0) return asPdf(words.merged)
  if (stems.length === 1) return asPdf(stems[0] ?? words.merged)
  if (stems.length <= max) return asPdf(stems.join(' + '))
  const shown = stems.slice(0, max - 1)
  const rest = stems.length - shown.length
  return asPdf(`${shown.join(' + ')} + ${words.more(rest)}`)
}

/**
 * The suggestion for a marked-up copy of `name`, or for one with no source.
 * What `PdfAnnotatePanel` offers.
 */
export function annotatedName(
  name: string | null | undefined,
  words: Pick<NameWords, 'annotated'> = nameWords(),
): string {
  return name ? derivedName(name, words.annotated) : asPdf(words.annotated)
}

/**
 * The suggestion for `count` pages taken from `name`, or for a selection with
 * no source. What `PdfPagesPanel` offers — "1 pages" was the English it had.
 */
export function pagesName(
  name: string | null | undefined,
  count: number,
  words: Pick<NameWords, 'pages' | 'pagesFile'> = nameWords(),
): string {
  return name ? derivedName(name, words.pages(count)) : asPdf(words.pagesFile)
}

/**
 * Makes a name safe to write to disk, without emptying it.
 *
 * The browser's downloader will take almost anything and quietly mangle the
 * rest, and a vault row shows the name verbatim — so a name carrying a slash
 * reads as a path that does not exist. Folds the characters no common
 * filesystem accepts and collapses what is left, keeping the extension.
 */
export function safeName(name: string): string {
  const { stem, extension } = split(name)
  const cleaned = stem
    // eslint-disable-next-line no-control-regex -- the C0 range is exactly what has to go.
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows refuses a name ending in a dot or a space.
    .replace(/[. ]+$/, '')
  const stub = cleaned === '' ? 'document' : cleaned.slice(0, 120)
  return `${stub}${extension.toLowerCase() === '.pdf' ? extension : '.pdf'}`
}
