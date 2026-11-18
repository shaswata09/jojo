/**
 * security-2 (review 2026-11-18): the paths a file record may make the phone
 * act on. A record's `uri` can be written by the assistant's `vault.file.add` /
 * `vault.file.update` or carried in by a backup, so only a path inside the
 * app's own document directory is ever read, moved, deleted or shared.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native-blob-util', () => ({
  default: { fs: { dirs: { DocumentDir: '/data/user/0/dev.jojo/files' } } },
}))

const { isInsideDir, ownDocumentPath, pathOfUri } = await import('./document-path')

const ROOT = '/data/user/0/dev.jojo/files'

describe("a file record's path on the phone (security-2)", () => {
  it('accepts what the picker, a restore and a capture write', () => {
    expect(isInsideDir(`${ROOT}/9f2c/1764-CV 2026.pdf`, ROOT)).toBe(true)
    expect(isInsideDir(`${ROOT}/restored/app__CV.pdf`, ROOT)).toBe(true)
    expect(isInsideDir(`${ROOT}/jojo-captures/file-1.html`, ROOT)).toBe(true)
    expect(ownDocumentPath(`file://${ROOT}/9f2c/1764-CV%202026.pdf`)).toBe(
      `${ROOT}/9f2c/1764-CV 2026.pdf`,
    )
  })

  it('refuses the store, a sibling with the same prefix, and the directory itself', () => {
    expect(ownDocumentPath('file:///data/user/0/dev.jojo/databases/RKStorage')).toBeNull()
    expect(isInsideDir('/data/user/0/dev.jojo/files-evil/x', ROOT)).toBe(false)
    expect(isInsideDir(ROOT, ROOT)).toBe(false)
    expect(isInsideDir(`${ROOT}/`, ROOT)).toBe(false)
  })

  it("refuses '..' and '.' segments, encoded or not, rather than resolving them", () => {
    expect(isInsideDir(`${ROOT}/../databases/RKStorage`, ROOT)).toBe(false)
    expect(isInsideDir(`${ROOT}/a/./b`, ROOT)).toBe(false)
    expect(ownDocumentPath(`file://${ROOT}/%2E%2E/databases/RKStorage`)).toBeNull()
    expect(isInsideDir(`${ROOT}/a..b.pdf`, ROOT)).toBe(true)
  })

  it('refuses a relative path, an empty root, a NUL, and a malformed escape', () => {
    expect(isInsideDir('files/x.pdf', ROOT)).toBe(false)
    expect(isInsideDir(`${ROOT}/x.pdf`, undefined)).toBe(false)
    expect(isInsideDir(`${ROOT}/x.pdf`, '/')).toBe(false)
    expect(isInsideDir(`${ROOT}/x\0.pdf`, ROOT)).toBe(false)
    expect(ownDocumentPath(`file://${ROOT}/%E0%A4%A.pdf`)).toBeNull()
    expect(ownDocumentPath(undefined)).toBeNull()
    expect(ownDocumentPath('')).toBeNull()
  })

  it('knows the other spelling of the same directory on each platform', () => {
    expect(isInsideDir('/data/data/dev.jojo/files/a.pdf', ROOT)).toBe(true)
    const ios = '/var/mobile/Containers/Data/Application/9F2/Documents'
    expect(isInsideDir(`/private${ios}/a.pdf`, ios)).toBe(true)
    expect(isInsideDir(`${ios}/a.pdf`, `/private${ios}`)).toBe(true)
    expect(isInsideDir('/data/data/other.app/files/a.pdf', ROOT)).toBe(false)
  })

  it('decodes a uri and leaves a bare path alone', () => {
    expect(pathOfUri('file:///a/My%20CV%20%232.pdf')).toBe('/a/My CV #2.pdf')
    expect(pathOfUri('/a/b.pdf')).toBe('/a/b.pdf')
  })
})
