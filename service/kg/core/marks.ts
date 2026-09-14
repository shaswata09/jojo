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

/**
 * The last index on the line at which a single `_` or `*` could CLOSE a run.
 *
 * An opener with nothing to close it is not emphasis, and treating it as one
 * cost a real thing. A publications block carries the line that DEFINES its
 * footnote — `*Corresponding author.` — and that star satisfies every other
 * test: not inside a word, followed by a letter. So it opened a run that ran to
 * the end of the line, and `stripMarks` then removed the star, deleting the
 * definition from the text the person copied out. `*Equal contribution.` and a
 * `_Note:` prefix are the same shape.
 *
 * Computed ONCE per line rather than scanned per opener, and the difference is
 * not academic: scanning ahead from each candidate is quadratic, and a single
 * line of twenty thousand lone stars — which is model output, so not something
 * this layer gets to rule out — took four and a half seconds and froze the
 * preview that renders it. One pass, then every question is a comparison.
 *
 * A closer is judged by the rule the closer itself uses (preceded by a
 * non-space) so this agrees with the loop below rather than approximating it,
 * and a doubled marker is skipped because `**` and `__` belong to the
 * two-character branches.
 */
function lastClosers(line: string): { readonly '*': number; readonly _: number } {
  let star = -1
  let underscore = -1
  for (let j = 0; j < line.length; j += 1) {
    const ch = line[j]
    if (ch !== '*' && ch !== '_') continue
    if (line[j + 1] === ch) {
      j += 1
      continue
    }
    const before = line[j - 1]
    if (before === undefined || /\s/.test(before)) continue
    if (ch === '*') star = j
    else underscore = j
  }
  return { '*': star, _: underscore }
}

/** One line's inline marks. State starts closed on every line. */
export function parseInline(line: string): Run[] {
  const runs: Run[] = []
  /** See `lastClosers`: an opener past this has nothing to close it. */
  const closes = lastClosers(line)
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
       * toggle has to FLANK something — an opening one is followed by a WORD
       * character, a closing one merely by a non-space.
       *
       * The asymmetry is the point, and it was learned from a publications
       * line. `canOpen` used to be "followed by a non-space", which a star
       * before punctuation satisfies: the corresponding-author mark in
       * `Mitra, S.*, Rao, P. — OSDI 2024` opened an italic run that swallowed
       * the rest of the line, told the reader through `MARK_LEGEND` that the
       * model had emphasised their co-authors, and — because stripping marks
       * removes the star — dropped the authorship mark entirely from the text
       * the person copied out. `Nature*.` and a star before a slash are the
       * same shape. Requiring a letter or digit after an opener keeps `_reworded_` and
       * `*softer*` working and leaves a star that trails a word as text.
       *
       * A closer stays at "non-space" so a run that ends on punctuation still
       * closes — `_C++_`, `*Rust*,` — because tightening that side would strand
       * an open run and italicise the rest of the line, which is the failure
       * this is fixing rather than a second copy of it.
       *
       * What the opener gives up, said plainly: emphasis that STARTS on
       * punctuation no longer opens, so `*(2024)*` and `*"quoted"*` render as
       * text. That is a mark not shown, which costs a reader nothing they
       * cannot see — `stripMarks` keeps every character either way — and it is
       * the right side of the trade against a star that silently disappeared
       * from an authorship line.
       */
      const inWord = isWordChar(before) && isWordChar(after)
      const canOpen = isWordChar(after) && i < closes[one === '*' ? '*' : '_']
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
