import { describe, expect, it } from 'vitest'
import { dropMessage, looksLikePdf, sortDroppedPdfs } from './dropped-files'

/** A `File` is constructible in vitest, so these are real ones, not stand-ins. */
const file = (name: string, type = 'application/pdf') =>
  new File([new Uint8Array([1, 2, 3])], name, { type })

/** What Chrome puts in `dataTransfer.files` when a FOLDER is dragged in. */
const folder = (name: string) => new File([], name, { type: '' })

const names = (files: readonly File[]) => files.map((f) => f.name)

describe('deciding whether a dropped file is a PDF', () => {
  it('takes the media type when the browser gives one', () => {
    expect(looksLikePdf(file('cv.pdf'))).toBe(true)
    expect(looksLikePdf(file('notes.txt', 'text/plain'))).toBe(false)
    expect(looksLikePdf(file('shot.png', 'image/png'))).toBe(false)
  })

  it('falls back to the extension, because some sources send no type at all', () => {
    // Dragged out of Windows Explorer or an archive manager: `type` is ''.
    expect(looksLikePdf(file('cv.pdf', ''))).toBe(true)
    expect(looksLikePdf(file('CV.PDF', ''))).toBe(true)
    expect(looksLikePdf(file('notes.txt', ''))).toBe(false)
  })

  it('does not let an extension override a type that disagrees', () => {
    // `contract.pdf.exe` passes an extension test and is not a PDF; the
    // reverse — a real type with an odd name — is the case that must pass.
    expect(looksLikePdf(file('contract.pdf.exe', 'application/x-msdownload'))).toBe(false)
    expect(looksLikePdf(file('scan-no-extension', 'application/pdf'))).toBe(true)
  })

  it('rejects a dropped folder', () => {
    expect(looksLikePdf(folder('Applications'))).toBe(false)
  })
})

describe('sorting a drop', () => {
  it('keeps the PDFs in the order they were dropped', () => {
    const sorted = sortDroppedPdfs([file('a.pdf'), file('b.pdf'), file('c.pdf')])
    expect(names(sorted.pdfs)).toEqual(['a.pdf', 'b.pdf', 'c.pdf'])
    expect(sorted.rejected).toEqual([])
    expect(sorted.ignored).toEqual([])
  })

  it('separates what was not a PDF instead of quietly skipping it', () => {
    const sorted = sortDroppedPdfs([
      file('cv.pdf'),
      file('notes.txt', 'text/plain'),
      folder('Docs'),
    ])
    expect(names(sorted.pdfs)).toEqual(['cv.pdf'])
    expect(sorted.rejected).toEqual(['notes.txt', 'Docs'])
  })

  it('caps at the limit and says what it left, rather than taking the last', () => {
    const sorted = sortDroppedPdfs([file('a.pdf'), file('b.pdf'), file('c.pdf')], 1)
    expect(names(sorted.pdfs)).toEqual(['a.pdf'])
    expect(sorted.ignored).toEqual(['b.pdf', 'c.pdf'])
  })

  it('counts a rejected file against neither the limit nor the used list', () => {
    const sorted = sortDroppedPdfs([file('notes.txt', 'text/plain'), file('cv.pdf')], 1)
    expect(names(sorted.pdfs)).toEqual(['cv.pdf'])
    expect(sorted.rejected).toEqual(['notes.txt'])
    expect(sorted.ignored).toEqual([])
  })

  it('takes everything when no limit is given', () => {
    const many = Array.from({ length: 12 }, (_, i) => file(`${i}.pdf`))
    expect(sortDroppedPdfs(many).pdfs).toHaveLength(12)
  })

  it('handles an empty drop', () => {
    expect(sortDroppedPdfs([])).toEqual({ pdfs: [], rejected: [], ignored: [] })
  })
})

describe('what the person is told', () => {
  it('says nothing when everything was used', () => {
    expect(dropMessage(sortDroppedPdfs([file('cv.pdf')]))).toBeNull()
  })

  it('names a single file that was not a PDF', () => {
    expect(dropMessage(sortDroppedPdfs([file('notes.txt', 'text/plain')]))).toBe(
      'notes.txt is not a PDF.',
    )
  })

  it('does not capitalise, because that would rename the file', () => {
    // `notes.txt` capitalised is `Notes.txt`, which is a different file.
    const message = dropMessage(sortDroppedPdfs([file('notes.txt', 'text/plain')])) ?? ''
    expect(message.startsWith('notes.txt')).toBe(true)
  })

  it('agrees in number', () => {
    const two = [file('a.txt', 'text/plain'), file('b.txt', 'text/plain')]
    expect(dropMessage(sortDroppedPdfs(two))).toBe('a.txt and b.txt are not PDFs.')
    const three = [...two, file('c.txt', 'text/plain')]
    expect(dropMessage(sortDroppedPdfs(three))).toBe('a.txt, b.txt and c.txt are not PDFs.')
  })

  it('counts rather than listing once the list outgrows the line', () => {
    const four = ['a', 'b', 'c', 'd'].map((n) => file(`${n}.txt`, 'text/plain'))
    expect(dropMessage(sortDroppedPdfs(four))).toBe('4 of the files are not PDFs.')
  })

  it('explains a file left out by the limit differently from one refused', () => {
    const sorted = sortDroppedPdfs([file('a.pdf'), file('b.pdf')], 1)
    expect(dropMessage(sorted)).toBe('b.pdf was left out — this works on one document at a time.')
  })

  it('says both things in one sentence when both happened', () => {
    const sorted = sortDroppedPdfs([file('a.pdf'), file('b.pdf'), file('c.txt', 'text/plain')], 1)
    expect(dropMessage(sorted)).toBe(
      'c.txt is not a PDF, and b.pdf was left out — this works on one document at a time.',
    )
  })
})
