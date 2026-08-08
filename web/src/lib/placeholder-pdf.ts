/**
 * Builds a real, valid PDF in the browser, with no dependency.
 *
 * The point is the *viewer*: `<iframe src="…pdf">` hands rendering to whatever
 * PDF reader the browser ships, which is the behaviour asked for. That needs an
 * actual PDF to point at, and the vault's files are seed records with no bytes
 * behind them — so this makes a small one.
 *
 * What it emits is explicitly labelled a placeholder. Generating a document
 * that *looked* like the real posting or the real CV would be inventing content
 * and passing it off as the user's, which is worse than showing nothing.
 *
 * ~1KB of text and a byte-offset table; a PDF is a plain-text container, and a
 * one-page Helvetica document is the smallest thing every reader understands.
 */

/**
 * The typographic characters this app actually uses, mapped to their WinAnsi
 * byte. Everything below U+0100 already sits at its own code point there.
 */
const WIN_ANSI: Record<string, number> = {
  '€': 0x80, // €
  '‚': 0x82, // ‚
  '„': 0x84, // „
  '…': 0x85, // …
  '†': 0x86, // †
  '‡': 0x87, // ‡
  '‰': 0x89, // ‰
  '‹': 0x8b, // ‹
  '‘': 0x91, // '
  '’': 0x92, // '
  '“': 0x93, // "
  '”': 0x94, // "
  '•': 0x95, // •
  '–': 0x96, // –
  '—': 0x97, // —
  '™': 0x99, // ™
  '›': 0x9b, // ›
}

/**
 * Folds text down to single-byte WinAnsi.
 *
 * This is load-bearing, not cosmetic. The cross-reference table below records
 * byte offsets, and they are derived from string *length* — so every character
 * has to occupy exactly one byte. A `Blob` encodes a JS string as UTF-8, where
 * the `·` this app puts between every metadata field is two bytes, which would
 * silently slide every offset past it out of alignment with what the table
 * claims. Anything with no WinAnsi byte becomes `?` rather than shifting the
 * count.
 */
function toWinAnsi(text: string) {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x100) out += ch
    else if (ch in WIN_ANSI) out += String.fromCharCode(WIN_ANSI[ch])
    else out += '?'
  }
  return out
}

/** Escapes the three characters that are syntax inside a PDF string literal. */
function pdfString(text: string) {
  return toWinAnsi(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

type Line = { text: string; size?: number; gap?: number }

export function placeholderPdf({ title, lines }: { title: string; lines: Line[] }) {
  const PAGE_W = 612
  const PAGE_H = 792
  const LEFT = 64
  let y = PAGE_H - 96

  const body: string[] = ['BT', `/F1 18 Tf`, `1 0 0 1 ${LEFT} ${y} Tm`, `(${pdfString(title)}) Tj`]
  y -= 34

  for (const line of lines) {
    y -= line.gap ?? 0
    body.push('ET', 'BT', `/F1 ${line.size ?? 11} Tf`, `1 0 0 1 ${LEFT} ${y} Tm`)
    body.push(`(${pdfString(line.text)}) Tj`)
    y -= (line.size ?? 11) + 8
  }
  body.push('ET')

  const stream = body.join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    // WinAnsi, to match what `toWinAnsi` above emits. Without it the bytes
    // above 0x7F are read as StandardEncoding and land on the wrong glyphs.
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]

  let pdf = '%PDF-1.4\n'
  // Byte offsets of every object, which the cross-reference table below has to
  // report exactly — a reader seeks by them and rejects the file if they lie.
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })

  const xrefAt = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`

  return pdf
}

/**
 * A blob: URL rather than a data: URI.
 *
 * Chrome refuses to render a top-level `data:application/pdf` document in a
 * frame, so a data URI would show a download prompt instead of the viewer —
 * exactly the thing being built here.
 *
 * The string is written out one byte per character rather than handed to the
 * `Blob` as text, because `Blob` would encode it as UTF-8 and the file's own
 * offset table is counted in characters. `placeholderPdf` has already folded
 * everything into single-byte range, so the two agree.
 */
export function pdfObjectUrl(pdf: string) {
  const bytes = new Uint8Array(pdf.length)
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
}
