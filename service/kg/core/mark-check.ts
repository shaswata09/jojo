/**
 * Checking a tailored document's marks against the document it was made from. L1 core.
 *
 * A model that tailors a CV marks what it changed (`core/marks.ts`), and the
 * card's legend tells the person what each mark means: bold is "new or
 * rewritten for this posting", underline is "moved up". Those words are a
 * promise, and the model's marks alone do not keep it. Measured on 2026-11-19
 * with MiniMax-M2.1, six runs on one CV and one posting:
 *
 *   - lines bolded as "new" that were the original, word for word
 *     ("Ph.D., Computer Science", a publication, a teaching line);
 *   - a run that bolded nearly every line, so the marks said nothing;
 *   - a run with no marks at all over a document that had changed;
 *   - and, the dangerous direction, changed words left unmarked — which is
 *     exactly where an invented claim would hide from the person reading
 *     "only the bold".
 *
 * So the marks are not taken from the model; they are MEASURED. The reply is
 * compared with the source, and what is marked is what differs:
 *
 *   - Words that are not in the source are marked — bold, or italic where the
 *     model itself called them reworded. Every word the person did not write is
 *     therefore visible, whether or not the model admitted to it.
 *   - A line that is in the source word for word carries no bold or italic,
 *     whatever the model wrote around it.
 *   - Such a line that now comes BEFORE something it used to follow is
 *     underlined: that is what "moved up" can be checked to mean. "Given more
 *     weight" with the words unchanged and the place unchanged is not a change
 *     anybody can see, so it is not marked.
 *
 * ## How "in the source" is decided
 *
 * Two levels, because CVs are read out of PDFs and the line breaks are the
 * PDF's, not the person's:
 *
 *   1. A whole line is "unchanged" when its words appear consecutively in the
 *      source, ignoring line breaks, case, and the punctuation at a word's
 *      edges. That is what lets a paragraph the reader wrapped at forty
 *      columns come back as one line and still read as untouched.
 *      A line whose LETTERS are the source's with only the spacing different
 *      is unchanged too: PDF readers letter-space headings unevenly
 *      ("P U B L I C AT I O N S") and a model that re-spaces one has changed
 *      nothing a reader can see.
 *   2. Inside a line that is not unchanged, a word is "the person's own" when
 *      it sits in some run of three consecutive words that the source also has
 *      consecutively. Three, because one or two common words ("of the",
 *      "machine learning") occur in any CV and would let a new sentence pass
 *      as old; a run of three is the shortest that says "copied from here".
 *      A line too short for three words is judged whole.
 *
 * What it cannot see: something DELETED. A dropped line leaves nothing in the
 * reply to mark; `readTailored` says when the reply is much shorter instead.
 *
 * Headings are left exactly as the model wrote them: the source's own headings
 * often arrive letter-spaced out of a PDF ("E D U C A T I O N"), and a heading
 * is structure the person checks by eye, not a claim.
 */

import { parseMarks } from './marks'
import type { Run } from './marks'

type Mark = 'plain' | 'bold' | 'italic' | 'underline'

/** What changed in the marks, so the card can say so. */
export type MarkCheck = {
  /** The body with its marks redrawn from the comparison. */
  readonly body: string
  /** Passages the model marked as changed that are the source word for word. */
  readonly unmarked: number
  /** Changed passages the model left unmarked, now marked. */
  readonly marked: number
  /** Unchanged lines now underlined because they moved up. */
  readonly moved: number
}

/** Below this many words a line is judged whole rather than by runs of three. */
const SHINGLE = 3

/**
 * A word as compared: case folded, the typographic variants a PDF reader and a
 * model disagree on made the same, and the punctuation at its edges dropped —
 * `2025.` and `2025,` are one word, `Ph.D.` stays `ph.d`. Empty for a token that
 * is only punctuation (a bullet, a middle dot, a dash), which never decides
 * anything on its own.
 */
