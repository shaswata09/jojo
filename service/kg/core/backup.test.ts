/**
 * The backup codec and reader.
 *
 * Weighted towards the codec and towards refusal. A backup is read exactly once,
 * at the moment a person is replacing everything they have, so the failure that
 * matters is not "it threw" — it is "it accepted a damaged file and reported
 * success". Every case below that ends in a refusal is guarding that.
 */

import { describe, expect, it } from 'vitest'
import type { StoredEdge, StoredNode } from './model'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  buildBackup,
  describeBackup,
  fromBase64,
  readBackup,
  toBase64,
} from './backup'

/**
 * ASCII only, longhand.
 *
 * `core` compiles with `lib: ["ES2023"]` and no ambient DOM types, so
 * `TextEncoder` is not declared here — the same rule that made the codec itself
 * hand-written. Every fixture below is ASCII, so this is exact.
 */
const enc = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff
  return out
}
const dec = (bytes: Uint8Array): string => String.fromCharCode(...bytes)

const node = (id: string): StoredNode =>
  ({
    id,
    type: 'application',
    props: { slug: id, position: 'Engineer', company: 'Acme', stage: 'Applied' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as unknown as StoredNode

const edge = (from: string, to: string): StoredEdge =>
  ({ id: `${from}|FILED_UNDER|${to}`, rel: 'FILED_UNDER', from, to, attrs: {} }) as unknown as StoredEdge

describe('base64, which has to be exact', () => {
  it('round-trips every byte value', () => {
    // The whole range in one pass. A table with a single wrong entry corrupts
    // one byte in 256 — often enough to break a PDF, rare enough to survive a
    // hand-written test that only uses ASCII.
    const all = new Uint8Array(256)
    for (let i = 0; i < 256; i += 1) all[i] = i
    const back = fromBase64(toBase64(all))
    expect(back).not.toBeNull()
    expect([...back!]).toEqual([...all])
  })

  it('round-trips every length, so the padding cases are all exercised', () => {
    // Lengths mod 3 are the three tail branches, and off-by-one there produces
    // a file that is right except for its last byte or two.
    for (let n = 0; n <= 40; n += 1) {
      const bytes = new Uint8Array(n)
      for (let i = 0; i < n; i += 1) bytes[i] = (i * 37 + 11) & 0xff
      const back = fromBase64(toBase64(bytes))
      expect(back, `length ${n}`).not.toBeNull()
      expect([...back!], `length ${n}`).toEqual([...bytes])
    }
  })

  it('produces the padding a decoder elsewhere would expect', () => {
    expect(toBase64(enc('a'))).toBe('YQ==')
    expect(toBase64(enc('ab'))).toBe('YWI=')
    expect(toBase64(enc('abc'))).toBe('YWJj')
    expect(toBase64(new Uint8Array(0))).toBe('')
  })

  it('reads back what another encoder wrote', () => {
    // Fixed vectors, so this cannot pass by being self-consistently wrong.
    expect(dec(fromBase64('SGVsbG8sIHdvcmxkIQ==')!)).toBe('Hello, world!')
    expect(dec(fromBase64('JVBERi0xLjc=')!)).toBe('%PDF-1.7')
  })

  it('survives whitespace, because pretty-printers and editors insert it', () => {
    expect(dec(fromBase64('SGVsbG8s\n IHdvcmxk\tIQ==')!)).toBe('Hello, world!')
  })

  it('refuses anything that is not base64 instead of returning wrong bytes', () => {
    for (const bad of ['!!!!', 'SGVsbG8', 'YWJj=', 'ab', '====', 'YQ=A']) {
      expect(fromBase64(bad), bad).toBeNull()
    }
  })

  it('refuses characters ABOVE U+00FF, which the ASCII cases above cannot reach', () => {
    // The reverse table has 256 entries and a string does not. Out of range the
    // lookup gave `undefined`, `undefined < 0` was false, and `undefined << 18`
    // was 0 — so the decoder emitted a zero byte for every character it did not
    // understand. Measured: 'SGVs' + four Hangul filler characters returned
    // [72,101,108,0,0,0] rather than null, quietly writing invented bytes into a
    // restored document.
    for (const bad of [
      'SGVs\u1112\u1112\u1112\u1112', // Hangul
      'SGVs\u03b1\u03b2\u03b3\u03b4', // Greek
      'SGVs\uD83D\uDE00AA', // an emoji's surrogate pair
      '\u00ff\u00ff\u00ff\u00ff', // just inside the table, still not base64
    ]) {
      expect(fromBase64(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('writing a backup', () => {
  it('carries the raw rows, not a summary of them', () => {
    const backup = buildBackup({
      exportedAt: '2026-08-22T10:00:00.000Z',
      nodes: [node('app_1'), node('app_2')],
      edges: [edge('app_1', 'app_2')],
      documents: [{ path: 'Documents/CV.pdf', data: enc('%PDF-1.7') }],
    })
    expect(backup.format).toBe(BACKUP_FORMAT)
    expect(backup.version).toBe(BACKUP_VERSION)
    expect(backup.graph.nodes).toHaveLength(2)
    expect(backup.graph.edges).toHaveLength(1)
    expect(backup.documents[0]!.path).toBe('Documents/CV.pdf')
    expect(backup.documents[0]!.bytes).toBe(8)
  })

  it('survives a whole trip through JSON, which is how it is actually stored', () => {
    const bytes = new Uint8Array([0x00, 0xff, 0xfe, 0xed, 0x25, 0x50, 0x44, 0x46])
    const written = JSON.stringify(
      buildBackup({
        exportedAt: '2026-08-22T10:00:00.000Z',
        nodes: [node('app_1')],
        edges: [],
        documents: [{ path: 'Documents/CV.pdf', data: bytes }],
      }),
    )
    const read = readBackup(written)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value.nodes).toHaveLength(1)
    expect([...read.value.documents[0]!.data]).toEqual([...bytes])
  })
})

describe('reading a backup, which must refuse rather than repair', () => {
  const good = () =>
    JSON.stringify(
      buildBackup({
        exportedAt: '2026-08-22T10:00:00.000Z',
        nodes: [node('app_1')],
        edges: [],
        documents: [{ path: 'Documents/CV.pdf', data: enc('%PDF-1.7') }],
      }),
    )

  it('accepts one it wrote', () => {
    expect(readBackup(good()).ok).toBe(true)
  })

  it('names the older projections-only export instead of calling it foreign', () => {
    // The likeliest wrong file a user picks is jojo's own previous export, and
    // "this file was not written by jojo" would be both wrong and alarming.
    const old = JSON.stringify({ jojo: 3, exportedAt: 'x', applications: [], timeline: [] })
    const read = readBackup(old)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.error.code).toBe('backup/not-a-backup')
    expect(read.error.message).toContain('older export')
  })

  it('refuses a file from a newer jojo rather than reading it half-right', () => {
    const future = JSON.parse(good()) as Record<string, unknown>
    future['version'] = BACKUP_VERSION + 1
    const read = readBackup(JSON.stringify(future))
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.error.code).toBe('backup/too-new')
  })

  it('catches a truncated document by its own byte count', () => {
    // The failure a half-finished download produces: base64 that decodes
    // cleanly right up to the cut. Without the length check this restores a
    // half PDF over a whole one and reports success.
    const file = JSON.parse(good()) as { documents: { data: string; bytes: number }[] }
    file.documents[0]!.data = toBase64(enc('%PDF'))
    const read = readBackup(JSON.stringify(file))
    expect(read.ok).toBe(false)
    if (!read.ok) {
      expect(read.error.code).toBe('backup/corrupt')
      expect(read.error.message).toContain('truncated')
    }
  })

  it('refuses damaged bytes, a missing graph and unparseable text', () => {
    const cases: [string, string][] = [
      ['not json at all', 'backup/unreadable'],
      ['{}', 'backup/not-a-backup'],
      [JSON.stringify({ format: BACKUP_FORMAT, version: 1 }), 'backup/corrupt'],
      [
        JSON.stringify({ format: BACKUP_FORMAT, version: 1, graph: { nodes: [], edges: [] } }),
        'backup/corrupt',
      ],
      [
        JSON.stringify({
          format: BACKUP_FORMAT,
          version: 1,
          graph: { nodes: [], edges: [] },
          documents: [{ path: 'a', data: '!!!!' }],
        }),
        'backup/corrupt',
      ],
    ]
    for (const [text, code] of cases) {
      const read = readBackup(text)
      expect(read.ok, text.slice(0, 40)).toBe(false)
      if (!read.ok) expect(read.error.code, text.slice(0, 40)).toBe(code)
    }
  })

  it('describes what a restore would replace, for the confirmation', () => {
    const read = readBackup(good())
    expect(read.ok).toBe(true)
    if (read.ok) expect(describeBackup(read.value)).toBe('1 records, 0 links, 1 document')
  })
})
