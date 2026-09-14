/**
 * What a drop actually contained, and what to say about it.
 *
 * A drop is the one way into this tool where the person cannot see what they
 * are about to hand over until it has landed — a file picker filters by type
 * and a drag does not, so a folder, a screenshot and a Word document all arrive
 * here looking exactly like a request. Silently keeping the PDFs and dropping
 * the rest is the wrong answer: somebody who drags three files and sees two
 * appear has to work out which one is missing and why.
 *
 * Pure, so the sorting and the sentence can both be pinned by tests.
 */

export type SortedDrop = {
  /** In the order they were dropped, capped at the limit. */
  readonly pdfs: readonly File[]
  /** Names of what was not a PDF at all. */
  readonly rejected: readonly string[]
  /** Names of PDFs past the limit — the panel only wanted so many. */
  readonly ignored: readonly string[]
}

/**
 * Whether the browser thinks this is a PDF.
 *
 * Both the media type and the extension, because either one alone is wrong
 * often enough to matter. A file dragged from some archive managers and from
 * Windows Explorer arrives with `type` empty, so the type test alone rejects a
 * real PDF; and a file named `contract.pdf.exe` passes an extension test while
 * being nothing of the kind. A dropped FOLDER also lands here — Chrome puts it
 * in `files` with an empty type and no extension — and fails both.
 */
export function looksLikePdf(file: File): boolean {
  if (file.type === 'application/pdf') return true
  if (file.type !== '') return false
  return /\.pdf$/i.test(file.name)
}

/**
 * Splits a drop into what can be used and what has to be explained.
 *
 * `limit` is how many the panel can take — the merge panel takes everything,
 * the other two work on one document at a time.
 */
export function sortDroppedPdfs(
  files: readonly File[],
  limit = Number.POSITIVE_INFINITY,
): SortedDrop {
  const pdfs: File[] = []
  const rejected: string[] = []
  const ignored: string[] = []
  for (const file of files) {
    if (!looksLikePdf(file)) rejected.push(file.name)
    else if (pdfs.length < limit) pdfs.push(file)
    else ignored.push(file.name)
  }
  return { pdfs, rejected, ignored }
}

/**
 * One sentence about what was not used, or null when everything was.
 *
 * Names the files while there are few enough to name. Past three the list is
 * longer than the line it goes in, and the count is the more useful fact.
 *
 * The sentence is NOT capitalised, and that is deliberate rather than sloppy:
 * it starts with a file name, and `notes.txt` capitalised is `Notes.txt`, which
 * is a different file from the one the person dropped.
 */
export function dropMessage(sorted: SortedDrop): string | null {
  const parts: string[] = []
  if (sorted.rejected.length > 0) {
    const many = sorted.rejected.length > 1
    parts.push(`${nameList(sorted.rejected)} ${many ? 'are not PDFs' : 'is not a PDF'}`)
  }
  if (sorted.ignored.length > 0) {
    const many = sorted.ignored.length > 1
    parts.push(
      `${nameList(sorted.ignored)} ${many ? 'were' : 'was'} left out — this works on one document at a time`,
    )
  }
  if (parts.length === 0) return null
  return `${parts.join(', and ')}.`
}

function nameList(names: readonly string[]): string {
  if (names.length === 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`
  return `${names.length} of the files`
}
