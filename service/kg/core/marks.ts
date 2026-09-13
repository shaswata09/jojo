/**
 * The four marks a tailored snippet may carry, and how to read them. L1 core.
 *
 * A model that tailors somebody's CV for one posting has to be able to show
 * WHAT it changed, or the person is left diffing two pages by eye. Every field
 * in this app stores plain text — `rich-text.ts` on the web flattens the
 * editor's HTML on save, and nothing anywhere renders markup — so the marks
 * live in the text itself, in four spellings small enough to survive a copy
 * and obvious enough to read raw:
 *
 *   **new or rewritten for this posting**
 *   _reworded or softened_
 *   __moved up, or given more weight__
 *   ## a section heading
 *
 * ## Why not Markdown
 *
 * Because it is not Markdown, and saying so matters. A Markdown renderer would
 * turn a stray `#` into a title, a `-` into a bullet, and `<b>` into bold, and
 * the body of a snippet is somebody's own prose pasted from a CV — full of
 * underscores in email addresses, asterisks in footnotes and hashes in course
 * codes. This reads exactly four spellings, only in a body whose record says a
 * model wrote it (`SnippetProps.tailored`), and leaves every other character
 * alone. A hand-written snippet is never parsed at all.
 *
 * ## The one guess it makes
 *
 * A single `_` or `*` is an italic toggle only at a word edge: `snake_case` and
 * `CS*101` are text, `_reworded_` is a mark. The double spellings have no such
 * ambiguity and are read anywhere. An emphasis left open at the end of a line
 * closes there — a model that forgets a closing `**` should cost one line of
 * bold, not the rest of the document.
 */

export type Run = {
  readonly text: string
  readonly bold: boolean
  readonly italic: boolean
  readonly underline: boolean
}

export type Block =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3; readonly runs: readonly Run[] }
  | { readonly kind: 'line'; readonly runs: readonly Run[] }
  | { readonly kind: 'blank' }

/** What each mark means, in the words the card puts under the legend. */
export const MARK_LEGEND = {
  bold: 'new or rewritten for this posting',
  italic: 'reworded',
  underline: 'moved up or given more weight',
} as const

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch)

/** One line's inline marks. State starts closed on every line. */
export function parseInline(line: string): Run[] {
  const runs: Run[] = []
  let bold = false
  let italic = false
  let underline = false
  let text = ''

  const flush = () => {
    if (text.length === 0) return
    runs.push({ text, bold, italic, underline })
    text = ''
  }

  let i = 0
  while (i < line.length) {
    const two = line.slice(i, i + 2)
    if (two === '**') {
      flush()
      bold = !bold
      i += 2
      continue
    }
    if (two === '__') {
      flush()
      underline = !underline
      i += 2
      continue
    }
    const one = line[i]
    if (one === '_' || one === '*') {
      const before = line[i - 1]
      const after = line[i + 1]
      /*
       * Inside a word on both sides it is text: `snake_case`, `CS*101`. And a
       * toggle has to FLANK something — an opening one is followed by a
       * non-space, a closing one is preceded by one. That is what keeps a
       * Markdown bullet (`* item`), a footnote star (`Nature*`) and a lone
       * asterisk from opening an italic run that swallows the rest of the line
       * and then loses the star when the marks are stripped.
       */
      const inWord = isWordChar(before) && isWordChar(after)
      const canOpen = after !== undefined && !/\s/.test(after)
      const canClose = before !== undefined && !/\s/.test(before)
      if (!inWord && (italic ? canClose : canOpen)) {
        flush()
        italic = !italic
        i += 1
        continue
      }
    }
    text += one ?? ''
    i += 1
  }
  flush()
  return runs
}

const HEADING = /^(#{1,3})\s+(.*)$/

/** The whole body, block by block. Never throws; any text is some list of blocks. */
export function parseMarks(body: string): Block[] {
  return body.split(/\r?\n/).map((raw): Block => {
    const line = raw.replace(/\s+$/, '')
    if (line.trim() === '') return { kind: 'blank' }
    const heading = HEADING.exec(line)
    if (heading) {
      // `#{1,3}` in the pattern is the bound; the cast only says so.
      const level = (heading[1]?.length ?? 1) as 1 | 2 | 3
      return { kind: 'heading', level, runs: parseInline(heading[2] ?? '') }
    }
    return { kind: 'line', runs: parseInline(line) }
  })
}

/** Whether any run in the body carries a mark. What "nothing was marked" means. */
export function hasMarks(body: string): boolean {
  return parseMarks(body).some(
    (b) => b.kind !== 'blank' && b.runs.some((r) => r.bold || r.italic || r.underline),
  )
}

/**
 * The body with every mark removed — what Copy puts on the clipboard.
 *
 * Headings keep their text and lose the hashes: a pasted CV section should read
 * "Publications", not "## Publications". Blank lines survive, so the shape of
 * the document does.
 */
export function stripMarks(body: string): string {
  return parseMarks(body)
    .map((b) => (b.kind === 'blank' ? '' : b.runs.map((r) => r.text).join('')))
    .join('\n')
}
