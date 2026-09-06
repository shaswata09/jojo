/**
 * Turning a document into text without leaving the device. L2 agent, pure.
 *
 * ## Why this exists beside the MarkItDown client
 *
 * `markitdown.ts` speaks to a Python program on another machine. That is the
 * right shape on a desktop, where the machine is the one you are sitting at,
 * and it is the wrong shape on a phone: there is no Python on Android or iOS,
 * an extension cannot be installed to bridge the gap, and telling somebody to
 * run a server on a laptop before their handset can read their own CV is not a
 * local-first application — it is a remote one with extra steps.
 *
 * So the formats that can honestly be read in JavaScript are read here, on the
 * handset, with nothing configured and nothing sent anywhere. MarkItDown stays
 * exactly where it was for the rest: it handles images, OCR, legacy binary
 * `.doc`, and the long tail this file does not pretend to.
 *
 * ## What it does and does not read
 *
 * DOCX, PPTX, ODT and ODP are ZIP archives of XML, and that is the whole trick
 * — unzip, then pull the text nodes out of one part. Plain text, Markdown, CSV
 * and HTML need no unzipping at all. RTF is a flat control-word format with a
 * small enough grammar to walk.
 *
 * PDF IS NOT HERE, and it is the format that matters most for a CV. It needs
 * font and encoding tables to turn glyph codes back into characters, which is a
 * library rather than a function; `readableHere` returns false for it, so the
 * caller falls through to MarkItDown as before. That is a real gap and it is
 * better stated than papered over.
 *
 * Legacy `.doc` and `.ppt` are not here either. They are compound binary
 * documents, and a half-working reader for them would produce plausible
 * mojibake rather than an error — which is the worst outcome, because the model
 * would summarise it.
 *
 * ## Why regular expressions rather than an XML parser
 *
 * The parts being read are machine-written and schema-constrained: Word emits
 * `<w:t>` the same way every time, and no CV contains hand-authored OOXML. A
 * full parser would cost a dependency and buy correctness on inputs that do not
 * occur. What it would buy is protection against malformed XML — and the
 * failure mode here for malformed input is a short or empty extraction, which
 * `readableHere`'s caller reports honestly rather than passing off as the
 * document.
 *
 * The one place this is genuinely fragile is nesting, so nothing here depends
 * on it: every extractor works on a flat sequence of leaf tags.
 */

/* ------------------------------ what we can read -------------------------- */

/**
 * The extensions this module handles, and the shape of each.
 *
 * Keyed by extension rather than MIME because that is what a stored filename
 * carries and what `mimeOfFile` itself keys on. A file whose extension is not
 * here is not refused — it goes to MarkItDown, which is what happened to every
 * file before this existed.
 */
const KINDS = {
  docx: 'ooxml-word',
  pptx: 'ooxml-slides',
  odt: 'odf',
  odp: 'odf',
  txt: 'text',
  md: 'text',
  csv: 'text',
  log: 'text',
  json: 'text',
  html: 'html',
  htm: 'html',
  rtf: 'rtf',
} as const

export type DocumentKind = (typeof KINDS)[keyof typeof KINDS]

/** The extension, lowercased, with no dot. */
const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * How to read this file here, or null when it has to go to MarkItDown.
 *
 * Null is not a failure. It is the caller's signal to use the reader it already
 * had, and every file took that path before this module existed.
 */
export function readableHere(name: string): DocumentKind | null {
  return KINDS[extensionOf(name) as keyof typeof KINDS] ?? null
}

/** Whether this kind arrives as a ZIP the caller has to open first. */
export const isArchive = (kind: DocumentKind): boolean =>
  kind === 'ooxml-word' || kind === 'ooxml-slides' || kind === 'odf'

/**
 * The parts a caller must unzip and hand over, in order, for an archive kind.
 *
 * Returned rather than discovered, so the platform half never has to know an
 * OOXML layout. `ooxml-slides` is the exception that makes this a function
 * rather than a constant: a deck has one part per slide and there is no way to
 * know how many without looking, so the caller passes what it found.
 */
