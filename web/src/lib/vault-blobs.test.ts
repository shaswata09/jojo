/**
 * The path encoding, which is the whole of how a record finds its bytes again.
 *
 * D20 rules out mounting the hook, so what is tested is the pure half — and that
 * half is where a mistake is silent: a path that does not decode leaves the
 * record on screen with its document unreachable, which reads as data loss and
 * is not distinguishable from it by looking.
 */

import { describe, expect, it } from 'vitest'
import { blobPath, idOfPath, nameOfPath } from '@/lib/vault-blobs'

describe('the path a document is stored at', () => {
  it('round-trips an id and a name', () => {
    const path = blobPath('file_01H8XY', 'CV.pdf')
    expect(idOfPath(path)).toBe('file_01H8XY')
    expect(nameOfPath(path)).toBe('CV.pdf')
  })

  it('survives the names people actually give documents', () => {
    for (const name of [
      'CV Rice Oct 2026 — Résumé.pdf',
      'cover letter (final) v3.docx',
      'statement.of.research.pdf',
      'a.pdf',
      "O'Brien — statement.pdf",
    ]) {
      const path = blobPath('file_x', name)
      expect(idOfPath(path), name).toBe('file_x')
      expect(nameOfPath(path), name).toBe(name)
    }
  })

  it('keeps the id readable when the NAME contains the separator', () => {
    // The one input that breaks a split: a filename carrying the delimiter. If
    // the id came back wrong the index would point at nothing and the document
    // would be unreachable while its record stayed on screen.
    const path = blobPath('file_x', 'my__notes.pdf')
    expect(idOfPath(path)).toBe('file_x')
    expect(nameOfPath(path)).toBe('my_notes.pdf')
  })

  it('handles the ids jojo actually mints, which contain a colon', () => {
    // Real ids are type-prefixed UUIDv7 — `file:01a02b14-31db-7278-…` — and the
    // fixtures above all used `file_x`. A test whose fixture is not the shape of
    // the real thing proves nothing about the real thing; this exact gap made
    // three restore tests pass on a fixture the validator would have rejected.
    const id = 'file:01a02b14-31db-7278-a6d7-c03d325832ba'
    const path = blobPath(id, 'Tailored-CV.pdf')
    expect(idOfPath(path)).toBe(id)
    expect(nameOfPath(path)).toBe('Tailored-CV.pdf')
    // A colon must not be mistaken for the delimiter, and the path must stay
    // one segment deep or `list` will not see it.
    expect(path.split('/').length).toBe(2)
  })

  it('is non-recursive, so one list() finds every document', () => {
    // `list` is non-recursive by contract. A path with a second separator would
    // be invisible to it and the index would come back empty on every reload.
    const path = blobPath('file_x', 'CV.pdf')
    expect(path.split('/').length).toBe(2)
    expect(path.startsWith('Documents/')).toBe(true)
  })

  it('refuses to read an id out of a path jojo did not write', () => {
    for (const foreign of [
      'jojo/folder.json',
      'jojo/Trash/Documents/file_x__CV.pdf',
      'Documents/loose.pdf',
      'Documents/__leading.pdf',
      'Elsewhere/file_x__CV.pdf',
    ]) {
      expect(idOfPath(foreign), foreign).toBeNull()
    }
  })
})
