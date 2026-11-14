/**
 * L3 — a converted document, cut into passes a model can answer completely.
 *
 * Part of `read-cv.ts`, which re-exports everything here; see its header for
 * why the document is read in sections at all. This file only decides where
 * the cuts go: the document's own headings first, then a budget per pass.
 *
 * No network and no model. Pure text in, sections and passes out.
 */

/**
 * How much of a document is sent.
 *
 * A CV is a few pages; an academic one can be forty. The tail of a long CV is
 * usually the publication list, which is exactly the part worth having — so
 * this is generous where `POSTING_BUDGET` is not, and the truncation notice
 * below tells the model it is reading a fragment rather than letting it
 * conclude the person has no publications.
 */
export const CV_BUDGET = 24_000

/* ------------------------------- sectioning ------------------------------- */

/** One part of the document, under the heading the document gave it. */
export type CvSection = { readonly heading: string; readonly text: string }

/**
 * What counts as a heading in a converted CV.
 *
 * Three shapes, because the reader hands back whatever the original used and
 * the three are not interchangeable. A Word CV with styled headings converts to
 * `## Education`; one typed with bold runs converts to `**Education**`; one
 * from LaTeX or a plain-text export arrives as a short line in capitals.
 *
 * The capitals rule is deliberately narrow — under 60 characters, no full stop,
 * at least one letter — because a CV also contains lines like
 * "IEEE TRANSACTIONS ON SOFTWARE ENGINEERING", and treating a journal name as a
 * section heading would split a publication list into forty sections of one
 * line each.
 */
const HEADING = /^(?:#{1,6}\s+(?<hash>.+?)\s*|\*\*(?<bold>[^*]{1,60})\*\*\s*|(?<caps>[A-Z][A-Z0-9 &/,'()-]{2,59}))$/

/** Anything before the first heading: a name, contact details, a summary. */
const PREAMBLE = 'Top of the document'

/**
 * The document, split on its own headings.
 *
 * Returns one section when there are no headings at all, which is a real case —
 * a one-page CV exported to plain text often has none — and the caller then
 * behaves exactly as the single-pass version did.
 *
 * ## Nothing the document says may leave this function
 *
 * It used to. A heading line was consumed as a label and never written into any
 * body, so a heading whose section turned out to be empty took its own text with
 * it — and two heading-shaped lines in a row make each other's sections empty.
 * Measured on CV-shaped markdown (2026-08): the six lines
 *
 *   AWARDS / BEST PAPER AWARD, OSDI 2019 / BEST DEMO AWARD, SOSP 2020
 *   ## Education / **PhD, Computer Science** / MIT, 2016-2021
 *
 * produced exactly one section — the preamble — and all six vanished before the
 * model saw them. Every line there is heading-SHAPED (the capitals rule matches
 * "MIT, 2016-2021" as readily as "AWARDS"), so each one flushed an empty body
 * and dropped the label before it.
 *
 * Two rules now stand between a line and that fate, and neither invents
 * structure the document does not have:
 *
 *   - A bold or capitals line arriving while the run of headings is still open
 *     — nothing but blanks since the last heading — is CONTENT, not a heading.
 *     Which of "EDUCATION" and "PhD, Computer Science" is the real heading is
 *     not knowable, so the first wins the label and the rest become its text.
 *     That is the safe way round: the first line of such a block is the one
 *     least likely to be an entry worth extracting.
 *   - A `#` heading always opens a section — a converter writes one because the
 *     original was styled as a heading — but if the section under it turns out
 *     to be empty, its text is carried into the next section's body rather than
 *     dropped.
 *
 * What is still dropped, deliberately: a lone heading with nothing under it at
 * the very end of the document. There is no section to carry it into, and a
 * heading word with no entries beneath it states no fact about the person.
 */
export function cvSections(markdown: string): CvSection[] {
  const out: CvSection[] = []
  let heading = PREAMBLE
  let body: string[] = []
  /** Headings whose sections were empty, waiting for a body to belong to. */
  let carried: string[] = []
  /** True from a heading line until the first line of real content after it. */
  let opening = false

  const flush = () => {
    const text = [...carried, ...body].join('\n').trim()
    if (text !== '') {
      out.push({ heading, text })
      carried = []
    } else if (heading !== PREAMBLE) {
      // A heading the reader mis-detected, or a section the person left empty.
      // Either way it names nothing — but it is still a line of the document,
      // so it waits for the next section rather than being deleted here.
      carried.push(heading)
    }
    body = []
  }

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    const found = HEADING.exec(trimmed)
    const hash = found?.groups?.['hash']
    const next = (hash ?? found?.groups?.['bold'] ?? found?.groups?.['caps'])?.trim()
    if (next !== undefined && next !== '') {
      if (opening && hash === undefined) {
        // Still inside the same heading block: this is the subtitle, the degree
        // line under "EDUCATION", or the second of three award lines in capitals.
        body.push(next)
        continue
      }
      flush()
      heading = next
      opening = true
      continue
    }
    body.push(line)
    // Blank lines do not close the block. A converted CV puts one between every
    // pair of lines, so closing on them would leave the two-line heading block —
    // the shape this whole guard exists for — exactly as broken as it was.
    if (trimmed !== '') opening = false
  }
  flush()

  /*
   * No fallback for "no headings found", and there was one. It was dead: a
   * document without headings never enters the loop's heading branch, so the
   * final `flush` pushes the whole thing under `PREAMBLE` and `out` is already
   * a one-section list. The fallback could only fire on a document that is
   * entirely whitespace — where it built a section with empty text, which is
   * the exact shape `flush` still refuses to create.
   *
   * An empty list for an empty document is the honest answer. The caller
   * rejects anything under `TOO_SHORT` long before this.
   */
  return out
}

