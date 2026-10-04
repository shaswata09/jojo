import { strToU8, zipSync } from 'fflate'

/**
 * A table out to a file a person opens in Excel, Numbers or Sheets.
 *
 * Two writers over one shape, so a caller decides WHAT goes in a sheet and
 * never how either format encodes it. Pure, so the encoding — which is where
 * these go wrong — runs under vitest.
 *
 * ## Why XLSX is written here rather than taken from a library
 *
 * The libraries that write XLSX are either large (the whole Office model, for
 * one sheet of text) or distributed outside npm. What a single sheet of text
 * with links needs is five small XML parts in a ZIP, and `fflate` already
 * writes the ZIP (`document-archive.ts`). The parts follow ECMA-376 in the
 * minimal form Excel itself accepts — inline strings, no shared-string table —
 * and the test reads them back.
 *
 * ## Why XLSX is the default and CSV the fallback
 *
 * A CSV opened in Excel is quietly worse in four ways a recommender would see:
 * a link is text, not something to click; Excel without a byte-order mark
 * reads UTF-8 as Windows-1252, so "Zürich" arrives garbled; in a locale whose
 * list separator is ";" every row lands in one column; and a cell beginning
 * with `=` is a formula. XLSX has none of those problems. CSV stays for the
 * people whose tool is not a spreadsheet, and is written to dodge all four
 * that it can (`toCsv`).
 */

/** One cell: text, or text that links somewhere. */
export type Cell = string | { text: string; link: string }

export type Table = {
  headers: readonly string[]
  rows: readonly (readonly Cell[])[]
  /** Column widths in characters, for the XLSX writer. CSV has no widths. */
  widths?: readonly number[]
}

const textOf = (cell: Cell | undefined) => (cell === undefined ? '' : typeof cell === 'string' ? cell : cell.text)

/**
 * A link a spreadsheet may make clickable: http, https or mailto, nothing else.
 *
 * Anything else stays as text. A `javascript:` or `file:` URL in a job record
 * is a mistake at best, and a clickable one in a file sent to somebody else is
 * not a mistake this app should help make.
 */
export function safeLink(url: string): string | null {
  const trimmed = url.trim()
  if (trimmed === '') return null
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:'
      ? trimmed
      : null
  } catch {
    return null
  }
}

/* ----------------------------------- CSV ---------------------------------- */

/**
 * Cells a spreadsheet would read as a formula, prefixed so it reads them as
 * text. OWASP's list for CSV injection: `=`, `+`, `-`, `@`, and a leading tab
 * or carriage return. The apostrophe is the prefix Excel itself uses to mean
 * "this is text", and it does not display.
 */
const FORMULA_START = /^[=+\-@\t\r]/

