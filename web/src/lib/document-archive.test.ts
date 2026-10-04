import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { archiveName, buildArchive, uniqueEntryNames } from './document-archive'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('uniqueEntryNames', () => {
  it('leaves distinct names alone, in order', () => {
    expect(uniqueEntryNames(['CV.pdf', 'Cover letter.docx', 'notes.md'])).toEqual([
      'CV.pdf',
      'Cover letter.docx',
      'notes.md',
    ])
  })

  it('numbers a repeated name before its extension, so no document is overwritten', () => {
    expect(uniqueEntryNames(['CV.pdf', 'CV.pdf', 'CV.pdf'])).toEqual([
      'CV.pdf',
      'CV (2).pdf',
      'CV (3).pdf',
    ])
  })

  it('treats names that differ only in case as the same file', () => {
    // macOS and Windows unzip these onto one file, so the archive must not.
    expect(uniqueEntryNames(['CV.pdf', 'cv.PDF'])).toEqual(['CV.pdf', 'cv (2).PDF'])
  })

  it('counts past a name that is already taken for real', () => {
    expect(uniqueEntryNames(['CV.pdf', 'CV (2).pdf', 'CV.pdf'])).toEqual([
      'CV.pdf',
      'CV (2).pdf',
      'CV (3).pdf',
    ])
  })

  it('numbers names with no extension, and dotfiles, at the end', () => {
    expect(uniqueEntryNames(['README', 'README', '.env', '.env'])).toEqual([
      'README',
      'README (2)',
      '.env',
      '.env (2)',
    ])
  })

  it('splits on the LAST dot only', () => {
    expect(uniqueEntryNames(['cv.final.pdf', 'cv.final.pdf'])).toEqual([
      'cv.final.pdf',
      'cv.final (2).pdf',
    ])
  })

  it('never lets an entry carry a path separator', () => {
    for (const name of uniqueEntryNames(['../../evil.pdf', 'a\\b.pdf', 'dir/cv.pdf'])) {
      expect(name).not.toMatch(/[/\\]/)
    }
  })

  it('names an empty or blank name rather than writing a nameless entry', () => {
    expect(uniqueEntryNames(['', '   '])).toEqual(['document', 'document (2)'])
  })
})

describe('buildArchive', () => {
  it('round-trips every document byte for byte, under the names given', () => {
    const entries = [
      { name: 'CV.pdf', bytes: bytes('%PDF-1.7 not really') },
      { name: 'CV (2).pdf', bytes: bytes('%PDF-1.7 the other one') },
      { name: 'notes.md', bytes: bytes('# Notes\n\nunicode survives: ü 日本 ✓') },
    ]
    const out = unzipSync(buildArchive(entries))
    expect(Object.keys(out).sort()).toEqual(['CV (2).pdf', 'CV.pdf', 'notes.md'])
    for (const entry of entries) expect(out[entry.name]).toEqual(entry.bytes)
  })

  it('stores already-compressed kinds and deflates text', () => {
    // 64KB of one byte: deflate shrinks it to almost nothing, storing does not.
    const flat = new Uint8Array(65_536).fill(65)
    const pdf = buildArchive([{ name: 'big.pdf', bytes: flat }])
    const txt = buildArchive([{ name: 'big.txt', bytes: flat }])
    expect(pdf.length).toBeGreaterThan(65_536)
    expect(txt.length).toBeLessThan(2_048)
    // Either way the bytes come back out intact.
    expect(unzipSync(pdf)['big.pdf']).toEqual(flat)
    expect(unzipSync(txt)['big.txt']).toEqual(flat)
  })

  it('matches the stored kinds case-insensitively', () => {
    const flat = new Uint8Array(65_536).fill(65)
    expect(buildArchive([{ name: 'SCAN.PDF', bytes: flat }]).length).toBeGreaterThan(65_536)
  })

  it('survives a modification time a ZIP cannot hold', () => {
    // `File.lastModified` is 0 when the browser has no time for a file; fflate
    // throws for anything before 1980, and that must not cost the archive.
    for (const modified of [0, -1, Date.UTC(1979, 11, 31), Date.UTC(2150, 0, 1), Number.NaN]) {
      const out = unzipSync(buildArchive([{ name: 'a.txt', bytes: bytes('a'), modified }]))
      expect(out['a.txt']).toEqual(bytes('a'))
    }
  })

  it('keeps a real modification time', () => {
    const modified = Date.UTC(2026, 3, 15, 12, 0, 0)
    const zip = buildArchive([{ name: 'a.txt', bytes: bytes('a'), modified }])
    // Local file header: DOS date at offset 12, year stored as years since 1980.
    const dosDate = zip[12]! | (zip[13]! << 8)
    expect((dosDate >> 9) + 1980).toBe(new Date(modified).getFullYear())
  })

  it('builds an empty archive rather than throwing', () => {
    expect(Object.keys(unzipSync(buildArchive([])))).toEqual([])
  })
})

describe('archiveName', () => {
  it('is dated, so a second download does not land on the first', () => {
    expect(archiveName('2026-10-03')).toBe('jojo-documents-2026-10-03.zip')
  })
})
