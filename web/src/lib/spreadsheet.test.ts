import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { columnName, MAX_CELL_TEXT, safeLink, sheetName, toCsv, toXlsx, type Table } from './spreadsheet'

const table: Table = {
  headers: ['Employer', 'Posting link', 'Notes'],
  widths: [20, 30, 40],
  rows: [
    ['Rice', { text: 'https://jobs.rice.edu/1?a=1&b=2', link: 'https://jobs.rice.edu/1?a=1&b=2' }, 'Zürich & <b> "q"'],
    ['=SUM(A1)', { text: 'javascript:alert(1)', link: 'javascript:alert(1)' }, ''],
  ],
}

const parts = (bytes: Uint8Array) =>
  Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]))

describe('safeLink', () => {
  it('keeps http, https and mailto, and nothing else', () => {
    expect(safeLink('https://a.edu/x')).toBe('https://a.edu/x')
    expect(safeLink(' http://a.edu ')).toBe('http://a.edu')
    expect(safeLink('mailto:a@b.edu')).toBe('mailto:a@b.edu')
    expect(safeLink('javascript:alert(1)')).toBeNull()
    expect(safeLink('file:///etc/passwd')).toBeNull()
    expect(safeLink('not a url')).toBeNull()
    expect(safeLink('')).toBeNull()
  })
})

describe('toCsv', () => {
  const csv = toCsv(table)

  it('starts with a byte-order mark and ends records with CRLF', () => {
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.split('\r\n')).toHaveLength(4) // three records and a trailing break
  })

  it('quotes a field holding a comma, quote or line break, doubling the quotes', () => {
    const out = toCsv({ headers: ['a'], rows: [['x, "y"\nz']] })
    expect(out).toContain('"x, ""y""\nz"')
  })

  it('defuses a cell a spreadsheet would run as a formula', () => {
    for (const lead of ['=', '+', '-', '@']) {
      const out = toCsv({ headers: ['a'], rows: [[`${lead}1+1`]] })
      expect(out.split('\r\n')[1]).toBe(`'${lead}1+1`)
    }
  })

  it('writes a link cell as its text, and drops control characters', () => {
    const out = toCsv({ headers: ['a'], rows: [[{ text: 'https://x.edu', link: 'https://x.edu' }], ['a\u0007b']] })
    expect(out.split('\r\n').slice(1, 3)).toEqual(['https://x.edu', 'ab'])
  })
})

describe('toXlsx', () => {
  const files = parts(toXlsx(table, 'Applications'))

  it('writes the parts a workbook needs, content types first', () => {
    expect(Object.keys(files)[0]).toBe('[Content_Types].xml')
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        '_rels/.rels',
        'xl/workbook.xml',
        'xl/_rels/workbook.xml.rels',
        'xl/styles.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/_rels/sheet1.xml.rels',
      ]),
    )
  })

  it('escapes text, and stores every cell as text — never a formula', () => {
    const sheet = files['xl/worksheets/sheet1.xml']!
    expect(sheet).toContain('Zürich &amp; &lt;b&gt; &quot;q&quot;')
    expect(sheet).toContain('<c r="A3" t="inlineStr"')
    expect(sheet).not.toContain('<f>')
  })

  it('links only a safe URL, and escapes it in the relationship', () => {
    const sheet = files['xl/worksheets/sheet1.xml']!
    const rels = files['xl/worksheets/_rels/sheet1.xml.rels']!
    expect(sheet).toContain('<hyperlink ref="B2" r:id="rId1"/>')
    expect(sheet).not.toContain('ref="B3"')
    expect(rels).toContain('Target="https://jobs.rice.edu/1?a=1&amp;b=2" TargetMode="External"')
    expect(rels).not.toContain('javascript')
  })

  it('freezes the header row and sets the column widths', () => {
    const sheet = files['xl/worksheets/sheet1.xml']!
    expect(sheet).toContain('state="frozen"')
    expect(sheet).toContain('<col min="3" max="3" width="40" customWidth="1"/>')
    expect(sheet).toContain('<dimension ref="A1:C3"/>')
  })

  it('removes characters XML cannot carry, which would corrupt the workbook', () => {
    const sheet = parts(toXlsx({ headers: ['a'], rows: [['ok\u0000\u000Bstill ok']] }, 's'))['xl/worksheets/sheet1.xml']!
    expect(sheet).toContain('okstill ok')
  })

  it('cuts a cell at the length Excel will open', () => {
    const sheet = parts(toXlsx({ headers: ['a'], rows: [['x'.repeat(MAX_CELL_TEXT + 10)]] }, 's'))[
      'xl/worksheets/sheet1.xml'
    ]!
    expect(sheet).toContain('x'.repeat(MAX_CELL_TEXT))
    expect(sheet).not.toContain('x'.repeat(MAX_CELL_TEXT + 1))
  })

  it('writes no relationship part when there is nothing to link', () => {
    expect(Object.keys(parts(toXlsx({ headers: ['a'], rows: [['b']] }, 's')))).not.toContain(
      'xl/worksheets/_rels/sheet1.xml.rels',
    )
  })

  it('names the sheet something Excel accepts', () => {
    expect(parts(toXlsx(table, "'For: [Ngozi]?'"))['xl/workbook.xml']).toContain('name="For Ngozi"')
  })
})

describe('columnName and sheetName', () => {
  it('spells columns the way Excel does', () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA'])
  })

  it('keeps a sheet name within 31 characters and falls back when nothing is left', () => {
    expect(sheetName('x'.repeat(40))).toHaveLength(31)
    expect(sheetName('[]:*?/\\')).toBe('Sheet1')
  })
})
