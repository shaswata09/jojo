import { describe, expect, it } from 'vitest'
import { BLOB_DIR, BLOB_SEP, blobPath, encodeName, idOfPath, nameOfPath } from './blob-path'

/**
 * These paths come out of a backup file, and a backup file is untrusted input.
 *
 * It arrives two ways, and neither involves the person inspecting it: they pick
 * a `.json` off disk and press Restore, or a phone accepts one over a transfer,
 * which has no confirmation step by design. The phone's restore then
 * concatenates both halves of each path into a real filesystem write, so a path
 * that escapes its segment writes wherever it likes inside the app sandbox —
 * `shared_prefs`, `databases`, jojo's own store.
 *
 * The round-trip cases matter as much as the hostile ones. A guard that mangles
 * `My CV - final.pdf` into `My_CV___final.pdf` has taken something real from
 * every user to prevent nothing, so the ordinary names are pinned here too.
 */
describe('blobPath round trip', () => {
  it('parses back the id and the name it was built from', () => {
    const path = blobPath('file_01H8XY', 'My CV - final.pdf')
    expect(path).toBe('Documents/file_01H8XY__My CV - final.pdf')
    expect(idOfPath(path)).toBe('file_01H8XY')
    expect(nameOfPath(path)).toBe('My CV - final.pdf')
  })

  it('leaves ordinary filenames untouched', () => {
    for (const name of [
      'My CV - final.pdf',
      '提出書類.pdf',
      'cover letter (v2).docx',
      '..config',
      'résumé — 2026.pdf',
    ]) {
      expect(encodeName(name)).toBe(name)
    }
  })

  it('folds the separator so the id half stays parseable', () => {
    // A filename may legitimately contain the separator; the id may not lose it.
    const path = blobPath('file_01H8XY', 'notes__draft.txt')
    expect(idOfPath(path)).toBe('file_01H8XY')
    expect(nameOfPath(path)).toBe('notes_draft.txt')
  })
})

describe('the colon, which jojo mints into every id', () => {
  /**
   * The confinement guard first refused any id containing a colon, on the
   * reasonable-sounding grounds that Windows treats it as a drive separator.
   * jojo's ids look like `file:01a02b14-…`, so that refused every document the
   * app has ever written — `idOfPath` returned null for all of them and a
   * restore would have skipped the lot as "naming no record".
   *
   * The name half still strips it, where refusing it costs nothing.
   */
  it('keeps a colon in the id', () => {
    const id = 'file:01a02b14-31db-7278-a6d7-c03d3258aaaa'
    const path = blobPath(id, 'CV.pdf')
    expect(idOfPath(path)).toBe(id)
  })

  it('strips a colon from the filename', () => {
    expect(encodeName('C:notes.pdf')).toBe('C_notes.pdf')
  })
})

describe('paths that would escape their segment', () => {
  it('refuses an id carrying a separator', () => {
    expect(idOfPath('Documents/../../../../../../tmp/pwned__x.txt')).toBeNull()
    expect(idOfPath('Documents/a/b__x.txt')).toBeNull()
    expect(idOfPath('Documents/a\\b__x.txt')).toBeNull()
  })

  it('refuses an id that is only dots', () => {
    expect(idOfPath(`Documents/..${BLOB_SEP}x.txt`)).toBeNull()
    expect(idOfPath(`Documents/.${BLOB_SEP}x.txt`)).toBeNull()
  })

  it('strips separators out of the name half', () => {
    const name = nameOfPath('Documents/file_a__../../../../shared_prefs/evil.xml')
    expect(name).not.toContain('/')
    expect(name).toBe('.._.._.._.._shared_prefs_evil.xml')
  })

  it('strips backslashes too, because a backup crosses platforms', () => {
    expect(nameOfPath('Documents/file_b__..\\..\\windows\\evil.txt')).not.toContain('\\')
  })

  it('strips control characters and the colon, which some filesystems refuse', () => {
    expect(encodeName('bad\u0001name.pdf')).toBe('bad_name.pdf')
    expect(encodeName('tab\tname.pdf')).toBe('tab_name.pdf')
    expect(encodeName('C:notes.pdf')).toBe('C_notes.pdf')
  })

  it('still refuses a path that names no record at all', () => {
    expect(idOfPath('elsewhere/file_a__x.txt')).toBeNull()
    expect(idOfPath(`${BLOB_DIR}/no-separator.txt`)).toBeNull()
    expect(idOfPath(`${BLOB_DIR}/${BLOB_SEP}leading.txt`)).toBeNull()
  })
})