export function wordKey(token: string): string {
  return token
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

/** Letters and digits only, folded as `wordKey` folds them: spacing and punctuation gone. */
const compact = (text: string): string => wordKey(text.replace(/[^\p{L}\p{N}]+/gu, ''))

const keysOf = (text: string): string[] =>
  text
    .split(/\s+/)
    .map(wordKey)
    .filter((k) => k.length > 0)

type Token = {
  /** The token as written, or a run of whitespace. */
  readonly text: string
  readonly space: boolean
  readonly key: string
  /** What the model marked it as. */
  readonly was: Mark
  /** What it is marked as after the check. */
  now: Mark
}

const markOf = (run: Run): Mark =>
  run.bold ? 'bold' : run.italic ? 'italic' : run.underline ? 'underline' : 'plain'

function tokensOf(runs: readonly Run[]): Token[] {
  const out: Token[] = []
  for (const run of runs) {
    const was = markOf(run)
    for (const piece of run.text.split(/(\s+)/)) {
      if (piece === '') continue
      const space = /^\s+$/.test(piece)
      out.push({ text: piece, space, key: space ? '' : wordKey(piece), was, now: 'plain' })
    }
  }
  return out
}

/** Open and close spellings, matching what `parseInline` reads back. */
const OPEN: Readonly<Record<Exclude<Mark, 'plain'>, string>> = {
  bold: '**',
  italic: '_',
  underline: '__',
}

/**
 * One line's tokens back into text, each run of one mark wrapped once.
 *
 * Whitespace between two tokens of the same mark goes inside the run, and at a
 * boundary goes outside, so `**a b** c` and never `**a **b c`. A run's
 * leading and trailing punctuation is written outside it — `(**2024**)`,
 * `**for this role**.` — which is how a person marks a phrase, and which a
 * single `_` needs anyway: it only opens before a letter or digit
 * (`parseInline`), so an opener before punctuation would read back as text.
 */
function render(tokens: readonly Token[]): string {
  let out = ''
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t === undefined) break
    if (t.space || t.now === 'plain') {
      out += t.text
      i += 1
      continue
    }
    const mark = t.now
    let j = i
    let end = i
    while (j < tokens.length) {
      const u = tokens[j]
      if (u === undefined) break
      if (!u.space && u.now !== mark) break
      if (!u.space) end = j
      j += 1
    }
    let inner = tokens
      .slice(i, end + 1)
      .map((u) => u.text)
      .join('')
    const lead = /^[^\p{L}\p{N}]*/u.exec(inner)?.[0] ?? ''
    inner = inner.slice(lead.length)
    const trail = /[^\p{L}\p{N}]*$/u.exec(inner)?.[0] ?? ''
    inner = inner.slice(0, inner.length - trail.length)
    out += inner === '' ? lead + trail : `${lead}${OPEN[mark]}${inner}${OPEN[mark]}${trail}`
    i = end + 1
  }
  return out
}

/** Every run of `n` consecutive keys in the source, as one string each. */
function shinglesOf(keys: readonly string[], n: number): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i + n <= keys.length; i += 1) set.add(keys.slice(i, i + n).join(' '))
  return set
}

/**
 * The marks on `body`, redrawn from a comparison with `source`.
 *
 * `source` is the document as the model was shown it (flattened, marks
 * stripped). Never throws; a body with no lines comes back as it was.
 */
