/**
 * The two rules that used to be four, pinned on the way down.
 *
 * Neither had a test while it sat in `src/lib` — which is how the Vault and the
 * Profile drifted to two different answers for .odp in the first place — and
 * `kg` is the tree where that is not allowed to be true (D20). These cases
 * are the ones a second copy would have got wrong: the fallback, the MIME
 * rescue, and the three size boundaries the seed rows are written against.
 */

import { describe, expect, it } from 'vitest'
import { kindOfFile, sizeLabel, mimeOfFile } from './files'

describe('kindOfFile', () => {
  it('reads the extension, case-insensitively', () => {
    expect(kindOfFile('offer.PDF')).toBe('pdf')
    expect(kindOfFile('cv.docx')).toBe('doc')
    expect(kindOfFile('talk.odp')).toBe('slides')
    expect(kindOfFile('notes.md')).toBe('note')
  })

  // The drift that started this: .odp is a deck in both surfaces or in neither.
  it('files every office deck extension as slides', () => {
    for (const name of ['a.ppt', 'a.pptx', 'a.odp', 'a.key']) {
      expect(kindOfFile(name)).toBe('slides')
    }
  })

  /**
   * Unrecognised is a document, never a blank: the icon set can draw four
   * shapes and a fifth answer renders nothing at all.
   */
  it('falls back to doc for anything it does not know', () => {
    expect(kindOfFile('archive.zip')).toBe('doc')
    expect(kindOfFile('no-extension')).toBe('doc')
    expect(kindOfFile('')).toBe('doc')
  })

  /**
   * The MIME type only ever rescues a PDF the name failed to declare — an
   * Android content URI routinely arrives named 'document' with a real type on
   * it. It must not override an extension that already answered.
   */
  it('uses the reported type only when the extension did not answer', () => {
    expect(kindOfFile('scan', 'application/pdf')).toBe('pdf')
    expect(kindOfFile('deck.pptx', 'application/pdf')).toBe('slides')
    expect(kindOfFile('scan', 'application/octet-stream')).toBe('doc')
  })
})

describe('sizeLabel', () => {
  it('spells each unit the way the seed rows already do', () => {
    expect(sizeLabel(512)).toBe('512 B')
    expect(sizeLabel(184 * 1024)).toBe('184 KB')
    expect(sizeLabel(1.2 * 1024 * 1024)).toBe('1.2 MB')
  })

  /**
   * The unit steps at the boundary, and one byte below it rounds to '1024 KB'
   * rather than to '1.0 MB' — the comparison is on the unrounded value and the
   * rounding happens after. Pinned rather than fixed: it is one byte wide, no
   * seed row is near it, and a second implementation deciding to "correct" it
   * would be the drift this move exists to stop.
   */
  it('steps up at the boundary, and rounds up one byte short of it', () => {
    expect(sizeLabel(1023)).toBe('1023 B')
    expect(sizeLabel(1024)).toBe('1 KB')
    expect(sizeLabel(1024 * 1024 - 1)).toBe('1024 KB')
    expect(sizeLabel(1024 * 1024)).toBe('1.0 MB')
  })
})

describe('mimeOfFile', () => {
  it('knows the types both apps needed, which neither map knew alone', () => {
    // web's copy knew webp and svg; mobile's knew odt, rtf and pptx. One map now.
    expect(mimeOfFile('CV.pdf')).toBe('application/pdf')
    expect(mimeOfFile('letter.odt')).toBe('application/vnd.oasis.opendocument.text')
    expect(mimeOfFile('deck.pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    )
    expect(mimeOfFile('shot.webp')).toBe('image/webp')
    expect(mimeOfFile('logo.svg')).toBe('image/svg+xml')
  })

  it('is case- and path-insensitive, because filenames are neither', () => {
    expect(mimeOfFile('CV.PDF')).toBe('application/pdf')
    expect(mimeOfFile('Documents/My CV.Pdf')).toBe('application/pdf')
    expect(mimeOfFile('a.b.c.pdf')).toBe('application/pdf')
  })

  it("lets the caller choose the fallback, because the platforms disagree", () => {
    // Android offers no application at all for octet-stream, so the phone asks
    // for the wildcard; a browser building a Blob needs a real type.
    expect(mimeOfFile('mystery.zzz')).toBe('application/octet-stream')
    expect(mimeOfFile('mystery.zzz', '*/*')).toBe('*/*')
    expect(mimeOfFile('noextension')).toBe('application/octet-stream')
  })
})