export const partsFor = (kind: DocumentKind): readonly string[] =>
  kind === 'ooxml-word'
    ? ['word/document.xml']
    : kind === 'odf'
      ? ['content.xml']
      : // Slides are numbered from 1 and there is no zero. Twenty is well past
        // any deck somebody files against a job application, and asking for
        // parts that do not exist costs nothing — the caller skips them.
        Array.from({ length: 40 }, (_, i) => `ppt/slides/slide${String(i + 1)}.xml`)

/* -------------------------------- XML helpers ----------------------------- */

/** `&amp;` and friends, plus numeric forms. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Last, or `&amp;lt;` decodes twice and becomes `<`.
    .replace(/&amp;/g, '&')
}

/** A code point, or the empty string when the document names an impossible one. */
const codePoint = (n: number): string =>
  Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''

/** Collapses the runs of blank lines an extractor leaves behind. */
const tidy = (text: string): string =>
  text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/* --------------------------------- OOXML ---------------------------------- */

/**
 * Word's `document.xml` as Markdown.
 *
 * ## What survives
 *
 * Paragraphs, headings, list items and table rows — which is the structure a
 * CV actually carries. A heading becomes `##` rather than a bare line, because
 * the model reading this uses them to tell a section from its contents: the
 * difference between "Publications" as a heading and as the first word of a
 * sentence is the difference between finding six papers and finding none.
 *
 * ## What does not
 *
 * Fonts, colours, alignment, images. None of it means anything to a reader that
 * is going to answer questions about the text, and carrying it would bury the
 * text in noise.
 */
function fromWordXml(xml: string): string {
  const body = xml.slice(xml.indexOf('<w:body'))
  const out: string[] = []

  for (const match of body.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>|<w:p\b[^>]*\/>/g)) {
    const inner = match[1] ?? ''
    // `w:tab` and `w:br` are empty elements carrying layout that IS meaning:
    // a tab separates a role from its dates on nearly every CV written.
    const text = decodeEntities(
      inner
        .replace(/<w:tab\b[^>]*\/?>/g, '\t')
        .replace(/<w:br\b[^>]*\/?>/g, '\n')
        .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, '$1')
        // Everything else in a paragraph is formatting. Dropped after the text
        // nodes have been unwrapped, never before.
        .replace(/<[^>]+>/g, ''),
    )

    const level = /<w:pStyle\b[^>]*w:val="[Hh]eading(\d)"/.exec(inner)?.[1]
    const listed = /<w:numPr\b/.test(inner)
    if (text.trim() === '') {
      out.push('')
      continue
    }
    out.push(
      level !== undefined
        ? `${'#'.repeat(Math.min(6, Number(level)))} ${text.trim()}`
        : listed
          ? `- ${text.trim()}`
          : text,
    )
  }

  return tidy(out.join('\n'))
}

/** One slide's `<a:t>` runs, which is all a deck's text is. */
function fromSlideXml(xml: string): string {
  const parts: string[] = []
  for (const match of xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)) {
    parts.push(decodeEntities(match[1] ?? ''))
  }
  return parts.join('\n').trim()
}

/**
 * OpenDocument's `content.xml` — the same idea in a different vocabulary.
 *
 * `<text:h>` carries its level in an attribute where Word carries it in a
 * style name, and `<text:s/>` is a run of spaces rather than a character. Both
 * are read, because a CV exported from LibreOffice is the same document as one
 * exported from Word and should not read differently to the model.
 */
function fromOdfXml(xml: string): string {
  const out: string[] = []
  const blocks = xml.matchAll(
    /<text:(h|p)\b([^>]*)>([\s\S]*?)<\/text:\1>|<text:(h|p)\b[^>]*\/>/g,
  )
  for (const match of blocks) {
    const attrs = match[2] ?? ''
    const inner = match[3] ?? ''
    const text = decodeEntities(
      inner
        .replace(/<text:tab\b[^>]*\/?>/g, '\t')
        .replace(/<text:line-break\b[^>]*\/?>/g, '\n')
        .replace(/<text:s\b[^>]*\/?>/g, ' ')
        .replace(/<[^>]+>/g, ''),
    )
    if (text.trim() === '') {
      out.push('')
      continue
    }
    const level = /text:outline-level="(\d)"/.exec(attrs)?.[1]
    out.push(
      match[1] === 'h' ? `${'#'.repeat(Math.min(6, Number(level ?? '1')))} ${text.trim()}` : text,
    )
  }
  return tidy(out.join('\n'))
}