function csvCell(raw: string): string {
  // Control characters out, as in XLSX: they render as boxes and help nobody.
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  const safe = FORMULA_START.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/**
 * RFC 4180: comma-separated, CRLF between records, a field quoted when it
 * holds a comma, a quote or a line break. With a UTF-8 byte-order mark in
 * front, which is the one thing that makes Excel on Windows read the file as
 * UTF-8 — and which Numbers, Sheets and LibreOffice all ignore.
 */
export function toCsv(table: Table): string {
  const lines = [table.headers, ...table.rows].map((row) => row.map((cell) => csvCell(textOf(cell))).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}

/* ---------------------------------- XLSX ---------------------------------- */

/**
 * Characters XML 1.0 cannot carry at all, not even escaped. One in a note —
 * a pasted vertical tab, a stray NUL — and Excel refuses the whole workbook as
 * corrupt, so they are removed rather than escaped.
 */
// eslint-disable-next-line no-control-regex
const NOT_XML = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu

const escapeXml = (text: string) =>
  text
    .replace(NOT_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** Excel's own limit on what one cell holds. Past it, the file will not open. */
export const MAX_CELL_TEXT = 32_767

/** `0` → `A`, `25` → `Z`, `26` → `AA`. */
export function columnName(index: number): string {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  }
  return name
}

/**
 * A sheet name Excel will accept: at most 31 characters, none of `[]:*?/\`,
 * and not wrapped in apostrophes. Excel refuses the file over a bad one.
 */
export function sheetName(name: string): string {
  const clean = name
    .replace(/[[\]:*?/\\]/g, ' ')
    .replace(/^'+|'+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31)
    .trim()
  return clean || 'Sheet1'
}

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

/* Style indexes into `cellXfs` below. */
const STYLE_HEADER = 1
const STYLE_BODY = 2
const STYLE_LINK = 3

const STYLES = `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">\
<fonts count="3">\
<font><sz val="11"/><name val="Calibri"/></font>\
<font><b/><sz val="11"/><name val="Calibri"/></font>\
<font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font>\
</fonts>\
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>\
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>\
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>\
<cellXfs count="4">\
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>\
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>\
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>\
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>\
</cellXfs>\
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>\
</styleSheet>`

/**
 * One sheet, as an `.xlsx` workbook.
 *
 * The header row is bold and frozen, so it stays put while a long list
 * scrolls; body cells wrap and sit at the top of their row, because a
 * highlights cell runs to several lines and the employer beside it should not
 * float to the middle. Links are real hyperlinks.
 */
export function toXlsx(table: Table, title: string): Uint8Array<ArrayBuffer> {
  const width = Math.max(table.headers.length, ...table.rows.map((row) => row.length), 1)
  const links: { ref: string; target: string }[] = []

  const cellXml = (cell: Cell | undefined, ref: string, style: number) => {
    const text = textOf(cell).slice(0, MAX_CELL_TEXT)
    if (text === '') return ''
    const target = typeof cell === 'object' ? safeLink(cell.link) : null
    if (target !== null) links.push({ ref, target })
    const s = target !== null ? STYLE_LINK : style
    return `<c r="${ref}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`
  }

  const rowXml = (cells: readonly Cell[], r: number, style: number) =>
    `<row r="${r}">${cells.map((cell, i) => cellXml(cell, `${columnName(i)}${r}`, style)).join('')}</row>`

  const rows = [
    rowXml(table.headers, 1, STYLE_HEADER),
    ...table.rows.map((row, i) => rowXml(row, i + 2, STYLE_BODY)),
  ].join('')

  const cols =
    table.widths && table.widths.length > 0
      ? `<cols>${table.widths
          .slice(0, width)
          .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.min(w, 255))}" customWidth="1"/>`)
          .join('')}</cols>`
      : ''

  const lastRef = `${columnName(width - 1)}${table.rows.length + 1}`
  const hyperlinks =
    links.length === 0
      ? ''
      : `<hyperlinks>${links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rId${i + 1}"/>`).join('')}</hyperlinks>`

  // Element order is fixed by the schema; Excel refuses a sheet that reorders it.
  const sheet = `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">\
<dimension ref="A1:${lastRef}"/>\
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>\
<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${hyperlinks}\
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>\
</worksheet>`

  const sheetRels =
    links.length === 0
      ? null
      : `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">${links
          .map(
            (l, i) =>
              `<Relationship Id="rId${i + 1}" Type="${NS_REL}/hyperlink" Target="${escapeXml(l.target)}" TargetMode="External"/>`,
          )
          .join('')}</Relationships>`

  const parts: Record<string, string> = {
    // First, as Office writes it; some readers sniff for it at the front.
    '[Content_Types].xml': `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\
<Default Extension="xml" ContentType="application/xml"/>\
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\
</Types>`,
    '_rels/.rels': `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">\
<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>\
</Relationships>`,
    'xl/workbook.xml': `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">\
<bookViews><workbookView/></bookViews>\
<sheets><sheet name="${escapeXml(sheetName(title))}" sheetId="1" r:id="rId1"/></sheets>\
</workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">\
<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>\
<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>\
</Relationships>`,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': sheet,
    ...(sheetRels === null ? {} : { 'xl/worksheets/_rels/sheet1.xml.rels': sheetRels }),
  }

  return zipSync(Object.fromEntries(Object.entries(parts).map(([path, xml]) => [path, strToU8(xml)])))
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const CSV_MIME = 'text/csv;charset=utf-8'