export function checkMarks(body: string, source: string): MarkCheck {
  const sourceKeys = keysOf(source)
  // Padded with spaces so a match is always whole words.
  const joined = ` ${sourceKeys.join(' ')} `
  const shingles = shinglesOf(sourceKeys, SHINGLE)
  const sourceCompact = compact(source)

  type Line = {
    /** `#`s for a heading; '' for a line kept exactly as written; null for a line that is checked. */
    readonly heading: string | null
    readonly tokens: Token[]
    /** Position of the line in `joined` when it is the source word for word. */
    at: number | null
    /** The source's letters with different spacing: unchanged, but not placed. */
    respaced: boolean
  }
  const lines: (Line | null)[] = parseMarks(body).map((block) => {
    if (block.kind === 'blank') return null
    const tokens = tokensOf(block.runs)
    // A sections reply ends "Unchanged: Education, Teaching" — the model's
    // note about the document, not a passage of it.
    const note = block.kind === 'line' && /^\s*unchanged:/i.test(tokens.map((t) => t.text).join(''))
    const heading = block.kind === 'heading' ? '#'.repeat(block.level) : note ? '' : null
    return { heading, tokens, at: null, respaced: false }
  })

  // ── Level 1: whole lines that are the source, and where. ──
  // Searching forward from the last match first keeps a phrase that occurs
  // twice ("University of Texas at Dallas") matched to the occurrence in
  // order, so repetition is not mistaken for a move.
  let cursor = 0
  for (const line of lines) {
    if (line === null || line.heading !== null) continue
    const keys = line.tokens.filter((t) => t.key !== '').map((t) => t.key)
    if (keys.length === 0) continue
    const needle = ` ${keys.join(' ')} `
    let at = joined.indexOf(needle, cursor)
    if (at < 0) at = joined.indexOf(needle)
    if (at >= 0) {
      line.at = at
      cursor = at + needle.length - 1
    } else {
      // Six letters at least, so a stray "2024" or "AI" is not "found" by spelling.
      const letters = compact(line.tokens.map((t) => t.text).join(''))
      if (letters.length >= 6 && sourceCompact.includes(letters)) line.respaced = true
    }
  }

  // ── Moved up: an unchanged line that now precedes one it used to follow. ──
  const placed = lines.filter((l): l is Line => l !== null && l.at !== null)
  let laterMin = Number.POSITIVE_INFINITY
  const movedUp = new Set<Line>()
  for (let i = placed.length - 1; i >= 0; i -= 1) {
    const line = placed[i]
    if (line === undefined || line.at === null) continue
    // A line counts as moved when it is long enough to mean something on its
    // own; a bare year or a one-word line matches anywhere.
    const words = line.tokens.filter((t) => t.key !== '').length
    if (line.at > laterMin && words >= SHINGLE) movedUp.add(line)
    laterMin = Math.min(laterMin, line.at)
  }

  // ── Level 2: inside every other line, which words are the person's own. ──
  for (const line of lines) {
    if (line === null || line.heading !== null) continue
    const words = line.tokens.filter((t) => !t.space && t.key !== '')
    if (line.at !== null || line.respaced) {
      const mark: Mark = movedUp.has(line) ? 'underline' : 'plain'
      for (const t of line.tokens) t.now = mark
      continue
    }
    if (words.length === 0) continue
    const own = new Set<Token>()
    if (words.length < SHINGLE) {
      // Too short for a run of three; it is changed (it was not found whole above).
    } else {
      for (let i = 0; i + SHINGLE <= words.length; i += 1) {
        const run = words.slice(i, i + SHINGLE)
        if (shingles.has(run.map((t) => t.key).join(' '))) for (const t of run) own.add(t)
      }
    }
    // A changed word is italic when the model called it reworded, else bold.
    for (const t of words) {
      if (own.has(t)) t.now = 'plain'
      else t.now = t.was === 'italic' ? 'italic' : 'bold'
    }
    // Bridge a gap of ONE word of the person's own between two changed words
    // ("**built** the **harness**" reads as noise; it is one rewritten phrase).
    for (let i = 1; i + 1 < words.length; i += 1) {
      const [a, b, c] = [words[i - 1], words[i], words[i + 1]]
      if (a && b && c && b.now === 'plain' && a.now !== 'plain' && c.now !== 'plain') {
        b.now = a.now === c.now ? a.now : 'bold'
      }
    }
    // Punctuation-only tokens take the mark of the words on both sides, or none.
    line.tokens.forEach((t, i) => {
      if (t.space || t.key !== '') return
      const before = line.tokens.slice(0, i).reverse().find((u) => u.key !== '')
      const after = line.tokens.slice(i + 1).find((u) => u.key !== '')
      t.now = before && after && before.now === after.now ? before.now : 'plain'
    })
  }

  // ── Count what the check changed, in passages rather than words. ──
  let unmarked = 0
  let marked = 0
  let moved = 0
  for (const line of lines) {
    if (line === null || line.heading !== null) continue
    let prevWas: Mark = 'plain'
    let prevNow: Mark = 'plain'
    for (const t of line.tokens) {
      if (t.space || t.key === '') continue
      const wasChange = t.was === 'bold' || t.was === 'italic'
      const isChange = t.now === 'bold' || t.now === 'italic'
      if (wasChange && !isChange && (prevWas !== t.was || prevNow !== t.now)) unmarked += 1
      if (!wasChange && isChange && (prevWas !== t.was || prevNow !== t.now)) marked += 1
      prevWas = t.was
      prevNow = t.now
    }
    if (movedUp.has(line)) moved += 1
  }

  const out = parseMarks(body).map((block, i) => {
    const line = lines[i]
    if (block.kind === 'blank' || line === null || line === undefined) return ''
    if (line.heading !== null) {
      // Headings and the closing note as written, the model's marks put back.
      return line.heading === '' ? renderAs(line.tokens) : `${line.heading} ${renderAs(line.tokens)}`
    }
    return render(line.tokens)
  })
  return { body: out.join('\n'), unmarked, marked, moved }
}

/** A heading's tokens with the model's own marks, unchanged by the check. */
function renderAs(tokens: readonly Token[]): string {
  return render(tokens.map((t) => ({ ...t, now: t.was })))
}
