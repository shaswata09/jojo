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

/**
 * A segment longer than the filesystem takes is a document that never lands.
 *
 * Reproduced before it was fixed: `契約書` x40 + `.pdf` is 124 characters, 364
 * BYTES, and the segment `blobPath` built for it was 407 with the id and the
 * separator in front. 255 is the per-name cap on ext4, APFS, HFS+ and NTFS, so
 * the phone's restore — which concatenates that segment into a real write —
 * failed with ENAMETOOLONG for that one row and filed a record with no bytes.
 *
 * Bytes rather than characters is the whole point of these cases. A cap counted
 * in characters passes the 124-character name and still writes 407 bytes.
 */
describe('names too long for the filesystem', () => {
  /** UTF-8 length, counted here rather than imported, so the test has its own oracle. */
  const byteLength = (text: string) => {
    let bytes = 0
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    }
    return bytes
  }
  const segmentOf = (path: string) => path.slice(BLOB_DIR.length + 1)
  const id = 'file:01a02b14-31db-7278-a6d7-c03d3258aaaa'

  it('keeps the whole segment inside 255 bytes', () => {
    for (const name of [
      '契約書'.repeat(40) + '.pdf', // 364 bytes: the case that was reported
      'a'.repeat(400) + '.pdf', // ASCII, where characters and bytes agree
      '🙂'.repeat(200) + '.pdf', // four bytes per character, two UTF-16 units
      'n'.repeat(400), // no extension to protect
      '.' + 'g'.repeat(400), // a dotfile, whose leading dot is not an extension
    ]) {
      expect(byteLength(segmentOf(blobPath(id, name))), name.slice(0, 12)).toBeLessThanOrEqual(255)
    }
  })

  it('keeps the extension, which is the only part a platform reads as meaning', () => {
    // `nameOfPath` feeds `mimeOfFile` in the web Vault and the phone hands the
    // name to the OS viewer. Truncated to `契約書契約書…契約` a document opens in
    // nothing; ending `.pdf` it opens correctly and merely reads short.
    expect(nameOfPath(blobPath(id, '契約書'.repeat(40) + '.pdf'))).toMatch(/\.pdf$/)
    expect(nameOfPath(blobPath(id, 'a'.repeat(400) + '.docx'))).toMatch(/\.docx$/)
  })

  it('cuts only where a character ends', () => {
    // A byte-wise cut halves a CJK character and a `slice` halves an emoji into
    // a lone surrogate — either one is a name some filesystems refuse outright,
    // which would relocate this bug rather than fix it.
    const emoji = encodeName('🙂'.repeat(200) + '.pdf')
    expect(emoji.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')).not.toMatch(/[\uD800-\uDFFF]/)
    const cjk = encodeName('契約書'.repeat(40) + '.pdf')
    expect([...cjk].every((ch) => ch !== '�')).toBe(true)
    expect(byteLength(cjk)).toBeLessThanOrEqual(189)
  })

  it('leaves a name that already fits exactly as it was', () => {
    // The budget is 255 - 64 reserved for the id - 2 for the separator = 189.
    // A cap that fired early would rename ordinary documents for nothing.
    const fits = 'a'.repeat(185) + '.pdf'
    expect(encodeName(fits)).toBe(fits)
    expect(encodeName('My CV - final.pdf')).toBe('My CV - final.pdf')
  })

  it('counts the "it already fits" check in bytes as well', () => {
    // The cases above all cut, and every one of them reaches the cut through
    // `cutToBytes`. The budget is checked ONCE MORE before that, to return a
    // short name untouched, and that check counts on its own — so it is the one
    // place a byte count can go back to being a character count without any of
    // the tests above noticing.
    //
    // Measured: with a four-byte character counted as three, `🙂` x63 — 252
    // bytes, and the longest name that check would still wave through — comes
    // back untouched and its segment goes out at 295 bytes. That is the same
    // ENAMETOOLONG this whole describe exists to prevent, arriving through the
    // one door none of the other cases open. The boundary is where the two
    // counts first disagree, so it is where they have to be pinned.
    expect(encodeName('契'.repeat(63))).toBe('契'.repeat(63)) // 189 bytes: fits
    expect(byteLength(encodeName('契'.repeat(64)))).toBeLessThanOrEqual(189) // 192: cut
    expect(encodeName('🙂'.repeat(47))).toBe('🙂'.repeat(47)) // 188 bytes: fits
    expect(byteLength(encodeName('🙂'.repeat(48)))).toBeLessThanOrEqual(189) // 192: cut
    expect(byteLength(segmentOf(blobPath(id, '🙂'.repeat(63))))).toBeLessThanOrEqual(255)
  })

  it('is idempotent, because the phone encodes a second time', () => {
    // `restore-documents.ts` rebuilds the segment as
    // `${id}__${encodeName(nameOfPath(backupPath))}`, so a name that already
    // came through here goes through again. A second pass that cut further
    // would give the phone a filename the backup path no longer names.
    for (const name of ['契約書'.repeat(40) + '.pdf', 'a'.repeat(400) + '.pdf']) {
      const once = encodeName(name)
      expect(encodeName(once)).toBe(once)
      expect(nameOfPath(blobPath(id, name))).toBe(once)
    }
  })

  it('trims further when the id itself is long', () => {
    // `encodeName` can only budget for a RESERVED id length — its other callers
    // do not hold the id. `blobPath` does, so an id longer than the reservation
    // still produces a segment inside the limit instead of a failed restore.
    const longId = 'file:' + 'z'.repeat(200)
    const path = blobPath(longId, 'x'.repeat(300) + '.pdf')
    expect(byteLength(segmentOf(path))).toBeLessThanOrEqual(255)
    expect(idOfPath(path)).toBe(longId)
  })

  it('never cuts the id half, which is what keeps two documents apart', () => {
    // A truncation that mapped two documents onto one path would be worse than
    // the long name it fixed. Uniqueness lives in the id, which is never cut.
    const a = blobPath('file:aaaa', '契約書'.repeat(40) + '.pdf')
    const b = blobPath('file:bbbb', '契約書'.repeat(40) + '.pdf')
    expect(a).not.toBe(b)
    expect(idOfPath(a)).toBe('file:aaaa')
    expect(idOfPath(b)).toBe('file:bbbb')
  })
})
