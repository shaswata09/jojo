/**
 * What the tool calls the document it just made.
 *
 * A name is not cosmetic here: every result is saved as a NEW vault file beside
 * the original, so the name is the only thing distinguishing the copy with the
 * highlights from the copy without them. Getting it wrong produces two rows
 * reading `cv.pdf` and no way to tell which is which.
 */

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
export function mergedName(names: readonly string[], max = 3): string {
  const stems = names.map((name) => split(name).stem.trim()).filter((stem) => stem !== '')
  if (stems.length === 0) return asPdf('merged')
  if (stems.length === 1) return asPdf(stems[0] ?? 'merged')
  if (stems.length <= max) return asPdf(stems.join(' + '))
  const shown = stems.slice(0, max - 1)
  const rest = stems.length - shown.length
  return asPdf(`${shown.join(' + ')} + ${rest} more`)
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