/* ---------------------------------- HTML ---------------------------------- */

/**
 * A saved page as text.
 *
 * `<script>` and `<style>` go first and whole, because their CONTENTS are not
 * markup — stripping tags from a page without removing them leaves a wall of
 * minified JavaScript that reads, to a model, like part of the document.
 */
function fromHtml(html: string): string {
  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(h[1-6])\b[^>]*>/gi, (_, tag: string) => `\n\n${'#'.repeat(Number(tag[1]))} `)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\b[^>]*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|section|article|h[1-6]|ul|ol|table)>/gi, '\n\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
  return tidy(decodeEntities(stripped))
}

/* ----------------------------------- RTF ---------------------------------- */

/**
 * RTF, walked rather than parsed.
 *
 * The grammar that matters is small: a control word runs to a delimiter, `\par`
 * ends a paragraph, `\'xx` is a byte in the document's codepage and `\uN` is a
 * code point followed by a replacement character to skip. Groups nest, and the
 * ones prefixed `\*` are extensions a reader is explicitly permitted to ignore
 * — which is where the font tables and the revision history live, and is why
 * skipping them is correct rather than lazy.
 */
function fromRtf(rtf: string): string {
  let out = ''
  let i = 0
  let skipDepth = 0
  let depth = 0

  while (i < rtf.length) {
    const ch = rtf[i]
    if (ch === '{') {
      depth += 1
      i += 1
      if (rtf.startsWith('{\\*', i - 1)) skipDepth = skipDepth === 0 ? depth : skipDepth
      continue
    }
    if (ch === '}') {
      if (skipDepth === depth) skipDepth = 0
      depth -= 1
      i += 1
      continue
    }
    if (ch === '\\') {
      const control = /^\\([a-z]+)(-?\d+)?[ ]?|^\\'([0-9a-f]{2})|^\\([^a-z])/i.exec(rtf.slice(i))
      if (control === null) {
        i += 1
        continue
      }
      i += control[0].length
      if (skipDepth !== 0) continue

      const word = control[1]
      const arg = control[2]
      const hex = control[3]
      const literal = control[4]
      if (hex !== undefined) {
        // A codepage byte. Latin-1 is the right guess for a Western CV and a
        // wrong guess costs one character rather than the document.
        out += String.fromCharCode(parseInt(hex, 16))
      } else if (literal !== undefined) {
        out += literal === '\n' || literal === '\r' ? '\n' : literal
      } else if (word === 'par' || word === 'line' || word === 'sect') {
        out += '\n'
      } else if (word === 'tab') {
        out += '\t'
      } else if (word === 'u' && arg !== undefined) {
        // Negative values are how RTF writes code points above 0x7FFF.
        const n = Number(arg)
        out += codePoint(n < 0 ? n + 65536 : n)
        // The next character is the ASCII stand-in for readers that cannot do
        // Unicode. Skipping it is what stops every accented name doubling.
        if (rtf[i] === '?') i += 1
      }
      continue
    }
    if (skipDepth === 0 && ch !== undefined && ch !== '\r' && ch !== '\n') out += ch
    i += 1
  }

  return tidy(out)
}

/* --------------------------------- the door -------------------------------- */

/**
 * Text out of whatever the platform half managed to read.
 *
 * `parts` is keyed by the names `partsFor` asked for, and is a single entry
 * under `''` for the kinds that are not archives. Missing parts are skipped
 * rather than fatal: a deck with six slides is asked for forty.
 */
export function textFrom(kind: DocumentKind, parts: ReadonlyMap<string, string>): string {
  const only = parts.get('') ?? ''
  switch (kind) {
    case 'ooxml-word':
      return fromWordXml(parts.get('word/document.xml') ?? '')
    case 'ooxml-slides': {
      const slides: string[] = []
      for (const [name, xml] of parts) {
        const text = fromSlideXml(xml)
        if (text !== '') slides.push(`## ${name.replace(/^.*\/|\.xml$/g, '')}\n\n${text}`)
      }
      return tidy(slides.join('\n\n'))
    }
    case 'odf':
      return fromOdfXml(parts.get('content.xml') ?? '')
    case 'html':
      return fromHtml(only)
    case 'rtf':
      return fromRtf(only)
    case 'text':
      return tidy(only)
  }
}