/** One request's worth of document: sections that fit in a single budget. */
export type CvPass = {
  readonly label: string
  readonly text: string
  /** True when this is a piece of one long section rather than whole ones. */
  readonly partial: boolean
}

/**
 * The document, cut into passes a model can actually answer completely.
 *
 * Sections are packed rather than sent one per call: a CV has a two-line
 * "Languages" section and a nine-page publication list, and one round trip per
 * heading would spend six of them on sections that fit together in one.
 *
 * A section longer than the budget on its own is split, and the pass says so —
 * a model handed the middle of a publication list without being told it is the
 * middle will note that the list "appears to begin mid-way", which is true and
 * not what was asked.
 *
 * The budget is spent on what the pass will actually CARRY — the `## heading`
 * line above each section and the blank line between two of them included, see
 * `cost`. Only two things can still put a pass over it, and both are documents
 * with no seam to cut on: a heading longer than the budget, and a single block
 * of text with no blank line in it.
 */
export function cvPasses(markdown: string, budget = CV_BUDGET): CvPass[] {
  const out: CvPass[] = []
  let held: CvSection[] = []
  let size = 0

  const flush = () => {
    if (held.length === 0) return
    out.push({
      label: held.map((x) => x.heading).join(', '),
      text: held.map((x) => `## ${x.heading}\n${x.text}`).join(SEAM),
      partial: false,
    })
    held = []
    size = 0
  }

  for (const section of cvSections(markdown)) {
    const whole = cost(section)
    if (whole > budget) {
      flush()
      // Split on blank lines so an entry is not cut in half. A publication
      // whose title lands in one pass and whose venue lands in the next is
      // worse than either half alone.
      //
      // The heading is repeated on every piece, so what is left for the text is
      // the budget minus the frame. At least one character, so a heading longer
      // than the whole budget still cuts the section up instead of asking
      // `chunk` for room it cannot give.
      const room = Math.max(1, budget - FRAME - section.heading.length)
      for (const [i, piece] of chunk(section.text, room).entries()) {
        out.push({
          label: `${section.heading} (part ${String(i + 1)})`,
          text: `## ${section.heading}\n${piece}`,
          partial: true,
        })
      }
      continue
    }
    if (size > 0 && size + SEAM.length + whole > budget) flush()
    held.push(section)
    size += size === 0 ? whole : SEAM.length + whole
  }
  flush()

  return out
}

/** What separates two sections packed into one pass. */
const SEAM = '\n\n'

/** The `## ` before a heading and the newline after it. */
const FRAME = '## '.length + '\n'.length

/**
 * What a section costs in the text a pass actually carries.
 *
 * Packing used to count `section.text.length` and nothing else, while `flush`
 * emitted `## ${heading}\n${text}` joined by a blank line — so every heading,
 * its frame and every seam were spent without being counted. Measured
 * (2026-08): two sections with 50-character headings packed to a budget of 200
 * emitted a pass of 290 characters. `cvMessages` then slices anything over
 * `CV_BUDGET` off the END, which is where a CV keeps its publications, so the
 * overshoot was paid for by the part of the document this whole file exists to
 * stop losing.
 */
const cost = (section: CvSection): number => FRAME + section.heading.length + section.text.length

/**
 * A long section, cut at blank lines so no entry straddles two passes.
 *
 * `budget` here is room for the TEXT — the caller has already taken the heading
 * frame off it — and the blank line rejoining two blocks counts against it too.
 */
function chunk(text: string, budget: number): string[] {
  const out: string[] = []
  let held = ''
  for (const block of text.split(/\n\s*\n/)) {
    // A single block over budget has no seam to cut on; it goes whole and the
    // caller's own truncation handles it rather than this splitting mid-word.
    if (held !== '' && held.length + SEAM.length + block.length > budget) {
      out.push(held)
      held = ''
    }
    held = held === '' ? block : `${held}${SEAM}${block}`
  }
  if (held !== '') out.push(held)
  return out.length > 0 ? out : [text]
}
