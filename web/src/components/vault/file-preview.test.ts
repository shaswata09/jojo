/**
 * Round-2 review, R37: a stored .txt, .md or picture opened in the viewer was
 * told "there is no stored document behind this row" — because only a PDF was
 * ever previewed, and every other kind fell through to the sentence written for
 * a row with no bytes. The rule is now two pure functions, run here.
 */
import { describe, expect, it } from 'vitest'
import { noPreviewText, previewKind } from './file-preview'

const blob = (type: string) => ({ type })

describe('previewKind', () => {
  it('previews stored text and pictures', () => {
    expect(previewKind({ kind: 'note', name: 'notes.md' }, blob('text/markdown'))).toBe('text')
    expect(previewKind({ kind: 'note', name: 'cv.txt' }, blob(''))).toBe('text')
    expect(previewKind({ kind: 'doc', name: 'photo.PNG' }, blob(''))).toBe('image')
    expect(previewKind({ kind: 'doc', name: 'scan' }, blob('image/jpeg'))).toBe('image')
    expect(previewKind({ kind: 'doc', name: 'logo.svg' }, blob('image/svg+xml'))).toBe('image')
  })

  it('keeps PDFs and pages on their own paths, and has nothing for a .docx', () => {
    expect(previewKind({ kind: 'pdf', name: 'cv.pdf' }, undefined)).toBe('pdf')
    expect(previewKind({ kind: 'page', name: 'p.html' }, blob('text/html'))).toBe('page')
    expect(previewKind({ kind: 'doc', name: 'cv.docx' }, blob('application/msword'))).toBe('none')
  })

  it('has nothing to preview when the bytes are not here', () => {
    expect(previewKind({ kind: 'note', name: 'notes.md' }, undefined)).toBe('none')
    expect(previewKind({ kind: 'doc', name: 'photo.png' }, undefined)).toBe('none')
  })
})

describe('noPreviewText', () => {
  it('does not tell somebody holding the file that nothing is stored', () => {
    expect(noPreviewText({ kind: 'doc' }, true)).not.toMatch(/no stored document/)
    expect(noPreviewText({ kind: 'doc' }, true)).toMatch(/Save/)
  })

  it('still says so when nothing is', () => {
    expect(noPreviewText({ kind: 'doc' }, false)).toMatch(/no stored document/)
    expect(noPreviewText({ kind: 'page' }, false)).toMatch(/no saved copy on this device/)
  })
})
